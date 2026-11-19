# AERIQ — self-hosted store

A standalone version of the AERIQ pilot-gear shop that can run on a free
public host (Render's free tier). Unlike the static storefront page, this
version has a small server, so checkout works the way it does on regular
stores: the customer adds items to a cart, taps Checkout, and lands on
Stripe's secure payment page with the exact cart total already filled in.
Nothing to type, nothing to add up.

Prices are enforced by the server from `data/products.json` (the price
book), so a price can never be changed from the browser.

## What's in this folder

| Path | What it is |
| --- | --- |
| `server.js` | The whole server. No packages to install — it only uses Node.js built-ins. |
| `data/products.json` | The catalog and price book: all 49 products, 6 categories. |
| `public/index.html` | The storefront (categories, search, cart, checkout button). |
| `public/success.html` | Thank-you page customers land on after paying. |
| `public/cancel.html` | Page customers land on if they cancel checkout. |
| `public/img/` | Product photos. |
| `public/catalog.json`, `public/meta.json` | Catalog data the storefront page loads. |

The cart lives in each visitor's browser only. There are no accounts and
the server does not save orders — paid orders live in Stripe, like before.

## Run it on your own computer (to preview)

1. Install Node.js (any recent version) from nodejs.org if you don't have it.
2. In this folder, run: `node server.js`
3. Open http://localhost:3000 in a browser.

Without a Stripe key (next section), the shop displays fine but checkout
will show a "server not configured" error. That is expected.

## Put it on the internet for free (Render)

You only do this once. Take it step by step:

1. **Make a free GitHub account** at github.com if you don't have one, and
   create a new repository (repo). Upload this whole `aeriq-web` folder's
   contents into it (the files above, with `server.js` at the top level of
   the repo).
2. **Make a free Render account** at render.com (you can sign in with
   GitHub).
3. In Render, click **New +** → **Web Service**, and connect the GitHub
   repo you just made.
4. Settings for the service:
   - **Runtime:** Node
   - **Build command:** leave it empty (there is nothing to build/install)
   - **Start command:** `node server.js`
   - **Instance type:** **Free**
5. **Add your Stripe secret key.** Still in the service's settings, open
   **Environment** → **Add Environment Variable**:
   - Key: `STRIPE_SECRET_KEY`
   - Value: your **live** secret key. Find it in the Stripe Dashboard under
     **Developers → API keys** — it's the one labelled "Secret key" and it
     starts with `sk_live_`. (You may need to click "Reveal" to see it.)

   > ⚠️ **The secret key is like a password to your money.** Enter it ONLY
   > in Render's Environment settings, exactly like above. Never send it in
   > a chat, never put it in an email, and never upload it to GitHub (keep
   > it out of every file in the repo). Anyone who has this key can act on
   > your Stripe account.
6. Click **Create Web Service**. Render gives you a public address like
   `https://aeriq.onrender.com`. That is your live shop — anyone with the
   link can buy, and payments land in the same live Stripe account you
   already activated.
7. (Optional) In the same Environment section you can also add
   `BASE_URL` set to your Render address (e.g. `https://aeriq.onrender.com`).
   Without it, the shop figures the address out automatically, which works
   fine on Render.

## Good to know

- **Free tier sleeps.** On Render's free plan the shop falls asleep after
  about 15 minutes with no visitors. The first visit after that takes
  roughly 30 seconds to wake up, then it's fast again. This is normal for
  the free tier.
- **Changing prices or products:** edit `data/products.json` (and the copy
  at `public/catalog.json`), then commit to GitHub — Render redeploys
  automatically.
- **The Compact Flight Bag** is listed as "Coming soon" with no price and
  cannot be added to a cart, same as the current shop.
- **Two products have options** (Maneuver Manuals by aircraft type, and the
  "Remove Before Flight" Keychain as Single or 3-pack). The cart keeps the
  exact option and price the customer picked.
- If checkout ever shows "Server not configured," the `STRIPE_SECRET_KEY`
  environment variable is missing in Render — re-check step 5.
