import { authReady, sessionFor, origin } from '../lib/auth.js';
import { billingReady, entitlement, customerFor, stripe, checkout } from '../lib/billing.js';
import { json, sameOrigin, body } from '../lib/http.js';
export const config = { api: { bodyParser: false } };
export default async function handler(req,res) {
  if (!['GET','POST'].includes(req.method)) return json(res,405,{error:'Method not allowed.'});
  if (!authReady()) return json(res,200,{ready:false,billingReady:false,user:null});
  try {
    const session=await sessionFor(req);
    if (req.method==='GET') {
      const billing=session && billingReady()?await entitlement(session.user):null;
      return json(res,200,{ready:true,billingReady:billingReady(),user:session?{name:session.user.name,email:session.user.email}:null,billing});
    }
    if (!sameOrigin(req)) return json(res,403,{error:'Open your account on this website to continue.'});
    if (!session) return json(res,401,{error:'Please sign in first.'});
    if (!billingReady()) return json(res,503,{error:'Subscriptions are not available yet.'});
    const { action }=JSON.parse((await body(req)).toString());
    if (action==='checkout') return json(res,200,{url:await checkout(session.user,origin())});
    if (action==='portal') {
      const customer=await customerFor(session.user);
      if (!customer) return json(res,400,{error:'No billing account yet.'});
      const portal=await stripe().billingPortal.sessions.create({customer,configuration:process.env.STRIPE_PORTAL_CONFIGURATION_ID,return_url:`${origin()}/account/`});
      return json(res,200,{url:portal.url});
    }
    return json(res,400,{error:'Unknown action.'});
  } catch(error) { return json(res,error.status||503,{error:error.status?error.message:'Your account is temporarily unavailable. Please try again.'}); }
}
