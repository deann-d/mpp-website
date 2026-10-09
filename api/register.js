/** POST /api/register — pendaftaran mitra + alokasi kode resmi (FIFO dari pool 200) */
'use strict';
const { json, clientMeta, kvNotConfigured } = require('./_lib/http');
const { isConfigured } = require('./_lib/kv');
const { registerPartner } = require('./_lib/store');
module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Gunakan metode POST' });
  if (!isConfigured()) return kvNotConfigured(res);
  try {
    const out = await registerPartner(req.body || {}, clientMeta(req));
    return json(res, out.status, out.body);
  } catch (e) {
    return json(res, 500, { ok: false, error: 'Kesalahan server: ' + e.message });
  }
};
