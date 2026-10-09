/** GET /api/admin/stats — ringkasan program, wajib Bearer ADMIN_TOKEN */
'use strict';
const { json, kvNotConfigured } = require('../_lib/http');
const { isConfigured } = require('../_lib/kv');
const { adminStats } = require('../_lib/store');
module.exports = async function handler(req, res) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return json(res, 503, { ok: false, error: 'ADMIN_TOKEN belum diset di environment Vercel' });
  const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (auth !== token) return json(res, 401, { ok: false, error: 'Tidak terautentikasi' });
  if (!isConfigured()) return kvNotConfigured(res);
  try {
    return json(res, 200, { ok: true, ...(await adminStats()) });
  } catch (e) {
    return json(res, 500, { ok: false, error: 'Kesalahan server: ' + e.message });
  }
};
