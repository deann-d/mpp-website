/**
 * Driver Upstash Redis / Vercel KV — HTTP REST, tanpa dependensi npm.
 * Vercel KV adalah Upstash Redis, jadi env var berikut tersedia otomatis
 * setelah kamu membuat store KV di dashboard Vercel:
 *   KV_REST_API_URL   (atau UPSTASH_REDIS_REST_URL)
 *   KV_REST_API_TOKEN (atau UPSTASH_REDIS_REST_TOKEN)
 */
'use strict';

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

function isConfigured() {
  return Boolean(URL_ && TOKEN);
}

/** Kirim satu perintah Redis. */
async function cmd(...args) {
  if (!isConfigured()) {
    const e = new Error('KV belum dikonfigurasi. Set KV_REST_API_URL & KV_REST_API_TOKEN di Vercel.');
    e.code = 'KV_NOT_CONFIGURED';
    throw e;
  }
  const res = await fetch(`${URL_.replace(/\/$/, '')}/${encodeURIComponent(args[0])}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args.slice(1))
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new Error(`Redis ${args[0]} gagal: ${json.error || res.status}`);
  }
  return json.result;
}

/** Kirim banyak perintah dalam satu round-trip (pipeline Upstash). */
async function pipeline(commands) {
  if (!isConfigured()) {
    const e = new Error('KV belum dikonfigurasi.');
    e.code = 'KV_NOT_CONFIGURED';
    throw e;
  }
  const res = await fetch(`${URL_.replace(/\/$/, '')}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands)
  });
  const json = await res.json().catch(() => []);
  if (!res.ok) throw new Error(`Pipeline gagal: ${res.status}`);
  return Array.isArray(json) ? json.map((r) => (r && 'result' in r ? r.result : r)) : [];
}

module.exports = { cmd, pipeline, isConfigured };
