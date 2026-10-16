# ImageToVector payment setup

Offer confirmed by owner: USD 4.99 one-time for 10 conversions.

Stripe account: acct_1UPkUKCSmL3FiSLe
Product: prod_VS6y9a8mjQjsJY
Price: price_1URCksCSmL3FiSLe2WpZaD1H
Payment link: https://buy.stripe.com/bJe4gy8tif7m45s7CgbbG00
PayPal payment link: https://www.paypal.com/ncp/payment/K4Q2ZHZNG3SZL

These live links have been created but are deliberately not linked from the pricing page. No payment was made.

## Required before enabling purchases
- Persistent customer identity and durable credit ledger (not localStorage or process memory).
- Stripe signed webhook verification for checkout.session.completed and checkout.session.async_payment_succeeded, requiring paid status, exact price/currency/quantity, and idempotent credit grants.
- PayPal verified payment capture/webhook processing, exact merchant/amount/currency checks, and idempotent credit grants.
- Associate each checkout with the authenticated customer.
- Atomically reserve one credit per production conversion; restore credit after confirmed failure.
- Server-authorized production vectorization for paid customers; never trust client mode or credit count.
- Signed-in credit balance and purchase recovery, plus refund handling.
- Sandbox end-to-end verification before exposing live payment links.

Current api/vectorize.js always uses test mode, and the site has no customer login or credit database. Stripe connector access is not a runtime secret for Vercel. No payment credentials are stored in the frontend.
