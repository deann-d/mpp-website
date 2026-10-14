/** POST /api/track — catat klik referral, first-click attribution */
'use strict';
const { json, clientMeta, kvNotConfigured } = require('./_lib/http');
const { isConfigured } = require('./_lib/kv');
const { trackClick } = require('./_lib/store');
const { isRecord, bodyTooLarge } = require('./_lib/validate');
module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Gunakan metode POST' });
  if (!isConfigured()) return kvNotConfigured(res);
  try {
    const body = req.body == null ? {} : req.body;
    // Platform sudah mengurai body sebelum handler; ini lapisan tambahan untuk ukuran payload.
    if (bodyTooLarge(body)) return json(res, 413, { ok: false, error: 'Ukuran body melebihi batas 65536 byte (64 KiB).' });
    if (!isRecord(body)) return json(res, 400, { ok: false, error: 'Body permintaan harus berupa objek JSON.' });
    const out = await trackClick(body, clientMeta(req));
    return json(res, out.status, out.body);
  } catch (e) {
    return json(res, 500, { ok: false, error: 'Kesalahan server: ' + e.message });
  }
};
