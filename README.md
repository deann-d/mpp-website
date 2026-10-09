# Website Marketing Partner Program (MPP) — Kesatria Academy

Website resmi untuk menunjang **Marketing Partner Program (MPP)** sesuai *Dokumen Proposal Program v2.0* — PT. Wiratek Solusi Asia (Kesatria Academy).

> **Struktur proyek:**
> ```
> mpp-website/
> ├── index.html          → Landing page program (semua bagian proposal)
> ├── daftar.html         → Formulir pendaftaran mitra (3 langkah + validasi)
> ├── dashboard.html      → Dashboard tracking referral mitra
> ├── 404.html            → Halaman error
> ├── robots.txt, sitemap.xml
> ├── vercel.json         → Konfigurasi deploy Vercel (headers + caching)
> ├── netlify.toml        → Konfigurasi deploy Netlify
> ├── Dockerfile          → Deploy container (VPS/Railway/Render)
> ├── package.json
> ├── DEPLOY-VERCEL.md    → Panduan lengkap deploy ke Vercel
> ├── .github/workflows/deploy.yml  → CI/CD GitHub Pages
> ├── api/                → Serverless functions Vercel (Node, tanpa dependensi)
> │   ├── health.js, register.js, track.js
> │   ├── partner/[code].js, admin/stats.js
> │   ├── _lib/           → Driver KV (Upstash REST) + logika bisnis + helper HTTP
> │   └── _data/codes.js  → 200 kode referral RESMI dari Lampiran S dokumen
> ├── database/
> │   ├── schema.sql      → Skema PostgreSQL produksi (13 tabel/fungsi)
> │   └── README.md       → Panduan backend (3 jalur implementasi)
> └── server/
>     ├── index.js        → Server Node.js standalone (VPS/Docker): static + REST API
>     ├── ref-codes.json  → 200 kode referral resmi (format JSON)
>     └── test.js         → Smoke test API otomatis
> ```
>
> **Pengujian:** `npm run test:vercel` → 17 test serverless function lulus • `npm start` + `npm test` → 12 test API standalone lulus 

---

## 1⃣ Pemetaan Dokumen Proposal → Website

| Bagian Dokumen | Implementasi di Website |
|---|---|
| A. Ringkasan Eksekutif | Hero + statistik kunci di `index.html` (onboarding 1–2 jam, aktivasi <3 hari, komisi 7%+5%) |
| C. Tujuan & Sasaran | Statistik & nilai proposisi program |
| E. Target Profil Mitra | Sidebar "Syarat Menjadi Mitra" di `daftar.html` |
| I. Alur End-to-End (5 tahap) | Seksi "Cara Kerja" + kartu alur cepat di hero |
| K. Skema Komisi & Insentif | 3 kartu tingkatan (Starter/Active/Lead) + **Kalkulator Komisi interaktif** (memakai contoh resmi dokumen: Rp458.500/closing, harga bootcamp Rp6.550.000, contoh 5 closing = Rp3.930.000) |
| K.3 Kit Marketing | Seksi "Kit Marketing" + panel unduhan di dashboard |
| L. Sistem & Teknologi | Dashboard tracking real-time, kode/link referral unik, first-click attribution, modul komisi otomatis |
| M. Kode Etik | Seksi "Kode Etik" + 3 checkbox persetujuan wajib di formulir |
| N. Timeline Implementasi | Seksi "Roadmap" 4 fase / 4 minggu |
| R. FAQ (7 pertanyaan) | Akordeon FAQ persis isi dokumen |
| S. Lampiran (200 kode) | `server/ref-codes.json` — dialokasikan FIFO ke pendaftar via API |

## 2⃣ Menjalankan Secara Lokal

### Mode Statis (paling sederhana — tanpa backend)
Buka `index.html` langsung di browser, atau:
```bash
cd mpp-website
python3 -m http.server 8080     # atau: npx serve .
# buka http://localhost:8080
```
Formulir pendaftaran otomatis berjalan dalam **mode demo** (data tersimpan di localStorage browser) — cocok untuk presentasi ke manajemen.

### Mode Server (API penuh — rekomendasi)
```bash
cd mpp-website
npm start                       # = node server/index.js
# buka http://localhost:3000
```
Yang didapat di mode ini:
- `POST /api/register` — pendaftaran mitra + alokasi kode resmi dari pool 200 kode Lampiran S
- `GET /api/partner/:code` — data & statistik mitra untuk dashboard
- `POST /api/track` — pencatatan klik referral dengan **first-click attribution** (FAQ no.7)
- `GET /api/admin/stats` — ringkasan program (lindungi dengan `ADMIN_TOKEN`)
- `GET /api/health` — health check

**Menjalankan smoke test API:**
```bash
npm start &                     # terminal 1
node server/test.js             # terminal 2 → 12 pengujian otomatis
```

**Akun demo dashboard:** kode `KSA-DEMO-MPP`, atau daftar dulu lewat `daftar.html` lalu login dengan kode yang diterima.

## 3⃣ Deploy ke Production

### Opsi A — Vercel (paling disarankan — website + API penuh)
> **Panduan langkah demi langkah lengkap: buka [`DEPLOY-VERCEL.md`](DEPLOY-VERCEL.md)**

```bash
npm i -g vercel
cd mpp-website
vercel login
vercel            # deploy preview → dapat URL .vercel.app
vercel --prod     # deploy produksi
```
- `vercel.json` sudah menyiapkan security headers & caching
- Folder `api/` berisi **serverless functions** (register, track, partner, admin stats) — otomatis aktif di Vercel
- Untuk penyimpanan data permanen: buat **Vercel KV** (gratis) → env var tersambung otomatis → pool 200 kode resmi di-seed otomatis (detail di `DEPLOY-VERCEL.md` langkah 4)
- Tanpa KV, halaman tetap tampil tetapi pendaftaran ditolak sampai database dikonfigurasi

