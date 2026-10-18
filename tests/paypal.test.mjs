import test from 'node:test';
import assert from 'node:assert/strict';
import { validPlan, monthlyWindow, verifiedPayment, approvalURL } from '../lib/paypal-rules.js';

const plan={status:'ACTIVE',billing_cycles:[{tenure_type:'REGULAR',frequency:{interval_unit:'MONTH',interval_count:1},total_cycles:0,pricing_scheme:{fixed_price:{currency_code:'USD',value:'4.99'}}}],quantity_supported:false,payment_preferences:{}};
const copy=()=>structuredClone(plan);
test('only the fixed monthly price is accepted, with no trials, taxes or setup fees',()=>{
  assert.equal(validPlan(plan),true);
  for(const mutate of [p=>p.status='INACTIVE',p=>p.billing_cycles[0].pricing_scheme.fixed_price.value='49.99',p=>p.billing_cycles[0].pricing_scheme.fixed_price.currency_code='EUR',p=>p.billing_cycles[0].frequency.interval_unit='YEAR',p=>p.billing_cycles.push({...p.billing_cycles[0],tenure_type:'TRIAL'}),p=>p.quantity_supported=true,p=>p.payment_preferences.setup_fee={value:'1.00'},p=>p.taxes={percentage:'20'}]) {const p=copy();mutate(p);assert.equal(validPlan(p),false);}
});
test('monthly windows preserve month-end anchors and leap years',()=>{
  const anchor='2024-01-31T12:30:00Z';
  assert.deepEqual(monthlyWindow(anchor,Date.parse('2024-02-29T12:29:59Z')),{start:Date.parse(anchor),end:Date.parse('2024-02-29T12:30:00Z')});
  assert.deepEqual(monthlyWindow(anchor,Date.parse('2024-03-15T00:00:00Z')),{start:Date.parse('2024-02-29T12:30:00Z'),end:Date.parse('2024-03-31T12:30:00Z')});
  assert.equal(monthlyWindow('invalid'),null);assert.equal(monthlyWindow('2099-01-01'),null);
});
const window={start:Date.parse('2026-10-01T00:00:00Z'),end:Date.parse('2026-11-01T00:00:00Z')};
const payment={id:'ABC123',status:'COMPLETED',time:'2026-10-01T00:00:01Z',amount_with_breakdown:{gross_amount:{currency_code:'USD',value:'4.99'}}};
test('pending, refunded, reversed, wrong-price, wrong-currency and old payments grant no credits',()=>{
  assert.equal(verifiedPayment([payment],window).id,payment.id);
  for(const status of ['PENDING','REFUNDED','REVERSED','FAILED'])assert.equal(verifiedPayment([{...payment,status}],window),null);
  for(const gross_amount of [{currency_code:'USD',value:'0.01'},{currency_code:'EUR',value:'4.99'}])assert.equal(verifiedPayment([{...payment,amount_with_breakdown:{gross_amount}}],window),null);
  assert.equal(verifiedPayment([{...payment,time:'2026-09-30T23:59:59Z'}],window),null);
  assert.equal(verifiedPayment([{...payment,time:'2026-11-01T00:00:00Z'}],window),null);
});
test('approval redirects are limited to the matching PayPal environment',()=>{
  const sub=href=>({links:[{rel:'approve',href}]});
  assert.ok(approvalURL(sub('https://www.paypal.com/webapps/billing/subscriptions?ba_token=test')));
  assert.equal(approvalURL(sub('https://www.paypal.com.evil.test/')),null);
  assert.equal(approvalURL(sub('https://www.sandbox.paypal.com/')),null);
  assert.equal(approvalURL(sub('http://www.paypal.com/')),null);
});

