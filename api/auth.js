import { toNodeHandler } from 'better-auth/node';
import { authReady, getAuth } from '../lib/auth.js';
import { json } from '../lib/http.js';
export const config = { api: { bodyParser: false } };
export default async function handler(req, res) {
  if (!authReady()) return json(res, 503, { error: 'Account sign-in is being connected. Please try again later.' });
  try { return await toNodeHandler(getAuth())(req, res); }
  catch { if (!res.headersSent) json(res, 503, { error: 'Sign-in is temporarily unavailable. Please try again.' }); }
}
