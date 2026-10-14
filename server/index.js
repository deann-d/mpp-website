#!/usr/bin/env node
/* ============================================================
   MPP API SERVER — Kesatria Academy Marketing Partner Program
   ------------------------------------------------------------
   Node.js murni (tanpa dependensi npm). Menjalankan:
     1. Static file server (index.html, daftar.html, dashboard.html)
     2. REST API:
        POST /api/register          → pendaftaran mitra + alokasi kode resmi
        GET  /api/partner/:code     → data & performa mitra (untuk dashboard)
        POST /api/track             → pencatatan klik referral (first-click)
        GET  /api/health            → health check (untuk uptime monitor)
        GET  /api/admin/stats       → ringkasan program (proteksi ADMIN_TOKEN)
   3. Penyimpanan: JSON file (server/data/db.json) — cocok untuk pilot.
      Untuk produksi skala besar, migrasikan ke PostgreSQL
      (skema siap pakai: database/schema.sql).

   Cara menjalankan:
     node server/index.js          → http://localhost:3000
   Environment:
     PORT=3000
     ADMIN_TOKEN=rahasia           (untuk endpoint admin)
     BASE_PUBLIC_URL=https://mpp.kesatriaacademy.id
   ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MAX_BODY_BYTES, isRecord, sanitizeRegister, validateConsents, sanitizeTrack } = require('../api/_lib/validate');

const ROOT = path.resolve(__dirname, '..', 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const CODES_FILE = path.join(__dirname, 'ref-codes.json');

const PORT = parseInt(process.env.PORT || '3000', 10);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const PUBLIC_URL = process.env.BASE_PUBLIC_URL || '';

const COMMISSION_PER_CLOSING = 458500; // ilustrasi resmi dokumen (7% x Rp6.550.000)
const BOOTCAMP_PRICE = 6550000;


/* ---------------- Keamanan: PIN, enkripsi rekening, rate limit ---------------- */
const DATA_KEY = process.env.DATA_KEY ? crypto.createHash('sha256').update(process.env.DATA_KEY).digest() : null;
const PIN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newPin() { let s = ''; for (let i = 0; i < 8; i++) s += PIN_ALPHABET[crypto.randomInt(PIN_ALPHABET.length)]; return s; }
function pinHash(pin, salt) { return crypto.createHash('sha256').update(salt + ':' + String(pin).toUpperCase().trim()).digest('hex'); }
function safeEq(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }
function protectAccount(v) {
  v = String(v || '').trim();
  if (!v) return '';
  if (!DATA_KEY) return '****' + v.replace(/\s/g, '').slice(-4); // tanpa DATA_KEY: simpan 4 digit terakhir saja
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', DATA_KEY, iv);
  const enc = Buffer.concat([c.update(v, 'utf8'), c.final()]);
  return 'enc:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
const HITS = new Map();
function limited(req, name, max, windowMs) {
  const k = name + ':' + clientIp(req), now = Date.now();
  const arr = (HITS.get(k) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) { HITS.set(k, arr); return true; }
  arr.push(now); HITS.set(k, arr); return false;
}
const TOO_MANY = { ok: false, error: 'Terlalu banyak permintaan. Coba lagi beberapa menit lagi.' };

/* ---------------- DB helpers (JSON file) ---------------- */
function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const codes = JSON.parse(fs.readFileSync(CODES_FILE, 'utf8'));
    fs.writeFileSync(DB_FILE, JSON.stringify({
      partners: [],
      code_pool: codes.map(c => ({ code: c.code, no: c.no, allocated_to: null, allocated_at: null, is_active: false })),
      clicks: [],
      created_at: new Date().toISOString()
    }, null, 2));
  }
}
function readDb() { ensureDb(); return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
function writeDb(db) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE); // atomic write
}

