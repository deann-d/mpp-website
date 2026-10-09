/** GET /api/health — health check */
'use strict';
const { json } = require('./_lib/http');
const { isConfigured } = require('./_lib/kv');
module.exports = function handler(req, res) {
  return json(res, 200, { ok: true, service: 'mpp-api-vercel', kv_configured: isConfigured(), time: new Date().toISOString() });
};
