#!/usr/bin/env node
/* Smoke test API MPP — jalankan: node server/test.js (server harus sudah berjalan di :3000) */
'use strict';
const BASE = process.env.TEST_BASE || 'http://localhost:3000';

async function req(method, path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch (e) {}
  return { status: res.status, json };
}

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  [OK] ' + name); }
  else { fail++; console.log('  [GAGAL] ' + name + (extra ? ' — ' + extra : '')); }
}

(async () => {
  console.log('\n=== SMOKE TEST API MPP (' + BASE + ') ===\n');

  // 1. Health
  const h = await req('GET', '/api/health');
  check('GET /api/health → 200', h.status === 200 && h.json.ok);

  // 2. Static
  const s = await req('GET', '/index.html');
  check('GET /index.html → 200', s.status === 200);

  // 3. Register valid
  const email = 'test+' + Date.now() + '@example.com';
  const r = await req('POST', '/api/register', {
    nama: 'Tester MPP', email, whatsapp: '081234567890',
    kota: 'Bandung', status: 'Mahasiswa Aktif', institusi: 'Universitas Tester',
    sosmed: 'Instagram, WhatsApp', metode_bayar: 'bank',
    setuju_etika: true, setuju_data: true, setuju_status: true
  });
  check('POST /api/register → 201 + kode resmi KSA-…-MPP',
    r.status === 201 && /^KSA-\d{6}-MPP$/.test(r.json.ref_code || ''),
    JSON.stringify(r.json));
  const code = r.json && r.json.ref_code;
  const pin = r.json && r.json.access_pin;
  const PH = { 'X-Partner-Pin': pin || '' };

  // 4. Register duplikat ditolak
  const dup = await req('POST', '/api/register', {
    nama: 'Tester MPP', email, whatsapp: '081234567890',
    status: 'Mahasiswa Aktif', institusi: 'Universitas Tester',
    setuju_etika: true, setuju_data: true, setuju_status: true
  });
  check('POST /api/register duplikat → 409', dup.status === 409);

  // 5. Register tanpa persetujuan ditolak
  const noAgree = await req('POST', '/api/register', {
    nama: 'X', email: 'x' + Date.now() + '@e.com', whatsapp: '081234567890',
    status: 'Mahasiswa Aktif', institusi: 'U',
    setuju_etika: false, setuju_data: true, setuju_status: true
  });
  check('POST /api/register tanpa persetujuan etika → 400', noAgree.status === 400);

  // 6. Partner lookup
  if (code) {
    const p = await req('GET', '/api/partner/' + code, null, PH);
    check('GET /api/partner/:code → 200', p.status === 200 && p.json.ok);
  }
  const demo = await req('GET', '/api/partner/KSA-DEMO-MPP');
  check('GET /api/partner/KSA-DEMO-MPP → 200 (demo)', demo.status === 200 && demo.json.demo === true);
  const nf = await req('GET', '/api/partner/KSA-999999-MPP');
  check('GET /api/partner/:code tidak dikenal → 401', nf.status === 401);

  const bad = await req('GET', '/api/partner/' + code, null, { 'X-Partner-Pin': 'SALAH123' });
  check('GET /api/partner dengan PIN salah → 401', bad.status === 401);
  const bot = await req('POST', '/api/register', { nama: 'Bot', email: 'bot' + Date.now() + '@e.com', whatsapp: '081234567890', status: 'Mahasiswa Aktif', institusi: 'U', website: 'http://spam', setuju_etika: true, setuju_data: true, setuju_status: true });
  check('register dengan honeypot terisi → 400', bot.status === 400);
  const leak = await req('GET', '/server/data/db.json');
  check('db.json tidak bisa diakses publik → 404', leak.status === 404 || leak.json === null);
  const leak2 = await req('GET', '/server/ref-codes.json');
  check('ref-codes.json tidak bisa diakses publik', leak2.status === 404 || leak2.json === null);

  // 7. Track klik + first-click attribution
  if (code) {
    const t1 = await req('POST', '/api/track', { ref_code: code, prospect: 'prospek1@example.com' });
    check('POST /api/track → 201 first_click', t1.status === 201 && t1.json.first_click === true);
    const t2 = await req('POST', '/api/track', { ref_code: 'KSA-DEMO-MPP', prospect: 'prospek1@example.com' });
    check('POST /api/track prospek sama → tetap milik mitra pertama',
      t2.status === 200 && t2.json.first_click === false && t2.json.attributed_to === code);
    const p2 = await req('GET', '/api/partner/' + code, null, PH);
    check('Statistik klik bertambah', p2.json.stats.clicks >= 1);
  }

  // 8. Admin tanpa token → 401/503
  const a = await req('GET', '/api/admin/stats');
  check('GET /api/admin/stats tanpa token → 401/503', a.status === 401 || a.status === 503);

  console.log('\n=== HASIL: ' + pass + ' lulus, ' + fail + ' gagal ===\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('Test error:', e.message); process.exit(1); });