### Opsi B — Netlify (gratis)
```bash
npm i -g netlify-cli
netlify deploy --prod --dir .
```
Atau drag-and-drop folder ke [app.netlify.com/drop](https://app.netlify.com/drop). `netlify.toml` sudah termasuk redirect & headers.

### Opsi C — GitHub Pages (gratis, CI/CD otomatis)
```bash
cd mpp-website
git init && git add -A && git commit -m "MPP website v1.0"
git branch -M main
git remote add origin https://github.com/<USERNAME>/mpp-website.git
git push -u origin main
```
Lalu di GitHub: **Settings → Pages → Source: GitHub Actions**. Workflow `.github/workflows/deploy.yml` akan deploy otomatis setiap push.
> GitHub Pages hanya statis → gunakan backend Jalur A/B di `database/README.md` (Formspree / Google Apps Script / Supabase) untuk formulir.

### Opsi D — Docker (VPS / Railway / Render / Fly.io) — API penuh
```bash
docker build -t mpp-website .
docker run -d --name mpp -p 3000:3000 \
  -e ADMIN_TOKEN=ganti-dengan-token-kuat \
  -e BASE_PUBLIC_URL=https://mpp.kesatriaacademy.id \
  -v mpp-data:/app/server/data \
  mpp-website
```
- **Railway/Render:** hubungkan repo GitHub → build dari `Dockerfile` → set env `ADMIN_TOKEN`, `BASE_PUBLIC_URL` → mount volume untuk `/app/server/data`.
- **VPS:** jalankan di belakang Nginx reverse proxy + sertifikat SSL gratis (Certbot/Let's Encrypt).

### Setelah deploy — checklist go-live
- [ ] Arahkan domain/subdomain (mis. `mpp.kesatriaacademy.id`) + pasang SSL
- [ ] Ganti kontak placeholder (`mpp@kesatriaacademy.id`, WhatsApp, Instagram) di footer semua halaman
- [ ] Update `sitemap.xml` & `robots.txt` dengan domain final
- [ ] Set `ADMIN_TOKEN` yang kuat dan simpan rahasia
- [ ] **Konfirmasi nominal komisi ke tim finance** (dokumen bagian Penutup — angka saat ini ilustratif)
- [ ] Uji end-to-end: daftar → terima kode → login dashboard → klik `?ref=` tercatat
- [ ] Pasang analitik (Google Analytics / Plausible) untuk KPI conversion rate (dokumen bagian Q)
- [ ] Backup `server/data/db.json` harian (cron) atau migrasi ke PostgreSQL (`database/schema.sql`)

## 4⃣ Arsitektur Data & Upgrade ke Database Riil

Tahap awal (pilot 20–30 mitra, sesuai roadmap dokumen): server JSON-file sudah memadai.
Saat peluncuran penuh, jalankan `database/schema.sql` di PostgreSQL/Supabase — sudah termasuk:
- **13 komponen**: partners, pool `ref_codes`, tracking `referrals` (unique index = first-click di level DB), funnel status, closings, commissions, payouts (jadwal tanggal 10), violations (kode etik + sanksi berjenjang), audit log
- **View `v_partner_performance`** — siap dikonsumsi dashboard
- **Fungsi `fn_calc_commission()`** — 7% per closing + 5% bonus batch untuk tier Active/Lead (idempoten)
- **Fungsi `fn_recalc_tier()`** — naik/turun tier otomatis (<3 / ≥3 / ≥10 closing per bulan)

Detail 3 jalur implementasi backend (tanpa server → Supabase → in-house) ada di **`database/README.md`**.

## 5⃣ Keamanan & Kepatuhan

- Persetujuan kode etik, pemrosesan data, dan status freelance **wajib dicentang** sebelum formulir bisa dikirim (bukti audit tersimpan)
- Data prospek di-hash (`prospect_key`) — tidak menyimpan email/WA mentah di log tracking
- Nomor rekening mitra: untuk produksi **wajib dienkripsi** (catatan di `database/schema.sql`)
- Security headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy) aktif di semua opsi deploy
- Endpoint admin dilindungi Bearer token

---

**Versi:** 1.0 • **Tanggal:** 9 Oktober 2026
**Berdasarkan:** Dokumen Proposal Program MPP v2.0 oleh @adipuraaryakangsadewa
**Untuk:** PT. Wiratek Solusi Asia — Kesatria Academy

---

## Catatan v1.1 (keamanan & tampilan)

- Hanya folder `public/` yang disajikan ke internet. `server/`, `database/`, dan `tools/` tidak pernah ikut tersaji.
- Dashboard memakai **kode referral + PIN akses** (8 karakter, ditampilkan sekali saat pendaftaran, disimpan sebagai hash).
- Set env `DATA_KEY` (string acak panjang) agar nomor rekening dienkripsi AES-256-GCM. Tanpa `DATA_KEY`, hanya 4 digit terakhir yang disimpan.
- Set `BASE_PUBLIC_URL` agar CORS hanya mengizinkan domain resmi.
- Rate limit: pendaftaran 20/jam/IP, tracking 120/menit/IP, login dashboard 30/10 menit/IP. Ada honeypot anti-bot. Pertimbangkan CAPTCHA (Cloudflare Turnstile) sebelum kampanye besar.
- Warna dan font diatur dari `public/assets/site.css` (bagian `:root`).
