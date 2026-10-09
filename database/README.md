# API & Backend — Marketing Partner Program

Direktori ini berisi lapisan data program. Website statis di root dapat berjalan
sendiri (mode demo, data di `localStorage`), tetapi untuk produksi sesungguhnya
data pendaftaran, tracking referral, dan komisi harus tersimpan di server.

## Isi Direktori

| File | Fungsi |
|---|---|
| `schema.sql` | Skema database lengkap: mitra, pool kode referral, tracking first-click, closing, komisi, payout, pelanggaran kode etik, audit log, view performa, dan fungsi perhitungan komisi/tier otomatis |

## Pilihan Implementasi Backend

Dokumen proposal bagian L merekomendasikan: **pada tahap awal gunakan platform
afiliasi pihak ketiga untuk mempercepat implementasi**, sebelum membangun sistem
in-house saat skala mitra sudah signifikan. Panduan ini mengikuti rekomendasi
tersebut dengan tiga jalur bertingkat.

### Jalur A — Tanpa Server (Paling Cepat, untuk Pilot)

Formulir pendaftaran menyetor data langsung ke Google Sheets.

1. Buka [script.google.com](https://script.google.com) → New Project
2. Tempel kode `apps-script.gs` (lihat bawah), sesuaikan `SHEET_ID`
3. Deploy → New deployment → Web app → Execute as *Me*, Access *Anyone*
4. Salin URL `/exec`, tempel ke variabel `FORM_ENDPOINT` di `daftar.html`

```javascript
// apps-script.gs
const SHEET_ID = 'GANTI_DENGAN_ID_SPREADSHEET_ANDA';
const SHEET_NAME = 'Pendaftaran MPP';
const LOCK_TIMEOUT = 20000;

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(LOCK_TIMEOUT);
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    let sheet = ss.getSheetByName(SHEET_NAME);
    const data = JSON.parse(e.postData.contents);

    if (!sheet) { sheet = ss.insertSheet(SHEET_NAME); }
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(Object.keys(data));   // header dari key pertama
      sheet.setFrozenRows(1);
    }
    sheet.appendRow(Object.keys(data).map(k => data[k] ?? ''));

    // Notifikasi ke tim MPP
    MailApp.sendEmail({
      to: 'mpp@kesatriaacademy.id',
      subject: '[MPP] Pendaftaran mitra baru: ' + (data.nama || '-'),
      body: 'Pendaftaran baru:\n\n' + JSON.stringify(data, null, 2)
    });

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, ref_code: data.ref_code }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
```

**Batasan:** tidak ada tracking klik, tidak ada perhitungan komisi otomatis,
dan Google Apps Script punya kuota harian (~20.000 eksekusi/hari). Cukup untuk
pilot 20–30 mitra sesuai roadmap dokumen bagian N.

### Jalur B — Supabase / Firebase (Rekomendasi untuk Peluncuran Penuh)

Tanpa mengelola server sendiri, tapi dapat database riil dan autentikasi.

1. Buat project di [supabase.com](https://supabase.com)
2. SQL Editor → jalankan seluruh isi `schema.sql`
3. Isi pool kode: impor 200 kode dari Lampiran S dokumen ke tabel `ref_codes`
4. Buat Edge Function `register` yang memanggil `fn_calc_commission`
5. Ubah `FORM_ENDPOINT` di `daftar.html` ke URL Edge Function
6. Ubah `loadPartnerData()` di `dashboard.html` menjadi fetch ke view
   `v_partner_performance` (filter dengan Row Level Security per `ref_code`)

Contoh kebijakan RLS agar mitra hanya melihat datanya sendiri:

```sql
ALTER TABLE partners ENABLE ROW LEVEL SECURITY;
CREATE POLICY mitra_lihat_sendiri ON partners
  FOR SELECT USING (ref_code = current_setting('app.current_ref_code'));
```

### Jalur C — Server Sendiri (In-House, Skala Besar)

Gunakan `schema.sql` pada PostgreSQL yang Anda kelola, lalu bangun API
(Node/Express, NestJS, Laravel, atau Go) dengan endpoint:

| Method | Endpoint | Kegunaan |
|---|---|---|
| POST | `/api/register` | Terima pendaftaran, alokasikan kode dari `ref_codes`, set `lifecycle='menunggu_verifikasi'` |
| POST | `/api/track` | Catat klik referral, enforce first-click lewat unique index `prospect_key` |
| GET | `/api/partner/:code/performance` | Baca `v_partner_performance` untuk dashboard |
| POST | `/api/admin/closings` | Input closing terverifikasi oleh Operational Staff → panggil `fn_calc_commission()` |
| POST | `/api/admin/payouts` | Generate payout bulanan (tanggal 10) |
| POST | `/api/admin/violations` | Catat pelanggaran kode etik & sanksi |

**Keamanan minimum untuk produksi:**
- Enkripsi `no_rekening` dan `destination` (pgcrypto / KMS) — data finansial sensitif
- Rate limiting pada `/api/register` dan `/api/track` (mitigasi kecurangan tracking, dokumen bagian P)
- Validasi `prospect_key` sebagai hash, bukan menyimpan email/WA prospek mentah
- Wajibkan `verified_by` pada setiap closing sebelum komisi dihitung (verifikasi manual tim admisi)
- Audit log untuk semua mutasi status tier, komisi, dan sanksi
- Jangan pernah mengekspos endpoint admin tanpa autentikasi + IP allowlist

## Skema Komisi (Sesuai Dokumen Bagian K)

| Tingkatan | Syarat | Per Closing | Bonus Batch |
|---|---|---|---|
| Partner Starter | Baru bergabung | 7% | — |
| Partner Active | ≥3 closing/bulan | 7% | 5% revenue |
| Partner Lead | ≥10 closing/bulan | 7% | 5% revenue + campaign eksklusif + mentoring |

Logika ini sudah terimplementasi di fungsi `fn_calc_commission()` dan
`fn_recalc_tier()` pada `schema.sql`. Nominal `Rp458.500` dan harga bootcamp
`Rp6.550.000` yang dipakai di kalkulator website adalah angka ilustratif dari
dokumen — **wajib dikonfirmasi ulang dengan tim finance sebelum go-live**,
sebagaimana dicatat pada bagian Penutup dokumen.

## Verifikasi Sebelum Produksi

- [ ] Nominal komisi disetujui tim finance
- [ ] 200 kode dari Lampiran S sudah terimpor ke `ref_codes`
- [ ] Alur first-click attribution teruji (dua mitra → satu prospek)
- [ ] Pencairan terjadwal tanggal 10 teruji end-to-end
- [ ] Data rekening terenkripsi & akses dibatasi
- [ ] Rate limiting aktif dan diuji
- [ ] Kode etik & persetujuan tersimpan sebagai bukti audit
- [ ] Backup database otomatis harian
