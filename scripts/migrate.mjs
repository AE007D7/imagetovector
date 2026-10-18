import { getMigrations } from 'better-auth/db';
import { getAuth, database } from '../lib/auth.js';
if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') {
  console.log('Preview build: production schema migration skipped.');
  process.exit(0);
}
const { runMigrations } = await getMigrations(getAuth().options);
await runMigrations();
await database().query(`
CREATE TABLE IF NOT EXISTS billing_customers (
 user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
 customer_id TEXT UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS billing_periods (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 subscription_id TEXT NOT NULL,
 period_start TIMESTAMPTZ NOT NULL,
 period_end TIMESTAMPTZ NOT NULL,
 allowance INTEGER NOT NULL DEFAULT 10 CHECK (allowance = 10),
 UNIQUE(subscription_id, period_start)
);
CREATE TABLE IF NOT EXISTS conversion_uses (
 id UUID PRIMARY KEY,
 period_id TEXT NOT NULL REFERENCES billing_periods(id),
 state TEXT NOT NULL CHECK(state IN ('pending','complete','failed')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversion_uses_period_idx ON conversion_uses(period_id);
`);
await database().end();
console.log('Account and billing schema installed. No image storage created.');
