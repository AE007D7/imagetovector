import Stripe from 'stripe';

import { authReady, database } from './auth.js';
import { paypalConfigured, paypalEntitlement, paypalCheckout } from './paypal.js';
let client;
export const stripeConfigured = () => ['STRIPE_SECRET_KEY','STRIPE_PRICE_ID','STRIPE_WEBHOOK_SECRET','STRIPE_PORTAL_CONFIGURATION_ID'].every(k => Boolean(process.env[k]));
export const billingReady = () => authReady() && process.env.BILLING_ENABLED === 'true' && ['VECTORIZER_API_ID','VECTORIZER_API_SECRET'].every(k => Boolean(process.env[k])) && (stripeConfigured() || paypalConfigured());
export function stripe() { return client ||= new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-08-26.dahlia', maxNetworkRetries: 2, timeout: 15000 }); }
export function fail(status, message) { return Object.assign(new Error(message), { status }); }
export async function customerFor(user, create = false) {
  const db = database();
  let { rows } = await db.query('SELECT customer_id FROM billing_customers WHERE user_id=$1', [user.id]);
  if (rows[0]) return rows[0].customer_id;
  if (!create) return null;
  const customer = await stripe().customers.create({ email: user.email, name: user.name }, { idempotencyKey: `customer-${user.id}` });
  await db.query('INSERT INTO billing_customers(user_id,customer_id) VALUES($1,$2) ON CONFLICT(user_id) DO NOTHING', [user.id,customer.id]);
  ({ rows } = await db.query('SELECT customer_id FROM billing_customers WHERE user_id=$1', [user.id]));
  return rows[0].customer_id;
}
export async function subscriptionFor(customer) {
  if (!customer) return null;
  const list = await stripe().subscriptions.list({ customer, status: 'all', limit: 100, expand: ['data.latest_invoice'] });
  return list.data.find(s => ['active','past_due','unpaid','incomplete','paused','trialing'].includes(s.status) && s.items.data.some(i => i.price.id === process.env.STRIPE_PRICE_ID)) || null;
}
export async function entitlement(user) {
  const paypal = paypalConfigured() ? await paypalEntitlement(user) : null;
  if (paypal?.periodId || (paypal && !['cancelled','expired'].includes(paypal.status))) return paypal;
  if (!stripeConfigured()) return paypal || {customer:false,status:'none',remaining:0,periodEnd:null};
  return stripeEntitlement(user);
}
export async function stripeEntitlement(user) {
  const customer = await customerFor(user), sub = await subscriptionFor(customer);
  const empty = { provider: 'stripe', customer: Boolean(customer), status: sub?.status || 'none', remaining: 0, periodEnd: null, cancelAtPeriodEnd: sub?.cancel_at_period_end || false };
  if (!sub || sub.status !== 'active') return empty;
  const invoice = typeof sub.latest_invoice === 'string' ? await stripe().invoices.retrieve(sub.latest_invoice) : sub.latest_invoice;
  if (!invoice || invoice.status !== 'paid' || invoice.amount_paid < 499 || invoice.currency !== 'usd') return empty;
  const lines = await stripe().invoices.listLineItems(invoice.id, { limit: 100 });
  const line = lines.data.find(l => l.pricing?.price_details?.price === process.env.STRIPE_PRICE_ID && l.quantity === 1 && l.parent?.subscription_item_details?.proration === false);
  if (!line || line.period.end * 1000 <= Date.now() || line.period.start * 1000 > Date.now()) return empty;
  const id = `${sub.id}:${line.period.start}`;
  await database().query('INSERT INTO billing_periods(id,user_id,subscription_id,period_start,period_end) VALUES($1,$2,$3,to_timestamp($4),to_timestamp($5)) ON CONFLICT DO NOTHING', [id,user.id,sub.id,line.period.start,line.period.end]);
  // A serverless request cannot still run after five minutes. Recover interrupted reservations.
  await database().query("UPDATE conversion_uses SET state='failed' WHERE period_id=$1 AND state='pending' AND created_at < now() - interval '5 minutes'", [id]);
  const { rows } = await database().query("SELECT count(*)::int AS used FROM conversion_uses WHERE period_id=$1 AND state IN ('pending','complete')", [id]);
  return { ...empty, periodId: id, remaining: Math.max(0,10-rows[0].used), periodEnd: new Date(line.period.end*1000).toISOString() };
}
export async function reserve(user, id) {
  if (!/^[a-f0-9-]{36}$/i.test(id || '')) throw fail(400,'A download request ID is required.');
  const access = await entitlement(user);
  if (!access.periodId) throw fail(402,'An active, paid subscription is required.');
  const db = await database().connect();
  try {
    await db.query('BEGIN');
    await db.query('SELECT id FROM billing_periods WHERE id=$1 AND user_id=$2 FOR UPDATE', [access.periodId,user.id]);
    const existing = await db.query('SELECT id FROM conversion_uses WHERE id=$1',[id]);
    if (existing.rowCount) throw fail(409,'This download request was already submitted. Refresh your account before trying again.');
    const { rows } = await db.query("SELECT count(*)::int AS used FROM conversion_uses WHERE period_id=$1 AND state IN ('pending','complete')",[access.periodId]);
    if (rows[0].used >= 10) throw fail(402,'You have used all 10 conversions for this billing month.');
    await db.query("INSERT INTO conversion_uses(id,period_id,state) VALUES($1,$2,'pending')",[id,access.periodId]);
    await db.query('COMMIT'); return id;
  } catch(error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
}
export async function settle(id, success) {
  if (id) await database().query("UPDATE conversion_uses SET state=$2 WHERE id=$1 AND state='pending'",[id, success?'complete':'failed']);
}
export async function checkout(user, baseURL, provider = 'stripe') {
  const lock = await database().connect();
  try {
    await lock.query('BEGIN');
    await lock.query('SELECT pg_advisory_xact_lock(hashtext($1))', [user.id]);
    let url;
    if (provider === 'paypal') {
      if (stripeConfigured() && await subscriptionFor(await customerFor(user))) throw fail(409,'You already have a card subscription. Manage it before switching payment methods.');
      url = await paypalCheckout(user);
    } else {
      if (!stripeConfigured()) throw fail(503,'Card subscriptions are not available yet.');
      const paypal = paypalConfigured() ? await paypalEntitlement(user) : null;
      if (paypal && (paypal.periodId || !['cancelled','expired'].includes(paypal.status))) throw fail(409,'You already have a PayPal subscription. Manage it in PayPal before switching payment methods.');
      url = await checkoutLocked(user, baseURL);
    }
    await lock.query('COMMIT');
    return url;
  } catch (error) { await lock.query('ROLLBACK'); throw error; } finally { lock.release(); }
}
async function checkoutLocked(user, baseURL) {
  const customer = await customerFor(user,true);
  if (await subscriptionFor(customer)) throw fail(409,'You already have a subscription. Use Manage subscription instead.');
  const price = await stripe().prices.retrieve(process.env.STRIPE_PRICE_ID);
  if (!price.active || price.unit_amount !== 499 || price.currency !== 'usd' || price.recurring?.interval !== 'month' || price.recurring?.interval_count !== 1) throw fail(503,'The subscription price is not configured correctly.');
  const sessions = await stripe().checkout.sessions.list({ customer, status:'open',limit:100 });
  const existing = sessions.data.find(s=>s.mode==='subscription' && s.metadata?.site==='imagetovector.org');
  if (existing) return existing.url;
  // Same customer and 30-minute window share one session, including concurrent clicks.
  const session = await stripe().checkout.sessions.create({
    customer, mode:'subscription', line_items:[{price:price.id,quantity:1}],
    success_url:`${baseURL}/account/?checkout=success`,cancel_url:`${baseURL}/account/?checkout=cancelled`,
    metadata:{site:'imagetovector.org'}, integration_identifier:'imagetovector-nqvxtpma'
  }, {idempotencyKey:`subscribe-${user.id}-${Math.floor(Date.now()/1800000)}`});
  return session.url;
}
