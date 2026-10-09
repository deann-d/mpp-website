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

  const statsBeforeWarmup = await req('GET', '/api/admin/stats', null, { Authorization: 'Bearer r' });
  const warmupEmail = 'warmup+' + Date.now() + '@example.com';
  const warmup = await req('POST', '/api/register', {
    nama: 'Pemanas Pool', email: warmupEmail, whatsapp: '081234567890',
    status: 'Mahasiswa Aktif', institusi: 'Universitas Tester',
    setuju_etika: true, setuju_data: true, setuju_status: true
  }, { 'X-Forwarded-For': '192.0.2.10' });
  const statsBeforeParallel = await req('GET', '/api/admin/stats', null, { Authorization: 'Bearer r' });
  check('pendaftaran pemanas server berhasil', warmup.status === 201);

  const parallelEmail = 'parallel+' + Date.now() + '@example.com';
  const parallelResults = await Promise.all(Array.from({ length: 20 }, (_, i) => req('POST', '/api/register', {
    nama: 'Paralel ' + i, email: parallelEmail, whatsapp: '081234567890',
    status: 'Mahasiswa Aktif', institusi: 'Universitas Tester',
    setuju_etika: true, setuju_data: true, setuju_status: true
  }, { 'X-Forwarded-For': '198.51.100.' + (i + 1) })));
  const parallel201 = parallelResults.filter(result => result.status === 201);
  const parallel409 = parallelResults.filter(result => result.status === 409);
  const statsAfterParallel = await req('GET', '/api/admin/stats', null, { Authorization: 'Bearer r' });
  check('20 pendaftaran paralel server: tepat 1 respons 201 dan 19 respons 409',
    warmup.status === 201 && parallel201.length === 1 && parallel409.length === 19 &&
    parallelResults.every(result => result.status === 201 || result.status === 409),
    parallelResults.map(result => result.status).join(','));
  check('pendaftaran paralel server memakai tepat satu kode',
    statsBeforeWarmup.status === 200 && statsBeforeParallel.status === 200 && statsAfterParallel.status === 200 &&
    statsBeforeWarmup.json.kode_tersedia - statsBeforeParallel.json.kode_tersedia === 1 &&
    statsBeforeParallel.json.kode_tersedia - statsAfterParallel.json.kode_tersedia === 1);

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
    const testProspect = 'prospek-' + Date.now() + '@example.com';
    const t1 = await req('POST', '/api/track', { ref_code: code, prospect: testProspect });
    check('POST /api/track → 201 first_click', t1.status === 201 && t1.json.first_click === true);
    const t2 = await req('POST', '/api/track', { ref_code: 'KSA-DEMO-MPP', prospect: testProspect });
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
