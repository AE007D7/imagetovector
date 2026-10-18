# Account and billing activation

## Implemented in this checkout

- Better Auth single-use email links, 30-day sessions and database-backed authentication rate limits.
- Account page at `/account/` with monthly allowance, billing status, sign-out and Stripe Customer Portal.
- Signed Stripe webhook endpoint at `/api/stripe-webhook`.
- A unique billing-period allowance from a verified paid Stripe invoice, with atomic download reservations. Duplicate webhook events do not refill credits.
- Paid exports call Vectorizer.AI production mode; image retention is explicitly zero. No uploaded or converted file is written to disk or database.
- Public bitmap comparisons remain in test mode until production previews are configured.
- Production checkout stays disabled unless `BILLING_ENABLED=true` and required service settings exist.

## Resources created on October 17, 2026

- Neon free database: `imagetovector-accounts` in the Vercel team. Connected to imagetovector Production with protected DATABASE_URL; Preview and Development are not connected.
- Stripe account: `acct_1UPkUKCSmL3FiSLe` (Canoe Civic Club LLC).
- Monthly USD 4.99 price: `price_1URaqMCSmL3FiSLeFRTlkAMk`.
- Portal configuration: `bpc_1URawBCSmL3FiSLeH6QiENL4`.
- The old one-time Stripe price and PayPal link must not be used for subscriptions.

## Required production settings

Use `.env.example` for names, never commit values.

1. Done: Neon database connected to Production (`DATABASE_URL`).
2. Set `BETTER_AUTH_URL=https://imagetovector.org` and a securely generated `BETTER_AUTH_SECRET` of at least 32 bytes.
3. Done October 18: Resend verified imagetovector.org. A domain-restricted Sending access key is stored as Production RESEND_API_KEY; AUTH_EMAIL_FROM is ImageToVector <accounts@imagetovector.org>.
4. Set a restricted Stripe runtime key (`STRIPE_SECRET_KEY`) with customer read/write, prices read, subscriptions read, invoices read, Checkout Sessions read/write and billing portal sessions write. Use the existing live account above.
5. Done October 18: STRIPE_PRICE_ID and STRIPE_PORTAL_CONFIGURATION_ID saved in Vercel Production. BETTER_AUTH_URL is also saved.
6. Register `https://imagetovector.org/api/stripe-webhook` for invoice.paid, invoice.payment_failed, customer.subscription.created/updated/deleted, checkout.session.completed, checkout.session.async_payment_succeeded. Set its signing secret as `STRIPE_WEBHOOK_SECRET`.
7. Install dependencies and run `npm run db:migrate` with the intended database settings. Migration is explicit, never run from a public endpoint.
8. Confirm Vectorizer.AI has an active API plan and sufficient credits. A website subscription alone is not an API subscription.
9. Verify the sign-in email flow, subscription payment and webhook, monthly allowance, cancellation, failed conversion refund and production export before setting `BILLING_ENABLED=true`.

## Outstanding

No tests or payment transactions were run. Local package installation was blocked by DNS resolution to registry.npmjs.org. The code has not yet been deployed or exercised against a database. PayPal recurring billing is not implemented; its old one-time link remains disabled. Public previews still have the provider's test watermark. Tax collection has not been enabled; review registrations before enabling Stripe Tax.

Files are not recoverable from this service after leaving the page. Each new export request consumes one conversion, including a new format. A failed provider request releases its reservation. Interrupted serverless reservations expire after five minutes; a lost connection after successful completion can still use one conversion.
