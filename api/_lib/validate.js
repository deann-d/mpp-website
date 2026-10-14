'use strict';

const MAX_BODY_BYTES = 64 * 1024;

const REGISTER_LIMITS = Object.freeze({
  website: 2048,
  nama: 120,
  email: 254,
  whatsapp: 32,
  kota: 100,
  status: 40,
  institusi: 160,
  jurusan: 120,
  semester: 40,
  akun_sosmed: 256,
  sosmed: 80,
  motivasi: 2000,
  metode_bayar: 10,
  nama_rekening: 120,
  no_rekening: 64
});

const TRACK_LIMITS = Object.freeze({
  ref_code: 14,
  utm_source: 100,
  utm_medium: 100,
  utm_campaign: 100,
  landing_url: 500
});

const STATUS_VALUES = Object.freeze([
  'Mahasiswa Aktif', 'Fresh Graduate (< 1 tahun)', 'Freelancer', 'Lainnya'
]);
const PAYMENT_VALUES = Object.freeze(['bank', 'ewallet']);
const SOCIAL_VALUES = Object.freeze(['Instagram', 'TikTok', 'LinkedIn', 'WhatsApp', 'X/Twitter', 'YouTube']);
const CONSENT_FIELDS = Object.freeze(['setuju_etika', 'setuju_data', 'setuju_status']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function bodyByteLength(value) {
  const serialized = JSON.stringify(value === undefined ? {} : value);
  return Buffer.byteLength(serialized === undefined ? '' : serialized, 'utf8');
}

function bodyTooLarge(value) {
  return bodyByteLength(value) > MAX_BODY_BYTES;
}

function sanitizeText(value, allowNewline) {
  const controls = allowNewline ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g;
  return value.replace(controls, '').trim();
}

function fieldError(field, limit, detail) {
  return 'Field ' + field + ' ' + detail + ' (batas ' + limit + ' karakter).';
}

function sanitizeRegister(input) {
  if (!isRecord(input)) return { ok: false, error: 'Body permintaan harus berupa objek JSON.' };
  const value = { ...input };

  for (const [field, limit] of Object.entries(REGISTER_LIMITS)) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) continue;
    if (typeof input[field] !== 'string') {
      return { ok: false, error: fieldError(field, limit, 'harus berupa teks') };
    }
    value[field] = sanitizeText(input[field], field === 'motivasi');
    if (value[field].length > limit) {
      return { ok: false, error: fieldError(field, limit, 'melebihi panjang maksimum') };
    }
  }

  if (value.status && !STATUS_VALUES.includes(value.status)) {
    return { ok: false, error: fieldError('status', REGISTER_LIMITS.status, 'harus sesuai pilihan yang tersedia') };
  }
  if (value.metode_bayar && !PAYMENT_VALUES.includes(value.metode_bayar)) {
    return { ok: false, error: fieldError('metode_bayar', REGISTER_LIMITS.metode_bayar, 'harus sesuai pilihan yang tersedia') };
  }
  if (value.sosmed) {
    const platforms = value.sosmed.split(', ');
    if (platforms.some(platform => !SOCIAL_VALUES.includes(platform)) || new Set(platforms).size !== platforms.length) {
      return { ok: false, error: fieldError('sosmed', REGISTER_LIMITS.sosmed, 'harus berisi pilihan unik dipisahkan dengan ", "') };
    }
  }
  return { ok: true, value };
}

function validateConsents(value) {
  for (const field of CONSENT_FIELDS) {
    if (typeof value[field] !== 'boolean' || value[field] !== true) {
      return { ok: false, error: 'Field ' + field + ' harus berupa boolean true.' };
    }
  }
  return { ok: true };
}

function sanitizeTrack(input) {
  if (!isRecord(input)) return { ok: false, error: 'Body permintaan harus berupa objek JSON.' };
  if (typeof input.ref_code !== 'string') {
    return { ok: false, error: 'Field ref_code tidak valid.' };
  }
  const refCode = sanitizeText(input.ref_code, false).toUpperCase();
  if (refCode.length > TRACK_LIMITS.ref_code || !/^(KSA-\d{6}-MPP|KSA-DEMO-MPP)$/.test(refCode)) {
    return { ok: false, error: 'Field ref_code tidak valid.' };
  }

  if (Object.prototype.hasOwnProperty.call(input, 'prospect') && typeof input.prospect !== 'string') {
    return { ok: false, error: 'Field prospect harus berupa teks.' };
  }

  const value = { ref_code: refCode };
  if (typeof input.prospect === 'string') value.prospect = sanitizeText(input.prospect, false);
  for (const field of ['utm_source', 'utm_medium', 'utm_campaign', 'landing_url']) {
    const limit = TRACK_LIMITS[field];
    const text = typeof input[field] === 'string' ? sanitizeText(input[field], false) : '';
    value[field] = text.slice(0, limit);
  }
  return { ok: true, value };
}

module.exports = {
  MAX_BODY_BYTES, REGISTER_LIMITS, TRACK_LIMITS, STATUS_VALUES,
  PAYMENT_VALUES, SOCIAL_VALUES, CONSENT_FIELDS, isRecord,
  bodyByteLength, bodyTooLarge, sanitizeRegister, validateConsents, sanitizeTrack
};
