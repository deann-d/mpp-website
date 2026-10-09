/**
 * Logika bisnis MPP di atas KV (dipakai seluruh serverless function).
 * Struktur key Redis:
 *   mpp:pool                 LIST  — 200 kode resmi (Lampiran S), FIFO via LPOP
 *   mpp:pool:seeded          STRING— penanda pool sudah di-seed
 *   mpp:partner:{CODE}       HASH  — data mitra
 *   mpp:email:{email}        STRING— kunci anti duplikat email
 *   mpp:partners             SET   — daftar kode mitra terdaftar
 *   mpp:prospect:{hash}      STRING— first-click attribution (SET NX)
 *   mpp:clicks:{CODE}        STRING— counter klik
 *   mpp:clicklog:{CODE}      LIST  — detail klik (maks 500)
 */
'use strict';

const { cmd, pipeline } = require('./kv');
const crypto = require('crypto');
const OFFICIAL_CODES = require('../_data/codes');

const POOL_KEY = 'mpp:pool';
const SEEDED_KEY = 'mpp:pool:seeded';

/* ---------- keamanan: PIN, enkripsi rekening, rate limit ---------- */
const DATA_KEY = process.env.DATA_KEY ? crypto.createHash('sha256').update(process.env.DATA_KEY).digest() : null;
const PIN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newPin() { let s = ''; for (let i = 0; i < 8; i++) s += PIN_ALPHABET[crypto.randomInt(PIN_ALPHABET.length)]; return s; }
function pinHash(pin, salt) { return crypto.createHash('sha256').update(salt + ':' + String(pin).toUpperCase().trim()).digest('hex'); }
function safeEq(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }
function protectAccount(v) {
  v = String(v || '').trim();
  if (!v) return '';
  if (!DATA_KEY) return '****' + v.replace(/\s/g, '').slice(-4);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', DATA_KEY, iv);
  const enc = Buffer.concat([c.update(v, 'utf8'), c.final()]);
  return 'enc:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
async function rateLimited(key, max, sec) {
  const [n] = await pipeline([['INCR', key], ['EXPIRE', key, sec]]);
  return Number(n) > max;
}
const TOO_MANY = { status: 429, body: { ok: false, error: 'Terlalu banyak permintaan. Coba lagi beberapa menit lagi.' } };


/* ---------- seeding pool kode resmi (idempoten) ---------- */
async function ensureSeeded() {
  const seeded = await cmd('GET', SEEDED_KEY);
  if (seeded) return false;
  // RPUSH per batch agar payload tidak terlalu besar
  const CH = 100;
  for (let i = 0; i < OFFICIAL_CODES.length; i += CH) {
    await cmd('RPUSH', POOL_KEY, ...OFFICIAL_CODES.slice(i, i + CH));
  }
  await cmd('SET', SEEDED_KEY, new Date().toISOString());
  return true;
}

function hashProspect(v) {
  return crypto.createHash('sha256').update(String(v).toLowerCase().trim()).digest('hex').slice(0, 24);
}

/* ---------- registrasi mitra ---------- */
async function registerPartner(b, meta) {
  if (b.website) return { status: 400, body: { ok: false, error: 'Permintaan ditolak' } };
  if (meta.ip && await rateLimited('mpp:rl:reg:' + meta.ip, 20, 3600)) return TOO_MANY;
  const required = ['nama', 'email', 'whatsapp', 'status', 'institusi'];
  for (const k of required) {
    if (!String(b[k] || '').trim()) return { status: 400, body: { ok: false, error: 'Field wajib kosong: ' + k } };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(b.email).trim())) {
    return { status: 400, body: { ok: false, error: 'Format email tidak valid' } };
  }
  const wa = String(b.whatsapp).replace(/[^0-9]/g, '');
  if (wa.length < 10 || wa.length > 15) {
    return { status: 400, body: { ok: false, error: 'Nomor WhatsApp tidak valid' } };
  }
  if (!(b.setuju_etika && b.setuju_data && b.setuju_status)) {
    return { status: 400, body: { ok: false, error: 'Semua persetujuan wajib dicentang' } };
  }

  await ensureSeeded();
  const email = String(b.email).trim().toLowerCase();

  // Klaim email lebih dulu agar hanya satu permintaan paralel yang mendapat kode.
  const emailKey = 'mpp:email:' + email;
  const claim = await cmd('SET', emailKey, '__CLAIMING__', 'NX');
  if (!claim) return { status: 409, body: { ok: false, error: 'Email sudah terdaftar sebagai mitra' } };

  // alokasi kode resmi FIFO
  let code;
  try {
    code = await cmd('LPOP', POOL_KEY);
    if (!code) {
      await cmd('DEL', emailKey);
      return { status: 503, body: { ok: false, error: 'Pool kode referral habis — hubungi tim MPP' } };
    }

    const now = new Date().toISOString();
    const fields = {
      nama: String(b.nama).trim(), email, whatsapp: String(b.whatsapp).trim(),
      kota: b.kota || '', status: b.status, institusi: b.institusi,
      jurusan: b.jurusan || '', semester: b.semester || '',
      akun_sosmed: b.akun_sosmed || '', sosmed: b.sosmed || '', motivasi: b.motivasi || '',
      metode_bayar: b.metode_bayar || '', nama_rekening: b.nama_rekening || '', no_rekening: protectAccount(b.no_rekening),
      tier: 'starter', lifecycle: 'menunggu_verifikasi',
      ip_pendaftar: meta.ip || '', user_agent: (meta.ua || '').slice(0, 300),
      created_at: now
    };
    const pin = newPin(), pinSalt = crypto.randomBytes(8).toString('hex');
    fields.pin_salt = pinSalt; fields.pin_hash = pinHash(pin, pinSalt);
    const flat = [];
    for (const [k, v] of Object.entries(fields)) flat.push(k, String(v));

    const partnerKey = 'mpp:partner:' + code;
    const saved = await pipeline([
      ['HSET', partnerKey, ...flat],
      ['SADD', 'mpp:partners', code],
      ['SET', emailKey, code]
    ]);
    const saveError = saved.find(result => result && typeof result === 'object' && result.error);
    if (saveError) throw new Error('Penyimpanan data mitra gagal: ' + saveError.error);

    return {
      status: 201,
      body: {
        ok: true,
        message: 'Pendaftaran diterima. Tim MPP akan menghubungi via WhatsApp/Email maksimal 1x24 jam kerja.',
        ref_code: code,
        access_pin: pin,
        next_steps: [
          'Cek WhatsApp/Email untuk undangan onboarding produk (±1-2 jam)',
          'Selesaikan onboarding & kuis pemahaman produk',
          'Kode referral diaktifkan + terima kit marketing',
          'Mulai promosi dan pantau di Dashboard Mitra'
        ]
      }
    };
  } catch (error) {
    try { await cmd('DEL', emailKey); } catch (_) {}
    if (code) {
      try { await cmd('DEL', 'mpp:partner:' + code); } catch (_) {}
      try { await cmd('SREM', 'mpp:partners', code); } catch (_) {}
      try { await cmd('LPUSH', POOL_KEY, code); } catch (_) {}
    }
    throw error;
  }
}

