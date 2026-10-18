import { paypalAPI, paypalConfig, paypalEntitlement } from '../lib/paypal.js';
import { database } from '../lib/auth.js';
import { json, body } from '../lib/http.js';
export const config = { api: { bodyParser: false } };
export default async function handler(req,res) {
  if (req.method !== 'POST') return json(res,405,{error:'Method not allowed.'});
  try {
    const config=await paypalConfig();
    if (!config?.webhook_id) return json(res,503,{error:'PayPal webhook is not configured.'});
    let event;
    try { event=JSON.parse((await body(req,1048576)).toString()); }
    catch { return json(res,400,{error:'Invalid webhook body.'}); }
    const headers=req.headers;
    if (!['paypal-auth-algo','paypal-cert-url','paypal-transmission-id','paypal-transmission-sig','paypal-transmission-time'].every(k=>typeof headers[k]==='string' && headers[k].length>0)) return json(res,400,{error:'Missing webhook signature.'});
    const verification=await paypalAPI('/v1/notifications/verify-webhook-signature','POST',{
      auth_algo:headers['paypal-auth-algo'],cert_url:headers['paypal-cert-url'],transmission_id:headers['paypal-transmission-id'],
      transmission_sig:headers['paypal-transmission-sig'],transmission_time:headers['paypal-transmission-time'],webhook_id:config.webhook_id,webhook_event:event
    });
    if (verification.verification_status!=='SUCCESS') return json(res,400,{error:'Invalid webhook signature.'});
    const resource=event.resource || {};
    if (['PAYMENT.SALE.REFUNDED','PAYMENT.SALE.REVERSED'].includes(event.event_type)) {
      const paymentId=resource.sale_id || (event.event_type==='PAYMENT.SALE.REVERSED'?resource.id:null);
      if (!paymentId) return json(res,503,{error:'Could not identify reversed payment.'});
      await database().query('INSERT INTO paypal_blocked_payments(payment_id,event_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[paymentId,event.id]);
    }
    // A signed event is a notification, not an entitlement: fetch fresh merchant API state.
    const id=event.event_type?.startsWith('BILLING.SUBSCRIPTION.')?resource.id:resource.billing_agreement_id;
    if (id) {
      const {rows}=await database().query('SELECT user_id FROM paypal_subscriptions WHERE subscription_id=$1',[id]);
      if (rows[0]) await paypalEntitlement({id:rows[0].user_id});
    }
    return json(res,200,{received:true});
  } catch { return json(res,503,{error:'Could not sync PayPal billing. Retry this event.'}); }
}
