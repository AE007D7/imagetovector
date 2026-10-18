import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import vectorize from './api/vectorize.js';
import account from './api/account.js';
import auth from './api/auth.js';
import webhook from './api/stripe-webhook.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const staticRoot = resolve(root, 'dist');
const port = Number(process.env.PORT || 4174);
const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon'
};


async function serveStatic(req, res) {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const requested = pathname.endsWith('/') ? pathname + 'index.html' : pathname;
  let file = resolve(staticRoot, `.${decodeURIComponent(requested)}`);
  if (file !== staticRoot && !file.startsWith(staticRoot + sep)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': mimeTypes[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

createServer((req, res) => {
  const path = req.url?.split('?')[0];
  if (path === '/api/vectorize') return void vectorize(req, res);
  if (path === '/api/account') return void account(req, res);
  if (path?.startsWith('/api/auth/')) return void auth(req, res);
  if (path === '/api/stripe-webhook') return void webhook(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end('Method not allowed'); return; }
  return void serveStatic(req, res);
}).listen(port, '127.0.0.1', () => console.log(`ImageToVector: http://localhost:${port}`));
