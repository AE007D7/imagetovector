import { authReady, sessionFor, origin } from '../lib/auth.js';
import { billingReady, stripeConfigured, entitlement, customerFor, stripe, checkout } from '../lib/billing.js';
import { paypalConfigured, paypalConfig, paypalRecord, paypalManageURL } from '../lib/paypal.js';
import { json, sameOrigin, body } from '../lib/http.js';
export const config = { api: { bodyParser: false } };
export default async function handler(req,res) {
  if (!['GET','POST'].includes(req.method)) return json(res,405,{error:'Method not allowed.'});
  if (!authReady()) return json(res,200,{ready:false,billingReady:false,user:null});
  try {
    const session=await sessionFor(req);
    if (req.method==='GET') {
      let billing=null, billingWarning=null;
      if (session && billingReady()) {
        try { billing=await entitlement(session.user); }
        catch(error) {
          console.error('Billing lookup failed', {code:error.providerCode || error.code || 'unavailable'});
          billingWarning='We could not refresh your subscription. You can still manage your account. Please retry shortly.';
          const paypal=await paypalRecord(session.user).catch(()=>null);
          billing={provider:paypal?'paypal':null,customer:Boolean(paypal),status:'unavailable',remaining:0,periodEnd:null};
        }
      }
      return json(res,200,{ready:true,billingReady:billingReady(),stripeReady:billingReady() && stripeConfigured(),paypalReady:billingReady() && paypalConfigured() && Boolean((await paypalConfig())?.webhook_id),user:session?{name:session.user.name,email:session.user.email}:null,billing,billingWarning});
    }
    if (!sameOrigin(req)) return json(res,403,{error:'Open your account on this website to continue.'});
    if (!session) return json(res,401,{error:'Please sign in first.'});
    if (!billingReady()) return json(res,503,{error:'Subscriptions are not available yet.'});
    const { action }=JSON.parse((await body(req)).toString());
    if (action==='paypal-checkout') return json(res,200,{url:await checkout(session.user,origin(),'paypal')});
    if (action==='paypal-portal') {
      if (!await paypalRecord(session.user)) return json(res,400,{error:'No PayPal subscription yet.'});
      return json(res,200,{url:paypalManageURL()});
    }
    if (action==='checkout') return json(res,200,{url:await checkout(session.user,origin())});
    if (action==='portal') {
      if (!stripeConfigured()) return json(res,503,{error:'Card billing is not available.'});
      const customer=await customerFor(session.user);
      if (!customer) return json(res,400,{error:'No billing account yet.'});
      const portal=await stripe().billingPortal.sessions.create({customer,configuration:process.env.STRIPE_PORTAL_CONFIGURATION_ID,return_url:`${origin()}/account/`});
      return json(res,200,{url:portal.url});
    }
    return json(res,400,{error:'Unknown action.'});
  } catch(error) { return json(res,error.status||503,{error:error.status?error.message:'Your account is temporarily unavailable. Please try again.'}); }
}