// Exercise provider reconciliation and webhook behavior without moving money or writing a live database.
process.env.DATABASE_URL='postgres://test:test@localhost/test';
process.env.PAYPAL_CLIENT_ID='test-client';process.env.PAYPAL_CLIENT_SECRET='test-secret';
const {database}=await import('../lib/auth.js');
const {paypalEntitlement}=await import('../lib/paypal.js');
const {default:webhook}=await import('../api/paypal-webhook.js');
const db=database();let queries=[],blocked=false,used=0,subOverride={},transactions=[payment],verify='SUCCESS';
const actualNow=Date.now;const actualFetch=globalThis.fetch;
Date.now=()=>Date.parse('2026-10-18T12:00:00Z');
db.query=async(sql,args)=>{
  queries.push({sql,args});
  if(sql.includes('FROM paypal_config'))return {rows:[{plan_id:'P-TEST',webhook_id:'WH-TEST'}],rowCount:1};
  if(sql.includes('FROM paypal_subscriptions'))return {rows:[{subscription_id:'I-TEST',user_id:'user1'}],rowCount:1};
  if(sql.includes('FROM paypal_blocked_payments'))return {rows:blocked?[{payment_id:payment.id}]:[],rowCount:blocked?1:0};
  if(sql.includes('count(*)'))return {rows:[{used}],rowCount:1};
  return {rows:[],rowCount:0};
};
globalThis.fetch=async(url,options)=>{
  if(url.endsWith('/v1/oauth2/token'))return Response.json({access_token:'test-token',expires_in:3600});
  if(url.endsWith('/verify-webhook-signature'))return Response.json({verification_status:verify});
  if(url.includes('/transactions?'))return Response.json({transactions,total_pages:1});
  if(url.endsWith('/v1/billing/plans/P-TEST'))return Response.json(plan);
  if(url.endsWith('/v1/billing/subscriptions/I-TEST'))return Response.json({id:'I-TEST',plan_id:'P-TEST',custom_id:'itv:user1',quantity:'1',status:'ACTIVE',start_time:'2026-10-01T00:00:00Z',...subOverride});
  throw Error(`Unexpected provider request ${url}`);
};
test('replayed reconciliation uses the same billing period and preserves consumed credits',async()=>{
  used=3;const first=await paypalEntitlement({id:'user1'});const second=await paypalEntitlement({id:'user1'});
  assert.equal(first.remaining,7);assert.equal(first.periodId,second.periodId);assert.equal(second.remaining,7);
  const inserts=queries.filter(q=>q.sql.startsWith('INSERT INTO billing_periods'));assert.equal(inserts.length,2);assert.ok(inserts.every(q=>q.sql.includes('ON CONFLICT DO NOTHING')));
  assert.ok(queries.every(q=>!q.sql.includes('DELETE FROM conversion_uses')));
});
test('ownership, inline plan overrides, unapproved subscriptions and refunded payments fail closed',async()=>{
  for(const override of [{custom_id:'itv:other-user'},{plan_id:'P-OTHER'},{plan_overridden:true},{quantity:'2'},{status:'APPROVAL_PENDING'}]){subOverride=override;assert.equal((await paypalEntitlement({id:'user1'})).periodId,undefined)}
  subOverride={};blocked=true;assert.equal((await paypalEntitlement({id:'user1'})).remaining,0);blocked=false;
  transactions=[{...payment,status:'REFUNDED'}];assert.equal((await paypalEntitlement({id:'user1'})).remaining,0);transactions=[payment];
});
const headers={'paypal-auth-algo':'SHA256withRSA','paypal-cert-url':'https://api.paypal.com/cert','paypal-transmission-id':'TEST','paypal-transmission-sig':'TEST','paypal-transmission-time':'2026-10-18T12:00:00Z'};
async function notify(event,signature=true){const {Readable}=await import('node:stream');const req=Readable.from([Buffer.from(JSON.stringify(event))]);req.method='POST';req.headers=signature?headers:{};const res={writeHead(status){this.status=status},end(data){this.data=JSON.parse(data)}};await webhook(req,res);return res}
test('forged webhook requests do not touch the credit ledger',async()=>{
  queries=[];verify='FAILURE';const res=await notify({event_type:'PAYMENT.SALE.COMPLETED',resource:{billing_agreement_id:'I-TEST'}});
  assert.equal(res.status,400);assert.ok(!queries.some(q=>q.sql.startsWith('INSERT')));
  assert.equal((await notify({},false)).status,400);verify='SUCCESS';
});
test('signed refunds are durably recorded, including replayed events',async()=>{
  queries=[];const event={id:'EV-REFUND',event_type:'PAYMENT.SALE.REFUNDED',resource:{sale_id:'ABC123'}};
  assert.equal((await notify(event)).status,200);assert.equal((await notify(event)).status,200);
  const writes=queries.filter(q=>q.sql.startsWith('INSERT INTO paypal_blocked_payments'));assert.equal(writes.length,2);assert.ok(writes.every(q=>q.sql.includes('ON CONFLICT DO NOTHING')&&q.args[0]==='ABC123'));
});
test.after(async()=>{Date.now=actualNow;globalThis.fetch=actualFetch;await db.end()});
