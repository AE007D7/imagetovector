import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

const root = fileURLToPath(new URL('.', import.meta.url));
const staticRoot = resolve(root, 'dist');
const port = Number(process.env.PORT || 4174);
const apiId = process.env.VECTORIZER_API_ID || '';
const apiSecret = process.env.VECTORIZER_API_SECRET || '';
const hasPlaceholder = value => !value || /your_rotated_api_|replace_me|placeholder/i.test(value);
const credentialsReady = !hasPlaceholder(apiId) && !hasPlaceholder(apiSecret);
const maxUpload = 4 * 1024 * 1024;
const requestsByIp = new Map();
const allowedFormats = new Set(['svg', 'pdf', 'eps', 'dxf', 'png']);
const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon'
};

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

function rateLimited(ip) {
  const now = Date.now();
  const recent = (requestsByIp.get(ip) || []).filter(time => now - time < 60_000);
  if (recent.length >= 20) return true;
  recent.push(now);
  requestsByIp.set(ip, recent);
  return false;
}

async function vectorize(req, res) {
  if (!credentialsReady) {
    return sendJson(res, 503, { error: 'API credentials are not configured. Add your rotated API ID and secret to .env, then restart the server.' });
  }
  const ip = req.socket.remoteAddress || 'local';
  if (rateLimited(ip)) return sendJson(res, 429, { error: 'Too many conversion requests. Wait a minute and try again.' });
  const length = Number(req.headers['content-length'] || 0);
  if (length > maxUpload + 256_000) return sendJson(res, 413, { error: 'The upload must be 4 MB or smaller.' });
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('multipart/form-data;')) {
    return sendJson(res, 415, { error: 'Upload the image as multipart form data.' });
  }
  try {
    const request = new Request('http://localhost/api/vectorize', {
      method: 'POST', headers: req.headers, body: Readable.toWeb(req), duplex: 'half'
    });
    const incoming = await request.formData();
    const file = incoming.get('image');
    const format = String(incoming.get('output.file_format') || 'svg').toLowerCase();
    if (!(file instanceof Blob) || !file.size) return sendJson(res, 400, { error: 'Choose an image to vectorize.' });
    if (file.size > maxUpload) return sendJson(res, 413, { error: 'The upload must be 4 MB or smaller.' });
    if (!allowedFormats.has(format)) return sendJson(res, 400, { error: 'Choose SVG, PDF, EPS, DXF, or PNG output.' });
    const type = String(file.type || '').toLowerCase();
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'].includes(type)) {
      return sendJson(res, 415, { error: 'Use a PNG, JPG, WebP, GIF, or BMP image.' });
    }

    const upstreamForm = new FormData();
    upstreamForm.append('image', new Blob([await file.arrayBuffer()], { type }), file.name || 'image');
    for (const key of ['processing.max_colors', 'input.max_pixels', 'output.draw_style', 'output.shape_stacking', 'output.group_by', 'output.gap_filler.enabled', 'output.strokes.stroke_width']) {
      const value = incoming.get(key);
      if (value !== null) upstreamForm.append(key, String(value));
    }
    upstreamForm.set('mode', 'test');
    upstreamForm.set('output.file_format', format);
    // Do not request retention: user images are processed without being stored for later download.

    const auth = Buffer.from(`${apiId}:${apiSecret}`).toString('base64');
    const upstream = await fetch('https://api.vectorizer.ai/api/v1/vectorize', {
      method: 'POST', headers: { authorization: `Basic ${auth}` }, body: upstreamForm,
      signal: AbortSignal.timeout(180_000)
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    if (!upstream.ok) {
      let message = `Vectorizer.AI returned ${upstream.status}.`;
      try { message = JSON.parse(body.toString('utf8'))?.error?.message || message; } catch {}
      return sendJson(res, upstream.status, { error: message });
    }
    const types = { svg: 'image/svg+xml', png: 'image/png', pdf: 'application/pdf', eps: 'application/postscript', dxf: 'application/dxf' };
    res.writeHead(200, {
      'content-type': types[format], 'content-length': body.length,
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff'
    });
    res.end(body);
  } catch (error) {
    const status = error?.name === 'TimeoutError' ? 504 : 400;
    sendJson(res, status, { error: status === 504 ? 'Vectorization took too long. Please try again.' : 'Could not read this upload. Please choose another image.' });
  }
}

async function serveStatic(req, res) {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const requested = pathname === '/' ? '/index.html' : pathname;
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
  if (req.method === 'POST' && req.url?.split('?')[0] === '/api/vectorize') return void vectorize(req, res);
  if (req.method === 'GET' && req.url === '/api/health') return void sendJson(res, 200, { ready: credentialsReady, mode: 'test' });
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end('Method not allowed'); return; }
  return void serveStatic(req, res);
}).listen(port, '127.0.0.1', () => {
  console.log(`ImageToVector local API server: http://localhost:${port}`);
  console.log(`Vectorizer.AI test API: ${credentialsReady ? 'configured' : 'real rotated credentials needed in .env'}`);
});
