/** Helper respons HTTP untuk serverless function Vercel. */
'use strict';

function corsHeaders() {
  const h = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Partner-Pin',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Cache-Control': 'no-store'
  };
  if (process.env.BASE_PUBLIC_URL) h['Access-Control-Allow-Origin'] = process.env.BASE_PUBLIC_URL;
  return h;
}

function json(res, status, obj) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  for (const [k, v] of Object.entries(corsHeaders())) res.setHeader(k, v);
  return res.status(status).json(obj);
}

function clientMeta(req) {
  const fwd = req.headers['x-forwarded-for'];
  return {
    ip: (typeof fwd === 'string' ? fwd.split(',')[0].trim() : '') || '',
    ua: String(req.headers['user-agent'] || '')
  };
}

function kvNotConfigured(res) {
  return json(res, 503, {
    ok: false,
    error: 'Database KV belum dikonfigurasi di Vercel. Buat store KV (Storage) lalu redeploy — lihat DEPLOY-VERCEL.md langkah 4.',
    hint: 'Pendaftaran belum bisa diproses sampai database dikonfigurasi.'
  });
}

module.exports = { json, clientMeta, kvNotConfigured, corsHeaders };
