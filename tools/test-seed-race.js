'use strict';

/* Test race seeding dan pemulihan; dijalankan terpisah dari mock suite utama. */
const assert = require('assert');
const http = require('http');
const path = require('path');

const store = { kv: {}, lists: {}, sets: {}, expirations: {}, rpushCalls: 0, failSeedMarkerOnce: false };
function resetStore() {
  store.kv = {};
  store.lists = {};
  store.sets = {};
  store.expirations = {};
  store.rpushCalls = 0;
  store.failSeedMarkerOnce = false;
}

function exec(args) {
  const [command, ...values] = args.map(String);
  switch (command) {
    case 'GET': return store.kv[values[0]] === undefined ? null : store.kv[values[0]];
    case 'SET': {
      const key = values[0];
      if (values.includes('NX') && store.kv[key] !== undefined) return null;
      if (key === 'mpp:pool:seeded' && store.failSeedMarkerOnce) {
        store.failSeedMarkerOnce = false;
        throw new Error('marker gagal sekali');
      }
      store.kv[key] = values[1];
      const exIndex = values.indexOf('EX');
      if (exIndex >= 0) store.expirations[key] = Number(values[exIndex + 1]);
      else delete store.expirations[key];
      return 'OK';
    }
    case 'DEL': {
      let deleted = 0;
      for (const key of values) {
        if (store.kv[key] !== undefined) {
          delete store.kv[key];
          delete store.expirations[key];
          deleted++;
        }
      }
      return deleted;
    }
    case 'RPUSH':
      if (values[0] === 'mpp:pool') store.rpushCalls++;
      store.lists[values[0]] = store.lists[values[0]] || [];
      store.lists[values[0]].push(...values.slice(1));
      return store.lists[values[0]].length;
    case 'LPOP': return store.lists[values[0]] && store.lists[values[0]].length ? store.lists[values[0]].shift() : null;
    case 'LPUSH':
      store.lists[values[0]] = store.lists[values[0]] || [];
      store.lists[values[0]].unshift(...values.slice(1));
      return store.lists[values[0]].length;
    case 'LLEN': return (store.lists[values[0]] || []).length;
    case 'HSET':
      store.kv[values[0]] = store.kv[values[0]] || {};
      for (let i = 1; i < values.length; i += 2) store.kv[values[0]][values[i]] = values[i + 1];
      return (values.length - 1) / 2;
    case 'SADD':
      store.sets[values[0]] = store.sets[values[0]] || new Set();
      values.slice(1).forEach(value => store.sets[values[0]].add(value));
      return store.sets[values[0]].size;
    case 'SREM': {
      const set = store.sets[values[0]];
      let removed = 0;
      if (set) values.slice(1).forEach(value => { if (set.delete(value)) removed++; });
      return removed;
    }
    default: throw new Error('Perintah mock tidak didukung: ' + command);
  }
}

const mock = http.createServer((request, response) => {
  let body = '';
  request.on('data', chunk => { body += chunk; });
  request.on('end', () => {
    try {
      const result = request.url.endsWith('/pipeline')
        ? JSON.parse(body).map(command => {
          try { return { result: exec(command) }; }
          catch (error) { return { error: error.message }; }
        })
        : { result: exec([decodeURIComponent(request.url.slice(1)), ...(body ? JSON.parse(body) : [])]) };
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(result));
    } catch (error) {
      response.statusCode = 400;
      response.end(JSON.stringify({ error: error.message }));
    }
  });
});