/* ---------------- HTTP helpers ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.txt': 'text/plain', '.xml': 'application/xml', '.woff2': 'font/woff2'
};
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...(PUBLIC_URL ? { 'Access-Control-Allow-Origin': PUBLIC_URL } : {}),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Partner-Pin',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let bytes = 0;
    let settled = false;
    req.on('data', chunk => {
      if (settled) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_BODY_BYTES) {
        settled = true;
        req.pause();
        const error = new Error('Ukuran body melebihi batas 65536 byte (64 KiB).');
        error.status = 413;
        reject(error);
        return;
      }
      data += chunk.toString();
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        const body = data ? JSON.parse(data) : {};
        if (!isRecord(body)) {
          const error = new Error('Body permintaan harus berupa objek JSON.');
          error.status = 400;
          reject(error);
        } else resolve(body);
      } catch (cause) {
        const error = new Error('Body permintaan bukan JSON yang valid.');
        error.status = 400;
        reject(error);
      }
    });
    req.on('error', error => { if (!settled) reject(error); });
  });
}
function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
}
function hashProspect(v) {
  return crypto.createHash('sha256').update(String(v).toLowerCase().trim()).digest('hex').slice(0, 24);
}
function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim()); }
function validWa(w) { const v = String(w || '').replace(/[^0-9]/g, ''); return v.length >= 10 && v.length <= 15; }

/* ---------------- API: register ---------------- */
async function handleRegister(req, res) {
  const input = await readBody(req);
  if (limited(req, 'register', 20, 3600e3)) return sendJson(res, 429, TOO_MANY);
  if (input.website) return sendJson(res, 400, { ok: false, error: 'Permintaan ditolak' });
  const sanitized = sanitizeRegister(input);
  if (!sanitized.ok) return sendJson(res, 400, { ok: false, error: sanitized.error });
  const b = sanitized.value;
  const required = ['nama', 'email', 'whatsapp', 'status', 'institusi'];
  for (const k of required) {
    if (!String(b[k] || '').trim()) return sendJson(res, 400, { ok: false, error: 'Field wajib kosong: ' + k });
  }
  if (!validEmail(b.email)) return sendJson(res, 400, { ok: false, error: 'Format email tidak valid' });
  if (!validWa(b.whatsapp)) return sendJson(res, 400, { ok: false, error: 'Nomor WhatsApp tidak valid' });
  const consents = validateConsents(b);
  if (!consents.ok) return sendJson(res, 400, { ok: false, error: consents.error });

  const db = readDb();
  const email = String(b.email).trim().toLowerCase();
  if (db.partners.some(p => p.email.toLowerCase() === email)) {
    return sendJson(res, 409, { ok: false, error: 'Email sudah terdaftar sebagai mitra' });
  }

  // Alokasi kode resmi dari pool lampiran dokumen (FIFO)
  const slot = db.code_pool.find(c => !c.allocated_to);
  if (!slot) return sendJson(res, 503, { ok: false, error: 'Pool kode referral habis — hubungi tim MPP' });

  const pin = newPin(), pinSalt = crypto.randomBytes(8).toString('hex');
  const partner = {
    id: crypto.randomUUID(),
    ref_code: slot.code,
    nama: String(b.nama).trim(), email, whatsapp: String(b.whatsapp).trim(),
    kota: b.kota || '', status: b.status, institusi: b.institusi,
    jurusan: b.jurusan || '', semester: b.semester || '',
    akun_sosmed: b.akun_sosmed || '', sosmed: b.sosmed || '',
    motivasi: b.motivasi || '',
    metode_bayar: b.metode_bayar || '', nama_rekening: b.nama_rekening || '', no_rekening: protectAccount(b.no_rekening),
    pin_salt: pinSalt, pin_hash: pinHash(pin, pinSalt),
    setuju_etika: true, setuju_data: true, setuju_status: true,
    tier: 'starter', lifecycle: 'menunggu_verifikasi',
    ip_pendaftar: clientIp(req), user_agent: String(req.headers['user-agent'] || '').slice(0, 300),
    created_at: new Date().toISOString()
  };
  slot.allocated_to = partner.id;
  slot.allocated_at = partner.created_at;
  db.partners.push(partner);
  writeDb(db);

  const base = PUBLIC_URL || (req.headers.origin || '');
  sendJson(res, 201, {
    ok: true,
    message: 'Pendaftaran diterima. Tim MPP akan menghubungi via WhatsApp/Email maksimal 1x24 jam kerja.',
    ref_code: partner.ref_code,
    access_pin: pin,
    ref_link: base + '/index.html?ref=' + partner.ref_code,
    next_steps: [
      'Cek WhatsApp/Email untuk undangan onboarding produk (±1-2 jam)',
      'Selesaikan onboarding & kuis pemahaman produk',
      'Kode referral diaktifkan + terima kit marketing',
      'Mulai promosi dan pantau di Dashboard Mitra'
    ]
  });
}

