import { stripe, entitlement } from '../lib/billing.js';
import { database } from '../lib/auth.js';
import { json, body } from '../lib/http.js';
export const config = { api: { bodyParser: false } };
export default async function handler(req,res) {
  if (req.method!=='POST') return json(res,405,{error:'Method not allowed.'});
  if (!process.env.STRIPE_WEBHOOK_SECRET) return json(res,503,{error:'Webhook not configured.'});
  let event;
  try { event=stripe().webhooks.constructEvent(await body(req,1048576),req.headers['stripe-signature'],process.env.STRIPE_WEBHOOK_SECRET); }
  catch { return json(res,400,{error:'Invalid webhook signature.'}); }
  const relevant=['invoice.paid','invoice.payment_failed','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','checkout.session.completed','checkout.session.async_payment_succeeded'];
  if (!relevant.includes(event.type)) return json(res,200,{received:true});
  try {
    const object=event.data.object;
    if (event.type.startsWith('checkout.') && object.payment_status!=='paid') return json(res,200,{received:true});
    const customer=typeof object.customer==='string'?object.customer:object.customer?.id;
    const {rows}=await database().query('SELECT user_id FROM billing_customers WHERE customer_id=$1',[customer]);
    // Refresh current Stripe state. Duplicate or out-of-order events cannot reset usage.
    if (rows[0]) await entitlement({id:rows[0].user_id});
    return json(res,200,{received:true});
  } catch { return json(res,503,{error:'Could not sync billing. Retry this event.'}); }
}
