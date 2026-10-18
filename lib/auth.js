import { betterAuth } from 'better-auth';
import { magicLink } from 'better-auth/plugins';
import pg from 'pg';

let pool, auth;
export const origin = () => process.env.BETTER_AUTH_URL || 'https://imagetovector.org';
export const authReady = () => ['DATABASE_URL','BETTER_AUTH_SECRET','RESEND_API_KEY','AUTH_EMAIL_FROM'].every(key => Boolean(process.env[key]));
export function database() {
  if (!process.env.DATABASE_URL) throw new Error('Account database is not configured.');
  return pool ||= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 10000 });
}
export function getAuth() {
  if (!authReady()) throw new Error('Sign-in is not available yet.');
  return auth ||= betterAuth({
    appName: 'ImageToVector', baseURL: origin(), secret: process.env.BETTER_AUTH_SECRET,
    database: database(), trustedOrigins: [origin()],
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 30 },
    plugins: [magicLink({ expiresIn: 600, storeToken: 'hashed', rateLimit: { window: 60, max: 3 },
      sendMagicLink: async ({ email, url }) => {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: process.env.AUTH_EMAIL_FROM, to: [email], subject: 'Sign in to ImageToVector',
            text: `Sign in to your ImageToVector account:\n\n${url}\n\nThis link expires in 10 minutes and can be used once. If you did not request it, ignore this email.` }),
          signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) throw new Error('Could not send the sign-in email. Please try again.');
      }
    })]
  });
}
export async function sessionFor(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  return getAuth().api.getSession({ headers });
}