/* ---------------- API: partner lookup ---------------- */
function handlePartner(req, res, code) {
  if (limited(req, 'pin', 30, 600e3)) return sendJson(res, 429, TOO_MANY);
  const db = readDb();
  const p = db.partners.find(x => x.ref_code.toUpperCase() === String(code).toUpperCase());
  const isDemo = String(code).toUpperCase() === 'KSA-DEMO-MPP';
  if (!isDemo) {
    const pin = req.headers['x-partner-pin'];
    if (!p || !pin || !p.pin_hash || !safeEq(pinHash(pin, p.pin_salt), p.pin_hash)) {
      return sendJson(res, 401, { ok: false, error: 'Kode atau PIN salah' });
    }
  }

  const clicks = db.clicks.filter(c => c.ref_code.toUpperCase() === String(code).toUpperCase());
  const base = PUBLIC_URL || '';

  if (isDemo) {
    // Data contoh untuk presentasi/demo
    return sendJson(res, 200, {
      ok: true, demo: true,
      partner: { ref_code: 'KSA-DEMO-MPP', nama: 'Mitra Demo', tier: 'active', lifecycle: 'aktif' },
      stats: { clicks: 342 + clicks.length, konsultasi: 58, closing: 7, komisi_bulan_ini: 7 * COMMISSION_PER_CLOSING + 7 * BOOTCAMP_PRICE * 0.05 },
      ref_link: base + '/index.html?ref=KSA-DEMO-MPP'
    });
  }

  const closing = 0; // diisi dari verifikasi tim admisi (produksi: query DB closings)
  sendJson(res, 200, {
    ok: true, demo: false,
    partner: {
      ref_code: p.ref_code, nama: p.nama, tier: p.tier, lifecycle: p.lifecycle,
      institusi: p.institusi, status: p.status, terdaftar_sejak: p.created_at
    },
    stats: {
      clicks: clicks.length,
      konsultasi: 0,
      closing,
      komisi_bulan_ini: closing * COMMISSION_PER_CLOSING
    },
    ref_link: base + '/index.html?ref=' + p.ref_code,
    catatan: 'Statistik klik tercatat real-time. Data konsultasi & closing diperbarui setelah verifikasi tim admisi.'
  });
}

/* ---------------- API: track click (first-click attribution) ---------------- */
async function handleTrack(req, res) {
  const input = await readBody(req);
  if (limited(req, 'track', 120, 60e3)) return sendJson(res, 429, TOO_MANY);
  const sanitized = sanitizeTrack(input);
  if (!sanitized.ok) return sendJson(res, 400, { ok: false, error: sanitized.error });
  const b = sanitized.value;
  const code = b.ref_code;

  const db = readDb();
  const prospectKey = b.prospect ? hashProspect(b.prospect) : null;

  // First-click attribution: jika prospek sudah tercatat utk mitra lain, jangan timpa
  if (prospectKey) {
    const existing = db.clicks.find(c => c.prospect_key === prospectKey);
    if (existing) {
      return sendJson(res, 200, { ok: true, attributed_to: existing.ref_code, first_click: false });
    }
  }
  db.clicks.push({
    ref_code: code, prospect_key: prospectKey,
    utm_source: b.utm_source || '', utm_medium: b.utm_medium || '', utm_campaign: b.utm_campaign || '',
    landing_url: b.landing_url || '', ip: clientIp(req),
    user_agent: String(req.headers['user-agent'] || '').slice(0, 300),
    clicked_at: new Date().toISOString()
  });
  writeDb(db);
  sendJson(res, 201, { ok: true, attributed_to: code, first_click: true });
}

