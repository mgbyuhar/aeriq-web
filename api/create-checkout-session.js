'use strict';
/*
 * AERIQ checkout — Vercel serverless function.
 * Same logic as server.js: validates the cart against a server-side price
 * book (pricebook.json, a copy of data/products.json) and creates a Stripe
 * Checkout Session for the exact total. The Stripe secret key comes from
 * the STRIPE_SECRET_KEY environment variable in the Vercel project settings.
 */

const catalog = require('./pricebook.json');

const priceBook = new Map();
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

function baseUrl(req) {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/+$/, '');
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = req.headers.host || 'localhost';
  return `${proto}://${host}`;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body || 'null'); } catch {
      return res.status(400).json({ error: 'Request body must be valid JSON.' });
    }
  }
  const items = Array.isArray(body) ? body : (body && Array.isArray(body.items) ? body.items : null);
  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'Cart is empty or malformed.' });
  }

  const lines = [];
  for (const item of items) {
    const id = item && item.id;
    const qty = item && item.qty;
    if (typeof id !== 'string' || !priceBook.has(id)) {
      return res.status(400).json({ error: `Unknown product id: ${String(id)}` });
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
      return res.status(400).json({ error: `Quantity for ${id} must be a whole number between 1 and 99.` });
    }
    lines.push({ ...priceBook.get(id), qty });
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return res.status(500).json({
      error: 'Server not configured: STRIPE_SECRET_KEY is not set. The shop owner needs to add it in the Vercel project settings.',
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
    return res.status(502).json({ error: `Could not reach Stripe: ${e.message}` });
  }
  if (!stripeRes.ok || !stripeBody.url) {
    const msg = (stripeBody && stripeBody.error && stripeBody.error.message) || `Stripe returned HTTP ${stripeRes.status}`;
    return res.status(502).json({ error: `Stripe error: ${msg}` });
  }
  return res.status(200).json({ url: stripeBody.url });
};
