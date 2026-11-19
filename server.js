'use strict';
/*
 * AERIQ store server.
 * Zero external dependencies: Node's built-in http + global fetch only.
 * Serves public/ statically and creates Stripe Checkout Sessions with a
 * server-side price book (data/products.json), so prices can never be
 * tampered with from the browser.
 *
 * Environment:
 *   STRIPE_SECRET_KEY  (required for checkout) live secret key from Stripe
 *   BASE_URL           (optional) public base URL, e.g. https://aeriq.onrender.com
 *   PORT               (optional, set automatically by Render)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

/* ---------- Server-side price book ---------- */
// Purchasable units keyed by the id the browser sends:
//   plain product  -> "kneeboard"
//   variant        -> "rbf-keychain:3pack"  (name carries the variant wording)
const priceBook = new Map();
const catalog = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'products.json'), 'utf8')
);
for (const p of catalog) {
  if (Array.isArray(p.variants) && p.variants.length) {
    for (const v of p.variants) {
      priceBook.set(`${p.id}:${v.id}`, {
        name: `${p.name} — ${v.label}`,
        priceCents: v.priceCents,
      });
    }
  } else if (Number.isInteger(p.priceCents) && !p.comingSoon) {
    priceBook.set(p.id, { name: p.name, priceCents: p.priceCents });
  }
}

/* ---------- Helpers ---------- */
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400); return res.end('Bad request');
  }
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, urlPath);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function baseUrl(req) {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/+$/, '');
  const origin = req.headers.origin;
  if (origin && /^https?:\/\//.test(origin)) return origin.replace(/\/+$/, '');
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

/* ---------- Checkout ---------- */
async function createCheckoutSession(req, res) {
  // Read body (with a sane size cap).
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 1e6) req.destroy();
  });
  req.on('end', async () => {
    let body;
    try { body = JSON.parse(raw || 'null'); } catch {
      return sendJson(res, 400, { error: 'Request body must be valid JSON.' });
    }
    const items = Array.isArray(body) ? body : (body && Array.isArray(body.items) ? body.items : null);
    if (!items || items.length === 0) {
      return sendJson(res, 400, { error: 'Cart is empty or malformed.' });
    }

    // Validate every line against the server-side price book.
    const lines = [];
    for (const item of items) {
      const id = item && item.id;
      const qty = item && item.qty;
      if (typeof id !== 'string' || !priceBook.has(id)) {
        return sendJson(res, 400, { error: `Unknown product id: ${String(id)}` });
      }
      if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
        return sendJson(res, 400, { error: `Quantity for ${id} must be a whole number between 1 and 99.` });
      }
      lines.push({ ...priceBook.get(id), qty });
    }

    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) {
      return sendJson(res, 500, {
        error: 'Server not configured: STRIPE_SECRET_KEY is not set. The shop owner needs to add it in the host settings (see README).',
      });
    }

    const base = baseUrl(req);
    const params = new URLSearchParams();
    params.set('mode', 'payment');
    params.set('success_url', `${base}/success.html`);
    params.set('cancel_url', `${base}/cancel.html`);
    lines.forEach((line, i) => {
      params.set(`line_items[${i}][quantity]`, String(line.qty));
      params.set(`line_items[${i}][price_data][currency]`, 'usd');
      params.set(`line_items[${i}][price_data][unit_amount]`, String(line.priceCents));
      params.set(`line_items[${i}][price_data][product_data][name]`, line.name);
    });
    params.set('shipping_address_collection[allowed_countries][0]', 'US');
    const customFields = [
      'Item name(s) and order number',
      'CFI Sticker Pack: name, certificate no. and expiry',
    ];
    customFields.forEach((label, i) => {
      params.set(`custom_fields[${i}][key]`, `field_${i + 1}`);
      params.set(`custom_fields[${i}][label][type]`, 'custom');
      params.set(`custom_fields[${i}][label][custom]`, label);
      params.set(`custom_fields[${i}][type]`, 'text');
      params.set(`custom_fields[${i}][optional]`, 'true');
    });

    let stripeRes, stripeBody;
    try {
      stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${secret}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });
      stripeBody = await stripeRes.json();
    } catch (e) {
      return sendJson(res, 502, { error: `Could not reach Stripe: ${e.message}` });
    }
    if (!stripeRes.ok || !stripeBody.url) {
      const msg = (stripeBody && stripeBody.error && stripeBody.error.message) || `Stripe returned HTTP ${stripeRes.status}`;
      return sendJson(res, 502, { error: `Stripe error: ${msg}` });
    }
    return sendJson(res, 200, { url: stripeBody.url });
  });
}

/* ---------- Server ---------- */
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (req.method === 'POST' && pathname === '/api/create-checkout-session') {
    createCheckoutSession(req, res);
  } else if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res);
  } else {
    res.writeHead(405); res.end('Method not allowed');
  }
});

server.listen(PORT, () => {
  console.log(`AERIQ store listening on port ${PORT} (${priceBook.size} purchasable items in price book)`);
});