/* ---------- lookup mitra ---------- */
async function getPartner(codeRaw, pinRaw, meta) {
  const code = String(codeRaw || '').toUpperCase();
  if (code === 'KSA-DEMO-MPP') {
    return {
      ok: true, demo: true,
      partner: { ref_code: code, nama: 'Mitra Demo', tier: 'active', lifecycle: 'aktif' },
      stats: { clicks: 342, konsultasi: 58, closing: 7, komisi_bulan_ini: 7 * 458500 + 7 * 6550000 * 0.05 }
    };
  }
  if (meta && meta.ip && await rateLimited('mpp:rl:pin:' + meta.ip, 30, 600)) return { rateLimited: true };
  const [hash, clicks] = await pipeline([
    ['HGETALL', 'mpp:partner:' + code],
    ['GET', 'mpp:clicks:' + code]
  ]);
  if (!hash || !Object.keys(hash).length) return null;
  if (!pinRaw || !hash.pin_hash || !safeEq(pinHash(pinRaw, hash.pin_salt), hash.pin_hash)) return null;
  const p = hash; // Upstash HGETALL → object
  return {
    ok: true, demo: false,
    partner: {
      ref_code: code, nama: p.nama, tier: p.tier, lifecycle: p.lifecycle,
      institusi: p.institusi, status: p.status, terdaftar_sejak: p.created_at
    },
    stats: {
      clicks: parseInt(clicks || '0', 10),
      konsultasi: 0,
      closing: 0,
      komisi_bulan_ini: 0
    },
    catatan: 'Statistik klik tercatat real-time. Data konsultasi & closing diperbarui setelah verifikasi tim admisi.'
  };
}

