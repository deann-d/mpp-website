'use strict';

const fs = require('fs');
const path = require('path');

function decodeHtml(value) {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function readOptions(html, name) {
  const select = html.match(new RegExp('<select\\b[^>]*name="' + name + '"[^>]*>([\\s\\S]*?)</select>', 'i'));
  if (!select) return [];
  const values = [];
  for (const option of select[1].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)) {
    const explicit = option[1].match(/\bvalue="([^"]*)"/i);
    const value = explicit ? decodeHtml(explicit[1]) : decodeHtml(option[2].replace(/<[^>]*>/g, '').trim());
    if (value) values.push(value);
  }
  return values;
}

function readSocialValues(html) {
  const values = [];
  for (const input of html.matchAll(/<input\b([^>]*)\bname="sosmed"([^>]*)>/gi)) {
    const attrs = input[1] + input[2];
    const match = attrs.match(/\bvalue="([^"]*)"/i);
    if (match) values.push(decodeHtml(match[1]));
  }
  return values;
}

async function runInputValidationTests({ submitRegister, submitTrack, readPartner, readTrackEvent, check }) {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'daftar.html'), 'utf8');
  const statusOptions = readOptions(html, 'status');
  const paymentOptions = readOptions(html, 'metode_bayar');
  const socialOptions = readSocialValues(html);
  let sequence = 0;
  let registered = 0;
  let latestIdentity;

  const base = {
    nama: 'Mitra Uji', email: '', whatsapp: '081234567890', kota: 'Bandung',
    status: 'Mahasiswa Aktif', institusi: 'Universitas Tester', jurusan: '', semester: '',
    akun_sosmed: '@uji', sosmed: 'Instagram, WhatsApp', motivasi: '', metode_bayar: 'bank',
    nama_rekening: '', no_rekening: '', website: '',
    setuju_etika: true, setuju_data: true, setuju_status: true
  };

  async function register(overrides = {}) {
    sequence++;
    const body = { ...base, email: 'input-test-' + Date.now() + '-' + sequence + '@example.com', ...overrides };
    const result = await submitRegister(body);
    if (result.status === 201) {
      registered++;
      latestIdentity = { code: result.body.ref_code, pin: result.body.access_pin };
    }
    return result;
  }

  function isFieldError(result, field) {
    return result.status === 400 && String(result.body.error || '').toLowerCase().includes(field) &&
      !String(result.body.error || '').includes('input-test-');
  }

  let result = await register({ nama: 'N'.repeat(120) });
  check('register menerima nama tepat 120 karakter', result.status === 201);
  result = await register({ nama: 'N'.repeat(121) });
  check('register menolak nama 121 karakter dengan nama dan batas', isFieldError(result, 'nama') && /120/.test(result.body.error));

  for (const [field, value, kind] of [
    ['email', ['uji@example.com'], 'array'], ['email', { value: 'uji@example.com' }, 'objek'],
    ['nama', ['Mitra Uji'], 'array'], ['nama', { value: 'Mitra Uji' }, 'objek']
  ]) {
    result = await register({ [field]: value });
    check('register menolak ' + field + ' bertipe ' + kind, isFieldError(result, field));
  }

  result = await register({ nama: 'Nama\u0000 uji' });
  const cleanedPartner = result.status === 201 && latestIdentity
    ? await readPartner(latestIdentity.code, latestIdentity.pin) : null;
  check('register membuang karakter kontrol dari nama', Boolean(cleanedPartner && cleanedPartner.nama === 'Nama uji'));

  const longBody = { motivasi: 'x'.repeat(70 * 1024) };
  result = await register(longBody);
  check('register menolak body lebih dari 64 KiB dengan 413', result.status === 413 && /65536|64 KiB/i.test(result.body.error || ''));

  const consentFields = ['setuju_etika', 'setuju_data', 'setuju_status'];
  for (const field of consentFields) {
    for (const value of ['false', 'true', 1]) {
      result = await register({ [field]: value });
      check('register menolak ' + field + ' bernilai ' + JSON.stringify(value), isFieldError(result, field));
    }
  }

  const optionCases = [
    ...statusOptions.map(value => ['status', value]),
    ...paymentOptions.map(value => ['metode_bayar', value]),
    ...socialOptions.map(value => ['sosmed', value])
  ];
  check('test drift menemukan opsi status, metode pembayaran, dan sosmed',
    statusOptions.length > 0 && paymentOptions.length > 0 && socialOptions.length > 0,
    JSON.stringify({ statusOptions, paymentOptions, socialOptions }));
  for (const [field, value] of optionCases) {
    result = await register({ [field]: value });
    check('whitelist register menerima opsi formulir ' + field + ': ' + value, result.status === 201);
  }
  for (const [field, value] of [
    ['status', 'Status Tidak Dikenal'], ['metode_bayar', 'tunai'],
    ['sosmed', 'Instagram, Instagram'], ['sosmed', 'Instagram, YouTube, TikTok, LinkedIn, WhatsApp, X/Twitter, Instagram'],
    ['sosmed', 'Instagram,  WhatsApp'], ['sosmed', 'X'.repeat(81)]
  ]) {
    result = await register({ [field]: value });
    check('register menolak pilihan whitelist tidak valid pada ' + field, isFieldError(result, field));
  }

  result = await submitTrack({
    ref_code: latestIdentity ? latestIdentity.code : 'KSA-674961-MPP',
    utm_source: 'S'.repeat(120), utm_medium: 'M'.repeat(120),
    utm_campaign: 'C'.repeat(120), landing_url: 'https://example.com/' + 'p'.repeat(600)
  });
  const truncatedEvent = await readTrackEvent();
  check('track memotong UTM dan landing_url ke batas yang ditetapkan', result.status === 201 && truncatedEvent &&
    truncatedEvent.utm_source.length === 100 && truncatedEvent.utm_medium.length === 100 &&
    truncatedEvent.utm_campaign.length === 100 && truncatedEvent.landing_url.length === 500);

  result = await submitTrack({
    ref_code: 'KSA-674961-MPP', utm_source: ['bukan string'], utm_medium: { value: 'bukan string' },
    utm_campaign: 7, landing_url: { value: 'bukan string' }
  });
  const emptyOptionalTrackFields = await readTrackEvent();
  check('track memperlakukan tipe salah pada UTM/URL sebagai kosong', result.status === 201 && emptyOptionalTrackFields &&
    emptyOptionalTrackFields.utm_source === '' && emptyOptionalTrackFields.utm_medium === '' &&
    emptyOptionalTrackFields.utm_campaign === '' && emptyOptionalTrackFields.landing_url === '');

  result = await submitTrack({
    ref_code: 'KSA-674961-MPP', utm_campaign: 'kampanye\u0000uji', landing_url: 'https://example.com/halaman'
  });
  const cleanTrack = await readTrackEvent();
  check('track membuang karakter kontrol dari field tracking', result.status === 201 && cleanTrack && cleanTrack.utm_campaign === 'kampanyeuji');

  for (const value of [['KSA-674961-MPP'], { value: 'KSA-674961-MPP' }]) {
    result = await submitTrack({ ref_code: value });
    check('track menolak ref_code yang bukan string', result.status === 400);
  }
  for (const value of [['prospek@example.com'], { email: 'prospek@example.com' }, 9]) {
    result = await submitTrack({ ref_code: 'KSA-674961-MPP', prospect: value });
    check('track menolak prospect yang bukan string', result.status === 400 && /prospect/i.test(result.body.error || ''));
  }
  result = await submitTrack('body bukan objek');
  check('track menolak body yang bukan objek JSON', result.status === 400 && /body/i.test(result.body.error || ''));
  result = await submitTrack({
    ref_code: 'KSA-674961-MPP', landing_url: 'x'.repeat(70 * 1024)
  });
  check('track menolak body lebih dari 64 KiB dengan 413', result.status === 413 && /65536|64 KiB/i.test(result.body.error || ''));

  return registered;
}

module.exports = { runInputValidationTests };