/* ---------------- API: admin stats ---------------- */
function handleAdmin(req, res) {
  if (!ADMIN_TOKEN) return sendJson(res, 503, { ok: false, error: 'ADMIN_TOKEN belum dikonfigurasi' });
  const auth = String(req.headers.authorization || '').replace('Bearer ', '');
  if (!safeEq(auth, ADMIN_TOKEN)) return sendJson(res, 401, { ok: false, error: 'Tidak terautentikasi' });
  const db = readDb();
  const allocated = db.code_pool.filter(c => c.allocated_to).length;
  sendJson(res, 200, {
    ok: true,
    total_mitra: db.partners.length,
    menunggu_verifikasi: db.partners.filter(p => p.lifecycle === 'menunggu_verifikasi').length,
    aktif: db.partners.filter(p => p.lifecycle === 'aktif').length,
    total_klik: db.clicks.length,
    kode_terpakai: allocated,
    kode_tersedia: db.code_pool.length - allocated,
    per_tier: {
      starter: db.partners.filter(p => p.tier === 'starter').length,
      active: db.partners.filter(p => p.tier === 'active').length,
      lead: db.partners.filter(p => p.tier === 'lead').length
    }
  });
}

/* ---------------- Static server ---------------- */
function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  if (!path.extname(urlPath)) urlPath += '.html'; // /daftar → /daftar.html
  const filePath = path.join(ROOT, path.normalize(urlPath));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.readFile(path.join(ROOT, '404.html'), (e2, b2) =>
        res.end(e2 ? '<h1>404 — Halaman tidak ditemukan</h1>' : b2));
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(buf);
  });
}

/* ---------------- Router ---------------- */
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return sendJson(res, 204, {});
    const url = req.url.split('?')[0];

    if (url === '/api/health') return sendJson(res, 200, { ok: true, service: 'mpp-api', time: new Date().toISOString() });
    if (url === '/api/register' && req.method === 'POST') return await handleRegister(req, res);
    if (url === '/api/track' && req.method === 'POST') return await handleTrack(req, res);
    if (url === '/api/admin/stats' && req.method === 'GET') return handleAdmin(req, res);
    const m = url.match(/^\/api\/partner\/([A-Za-z0-9-]+)$/);
    if (m && req.method === 'GET') return handlePartner(req, res, m[1]);

    if (url.startsWith('/api/')) return sendJson(res, 404, { ok: false, error: 'Endpoint tidak ditemukan' });
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    return serveStatic(req, res);
  } catch (e) {
    if (e.status === 413) {
      sendJson(res, 413, { ok: false, error: e.message });
      res.once('finish', () => { if (!req.destroyed) req.destroy(); });
      return;
    }
    if (e.status === 400) return sendJson(res, 400, { ok: false, error: e.message });
    return sendJson(res, 500, { ok: false, error: 'Kesalahan server: ' + e.message });
  }
});

ensureDb();
if (!DATA_KEY) console.warn('[MPP] DATA_KEY belum diset: nomor rekening hanya disimpan 4 digit terakhir.');
server.listen(PORT, () => {
  console.log('==============================================');
  console.log(' MPP Server — Kesatria Academy');
  console.log(' Website + API berjalan di http://localhost:' + PORT);
  console.log(' Mode: JSON file DB (' + DB_FILE + ')');
  console.log('==============================================');
});
