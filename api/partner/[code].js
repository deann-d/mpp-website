/** GET /api/partner/:code — data & statistik mitra untuk dashboard */
'use strict';
const { json, clientMeta, kvNotConfigured } = require('../_lib/http');
const { isConfigured } = require('../_lib/kv');
const { getPartner } = require('../_lib/store');
module.exports = async function handler(req, res) {
  if (!isConfigured()) return kvNotConfigured(res);
  try {
    const code = req.query && req.query.code;
    const data = await getPartner(code, req.headers['x-partner-pin'], clientMeta(req));
    if (data && data.rateLimited) return json(res, 429, { ok: false, error: 'Terlalu banyak permintaan. Coba lagi beberapa menit lagi.' });
    if (!data) return json(res, 401, { ok: false, error: 'Kode atau PIN salah' });
    return json(res, 200, data);
  } catch (e) {
    return json(res, 500, { ok: false, error: 'Kesalahan server: ' + e.message });
  }
};
