import { Readable } from 'node:stream';

export const config = { api: { bodyParser: false }, maxDuration: 60 };

const maxUpload = 4 * 1024 * 1024;
const allowedFormats = new Set(['svg', 'pdf', 'eps', 'dxf', 'png']);
const requestsByIp = new Map();
const hasPlaceholder = value => !value || /your_rotated_api_|replace_me|placeholder/i.test(value);

function rateLimited(ip) {
  const now = Date.now();
  const recent = (requestsByIp.get(ip) || []).filter(time => now - time < 60_000);
  if (recent.length >= 20) return true;
  recent.push(now);
  requestsByIp.set(ip, recent);
  return false;
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Use POST to vectorize an image.' });

  const apiId = process.env.VECTORIZER_API_ID || '';
  const apiSecret = process.env.VECTORIZER_API_SECRET || '';
  if (hasPlaceholder(apiId) || hasPlaceholder(apiSecret)) {
    return sendJson(res, 503, { error: 'Vectorization is not configured yet. Please try again later.' });
  }

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (rateLimited(ip)) return sendJson(res, 429, { error: 'Too many conversion requests. Wait a minute and try again.' });

  const length = Number(req.headers['content-length'] || 0);
  if (length > maxUpload + 256_000) return sendJson(res, 413, { error: 'The upload must be 4 MB or smaller.' });
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('multipart/form-data;')) {
    return sendJson(res, 415, { error: 'Upload the image as multipart form data.' });
  }

  try {
    const incomingRequest = new Request('https://imagetovector.org/api/vectorize', {
      method: 'POST', headers: req.headers, body: Readable.toWeb(req), duplex: 'half'
    });
    const incoming = await incomingRequest.formData();
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

    const auth = Buffer.from(`${apiId}:${apiSecret}`).toString('base64');
    const upstream = await fetch('https://api.vectorizer.ai/api/v1/vectorize', {
      method: 'POST', headers: { authorization: `Basic ${auth}` }, body: upstreamForm,
      signal: AbortSignal.timeout(55_000)
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