/* ---------- tracking klik (first-click attribution) ---------- */
async function trackClick(b, meta) {
  const code = String(b.ref_code || '').toUpperCase();
  if (!/^(KSA-\d{6}-MPP|KSA-DEMO-MPP)$/.test(code)) {
    return { status: 400, body: { ok: false, error: 'Kode referral tidak valid' } };
  }
  if (meta.ip && await rateLimited('mpp:rl:trk:' + meta.ip, 120, 60)) return TOO_MANY;
  const event = {
    ref_code: code,
    utm_source: b.utm_source || '', utm_medium: b.utm_medium || '', utm_campaign: b.utm_campaign || '',
    landing_url: (b.landing_url || '').slice(0, 500),
    ip: meta.ip || '', ua: (meta.ua || '').slice(0, 120),
    at: new Date().toISOString()
  };
  const cmds = [
    ['INCR', 'mpp:clicks:' + code],
    ['LPUSH', 'mpp:clicklog:' + code, JSON.stringify(event)],
    ['LTRIM', 'mpp:clicklog:' + code, 0, 499]
  ];

  // first-click attribution bila identitas prospek disertakan
  let firstClick = true, attributed = code;
  if (b.prospect) {
    const key = 'mpp:prospect:' + hashProspect(b.prospect);
    cmds.push(['SET', key, code, 'NX']);
  }
  const results = await pipeline(cmds);
  if (b.prospect) {
    const setRes = results[results.length - 1];
    if (setRes === null || setRes === false) {
      // prospek sudah dikunci mitra lain → ambil pemiliknya
      firstClick = false;
      attributed = await cmd('GET', 'mpp:prospect:' + hashProspect(b.prospect)) || code;
    }
  }
  return { status: 201, body: { ok: true, attributed_to: attributed, first_click: firstClick } };
}

/* ---------- statistik admin ---------- */
async function adminStats() {
  await ensureSeeded();
  const codes = (await cmd('SMEMBERS', 'mpp:partners')) || [];
  const poolLeft = parseInt((await cmd('LLEN', POOL_KEY)) || '0', 10);
  let stats = { total_mitra: codes.length, menunggu_verifikasi: 0, aktif: 0, suspended: 0,
                per_tier: { starter: 0, active: 0, lead: 0 }, total_klik: 0 };
  if (codes.length) {
    const cmds = [];
    for (const c of codes) { cmds.push(['HGETALL', 'mpp:partner:' + c]); cmds.push(['GET', 'mpp:clicks:' + c]); }
    const res = await pipeline(cmds);
    for (let i = 0; i < codes.length; i++) {
      const p = res[i * 2] || {};
      const clicks = parseInt(res[i * 2 + 1] || '0', 10);
      stats.total_klik += clicks;
      if (p.lifecycle === 'menunggu_verifikasi') stats.menunggu_verifikasi++;
      if (p.lifecycle === 'aktif') stats.aktif++;
      if (p.lifecycle === 'suspended') stats.suspended++;
      if (stats.per_tier[p.tier] !== undefined) stats.per_tier[p.tier]++;
    }
  }
  stats.kode_terpakai = codes.length;
  stats.kode_tersedia = poolLeft;
  return stats;
}

module.exports = { ensureSeeded, registerPartner, getPartner, trackClick, adminStats, hashProspect };