mock.listen(0, async () => {
  process.env.KV_REST_API_URL = 'http://localhost:' + mock.address().port;
  process.env.KV_REST_API_TOKEN = 'test-token';
  const { registerPartner } = require(path.resolve(__dirname, '..', 'api', '_lib', 'store'));
  const codes = require(path.resolve(__dirname, '..', 'api', '_data', 'codes'));
  const base = {
    nama: 'Test Seed', whatsapp: '081234567890', status: 'Mahasiswa Aktif',
    institusi: 'Universitas Tester', setuju_etika: true, setuju_data: true, setuju_status: true
  };
  const register = (email, name) => registerPartner({ ...base, email, nama: name || base.nama }, {});

  try {
    resetStore();
    const parallel = await Promise.all(Array.from({ length: 20 }, (_, index) => register('seed-race-' + index + '@example.com')));
    const allocated = parallel.map(result => result.body.ref_code);
    const pool = store.lists['mpp:pool'] || [];
    const completeInventory = pool.concat(allocated);
    assert(parallel.every(result => result.status === 201), 'semua pendaftaran paralel harus berhasil');
    assert.strictEqual(new Set(allocated).size, 20, '20 pendaftaran harus menerima kode unik');
    assert.strictEqual(completeInventory.length, 200, 'pool + alokasi harus tepat 200 entri');
    assert.strictEqual(new Set(completeInventory).size, 200, 'tidak boleh ada kode ganda dalam pool dan alokasi');
    assert.deepStrictEqual([...completeInventory].sort(), [...codes].sort(), 'inventaris harus sama dengan daftar kode resmi');
    console.log('  [OK] 20 pendaftaran paralel menghasilkan inventaris 200 kode unik');

    resetStore();
    store.failSeedMarkerOnce = true;
    let markerFailure;
    try { await register('marker-recovery@example.com'); } catch (error) { markerFailure = error; }
    assert(markerFailure, 'pengisian pertama harus menemui kegagalan pemasangan marker');
    assert.strictEqual((store.lists['mpp:pool'] || []).length, 200, 'RPUSH sudah mengisi pool sebelum marker gagal');
    const rpushAfterFailure = store.rpushCalls;
    const recovered = await register('marker-recovery@example.com');
    assert.strictEqual(recovered.status, 201, 'pendaftaran berikutnya harus pulih');
    assert.strictEqual(store.rpushCalls, rpushAfterFailure, 'pemulihan marker tidak boleh menambahkan RPUSH');
    assert.strictEqual(store.lists['mpp:pool'].length + 1, 200, 'pemulihan harus mempertahankan inventaris 200 kode');
    assert.strictEqual(store.expirations['mpp:email:marker-recovery@example.com'], undefined, 'klaim email sukses harus permanen');
    console.log('  [OK] marker gagal setelah RPUSH pulih tanpa mengisi pool ulang');

    resetStore();
    store.kv['mpp:pool:seed-claim'] = 'proses-yang-mati';
    const waiting = await register('waiting-for-seed@example.com');
    assert.strictEqual(waiting.status, 503, 'pendaftaran yang menunggu terlalu lama harus menerima 503');
    assert(/coba lagi/i.test(waiting.body.error), 'pesan 503 harus menyuruh pendaftar mencoba lagi');
    assert.strictEqual(store.rpushCalls, 0, 'pendaftaran yang menunggu tidak boleh mengisi atau mengalokasikan pool');
    console.log('  [OK] pendaftar menunggu marker lalu menerima 503 dengan pesan coba lagi');

    delete store.kv['mpp:pool:seed-claim'];
    const beforeExpiredClaimRetry = store.rpushCalls;
    const afterExpiredClaim = await register('expired-claim@example.com');
    assert.strictEqual(afterExpiredClaim.status, 201, 'pendaftaran setelah klaim kedaluwarsa harus berhasil');
    assert.strictEqual(store.rpushCalls - beforeExpiredClaimRetry, 1, 'pool harus diisi dengan tepat satu RPUSH');
    assert.strictEqual(store.lists['mpp:pool'].length + 1, 200, 'pool setelah alokasi harus berisi sisa tepat 199 kode');
    console.log('  [OK] klaim proses mati dipulihkan dengan satu pengisian pool');
  } catch (error) {
    console.error('  [GAGAL] test seed race:', error.message);
    process.exitCode = 1;
  } finally {
    mock.close();
  }
});
