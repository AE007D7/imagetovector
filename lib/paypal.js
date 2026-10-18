import { createHash } from 'node:crypto';
import { database, origin } from './auth.js';
import { validPlan, monthlyWindow, verifiedPayment, approvalURL } from './paypal-rules.js';

export const paypalConfigured = () => Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
const sandbox = () => process.env.PAYPAL_ENVIRONMENT === 'sandbox';
const mode = () => sandbox() ? 'sandbox' : 'live';
const fingerprint = () => createHash('sha256').update(process.env.PAYPAL_CLIENT_ID || '').digest('hex').slice(0,24);
const failure = (message = 'PayPal is temporarily unavailable. Please try again.') => Object.assign(new Error(message), {status:503});
let token, tokenUntil = 0;
export async function paypalAPI(path, method = 'GET', data, requestId) {
  const base = sandbox() ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
  if (!paypalConfigured()) throw failure();
  if (!token || Date.now() >= tokenUntil) {
    const response = await fetch(`${base}/v1/oauth2/token`, {
      method:'POST', headers:{authorization:`Basic ${Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64')}`,'content-type':'application/x-www-form-urlencoded'},
      body:'grant_type=client_credentials', signal:AbortSignal.timeout(15000)
    });
    if (!response.ok) throw failure('PayPal credentials could not be verified.');
    const result = await response.json();
    token = result.access_token; tokenUntil = Date.now() + Math.max(0,Number(result.expires_in)-60)*1000;
  }
  const response = await fetch(`${base}${path}`, {
    method, headers:{authorization:`Bearer ${token}`,'content-type':'application/json',Prefer:'return=representation',...(requestId?{'PayPal-Request-Id':requestId}:{})},
    body:data === undefined ? undefined : JSON.stringify(data), signal:AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    if (response.status === 401) { token = null; tokenUntil = 0; }
    const result = await response.json().catch(()=>({}));
    // Provider error codes aid build diagnosis without logging requests, tokens or personal data.
    const error = failure(); error.providerCode = result.name || `HTTP_${response.status}`;
    throw error;
  }
  return response.status === 204 ? {} : response.json();
}
export async function paypalConfig() {
  if (!paypalConfigured()) return null;
  const {rows} = await database().query('SELECT * FROM paypal_config WHERE environment=$1 AND client_fingerprint=$2',[mode(),fingerprint()]);
  return rows[0] || null;
}
export async function setupPaypal() {
  if (!paypalConfigured()) return;
  const db = await database().connect();
  try {
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`paypal-setup-${mode()}`]);
    let config = await paypalConfig();
    if (!config) {
      const product = await paypalAPI('/v1/catalogs/products','POST',{
        name:'ImageToVector Monthly',description:'10 image-to-vector conversions per month',type:'SERVICE',category:'SOFTWARE',home_url:origin()
      },`itv-product-${fingerprint()}`);
      // Stable provider idempotency keys protect retries during a failed deployment.
      await db.query('INSERT INTO paypal_config(environment,client_fingerprint,product_id) VALUES($1,$2,$3) ON CONFLICT(environment) DO UPDATE SET client_fingerprint=$2,product_id=$3,plan_id=NULL,webhook_id=NULL',[mode(),fingerprint(),product.id]);
      config={product_id:product.id};
    }
    if (!config.plan_id) {
      const plan = await paypalAPI('/v1/billing/plans','POST',{
        product_id:config.product_id,name:'ImageToVector · 10 conversions monthly',status:'ACTIVE',
        description:'US$4.99 per month. 10 conversions each month. Unused conversions do not roll over.',
        billing_cycles:[{frequency:{interval_unit:'MONTH',interval_count:1},tenure_type:'REGULAR',sequence:1,total_cycles:0,pricing_scheme:{fixed_price:{value:'4.99',currency_code:'USD'}}}],
        payment_preferences:{auto_bill_outstanding:false,setup_fee_failure_action:'CANCEL',payment_failure_threshold:1},quantity_supported:false
      },`itv-plan-${fingerprint()}`);
      config.plan_id=plan.id;
      await db.query('UPDATE paypal_config SET plan_id=$2 WHERE environment=$1',[mode(),plan.id]);
    }
    const plan = await paypalAPI(`/v1/billing/plans/${encodeURIComponent(config.plan_id)}`);
    if (!validPlan(plan)) throw failure('PayPal monthly plan does not match US$4.99/month.');
    if (!config.webhook_id) {
      const url=`${origin()}/api/paypal-webhook`;
      const hooks=await paypalAPI('/v1/notifications/webhooks');
      const existing=hooks.webhooks?.find(h=>h.url===url);
      const hook=existing || await paypalAPI('/v1/notifications/webhooks','POST',{
        url,event_types:[{name:'BILLING.SUBSCRIPTION.ACTIVATED'},{name:'BILLING.SUBSCRIPTION.CANCELLED'},{name:'BILLING.SUBSCRIPTION.SUSPENDED'},{name:'BILLING.SUBSCRIPTION.EXPIRED'},{name:'BILLING.SUBSCRIPTION.PAYMENT.FAILED'},{name:'PAYMENT.SALE.COMPLETED'},{name:'PAYMENT.SALE.REFUNDED'},{name:'PAYMENT.SALE.REVERSED'}]
      });
      await db.query('UPDATE paypal_config SET webhook_id=$2 WHERE environment=$1',[mode(),hook.id]);
    }
    await db.query('COMMIT');
    console.log(`PayPal ${mode()} monthly plan and webhook verified.`);
  } catch(error) { await db.query('ROLLBACK'); console.error('PayPal setup failed:',error.providerCode || error.message); throw error; }
  finally { db.release(); }
}
export async function paypalRecord(user) {
  const {rows}=await database().query('SELECT * FROM paypal_subscriptions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',[user.id]);
  return rows[0] || null;
}
export async function paypalCheckout(user) {
  const config=await paypalConfig();
  if (!config?.plan_id || !config.webhook_id) throw failure('PayPal subscriptions are still being connected.');
  const plan=await paypalAPI(`/v1/billing/plans/${encodeURIComponent(config.plan_id)}`);
  if (!validPlan(plan)) throw failure('PayPal subscriptions are temporarily unavailable.');
  const existing=await paypalRecord(user);
  if (existing) {
    const subscription=await paypalAPI(`/v1/billing/subscriptions/${encodeURIComponent(existing.subscription_id)}`);
    if (['ACTIVE','SUSPENDED','APPROVED'].includes(subscription.status)) throw Object.assign(new Error('You already have a PayPal subscription. Manage it in PayPal.'),{status:409});
    if (subscription.status==='APPROVAL_PENDING') {
      const url=approvalURL(subscription,sandbox());
      if (url) return url;
      throw failure('Your PayPal subscription is awaiting approval. Please try again later.');
    }
    const entitlement=await paypalEntitlement(user);
    if (entitlement?.periodId) throw Object.assign(new Error('Your current paid month has not ended yet.'),{status:409});
  }
  const subscription=await paypalAPI('/v1/billing/subscriptions','POST',{
    plan_id:config.plan_id,quantity:'1',custom_id:`itv:${user.id}`,
    application_context:{brand_name:'ImageToVector',shipping_preference:'NO_SHIPPING',user_action:'SUBSCRIBE_NOW',
      return_url:`${origin()}/account/?checkout=success&provider=paypal`,cancel_url:`${origin()}/account/?checkout=cancelled&provider=paypal`}
  },`itv-sub-${createHash('sha256').update(`${user.id}:${Math.floor(Date.now()/1800000)}`).digest('hex').slice(0,28)}`);
  const url=approvalURL(subscription,sandbox());
  if (!url) throw failure();
  await database().query('INSERT INTO paypal_subscriptions(subscription_id,user_id,status) VALUES($1,$2,$3) ON CONFLICT(subscription_id) DO NOTHING',[subscription.id,user.id,subscription.status]);
  return url;
}
export async function paypalEntitlement(user) {
  const record=await paypalRecord(user);
  if (!record) return null;
  const config=await paypalConfig();
  if (!config?.plan_id) throw failure();
  const sub=await paypalAPI(`/v1/billing/subscriptions/${encodeURIComponent(record.subscription_id)}`);
  await database().query('UPDATE paypal_subscriptions SET status=$2 WHERE subscription_id=$1',[sub.id,sub.status]);
  const empty={provider:'paypal',customer:true,status:sub.status==='ACTIVE'?'payment_pending':sub.status?.toLowerCase() || 'none',remaining:0,periodEnd:null,cancelAtPeriodEnd:sub.status==='CANCELLED'};
  if (sub.plan_id!==config.plan_id || sub.custom_id!==`itv:${user.id}` || sub.plan_overridden || (sub.quantity && sub.quantity!=='1')) return empty;
  if (!['ACTIVE','CANCELLED'].includes(sub.status)) return empty;
  const plan=await paypalAPI(`/v1/billing/plans/${encodeURIComponent(config.plan_id)}`);
  if (!validPlan(plan)) return empty;
  const window=monthlyWindow(sub.start_time);
  if (!window) return empty;
  const query=new URLSearchParams({start_time:new Date(window.start).toISOString(),end_time:new Date().toISOString()});
  const transactions=await paypalAPI(`/v1/billing/subscriptions/${encodeURIComponent(sub.id)}/transactions?${query}`);
  const payment=verifiedPayment(transactions.transactions || [],window);
  if (!payment || (transactions.total_pages || 1)>1) return empty;
  const blocked=await database().query('SELECT payment_id FROM paypal_blocked_payments WHERE payment_id=$1',[payment.id]);
  if (blocked.rowCount) return {...empty,status:'payment_reversed'};
  const id=`paypal:${sub.id}:${window.start}`;
  await database().query('INSERT INTO billing_periods(id,user_id,subscription_id,period_start,period_end) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[id,user.id,sub.id,new Date(window.start),new Date(window.end)]);
  await database().query('INSERT INTO paypal_payment_periods(payment_id,period_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[payment.id,id]);
  await database().query("UPDATE conversion_uses SET state='failed' WHERE period_id=$1 AND state='pending' AND created_at < now() - interval '5 minutes'",[id]);
  const {rows}=await database().query("SELECT count(*)::int AS used FROM conversion_uses WHERE period_id=$1 AND state IN ('pending','complete')",[id]);
  return {...empty,status:'active',periodId:id,remaining:Math.max(0,10-rows[0].used),periodEnd:new Date(window.end).toISOString()};
}
export function paypalManageURL() {
  return sandbox() ? 'https://www.sandbox.paypal.com/myaccount/autopay/' : 'https://www.paypal.com/myaccount/autopay/';
}
