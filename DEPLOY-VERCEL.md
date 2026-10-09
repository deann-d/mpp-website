# Panduan Deploy ke Vercel — Website MPP Kesatria Academy

Proyek ini **sudah 100% siap Vercel**: halaman statis + 5 serverless function di folder `api/`
(register, track, partner lookup, admin stats, health). Ikuti langkah berikut berurutan.

---

## Langkah 1 — Buat Akun Vercel (2 menit)

1. Buka [vercel.com/signup](https://vercel.com/signup)
2. Daftar dengan **GitHub** (paling disarankan) / GitLab / email

## Langkah 2 — Deploy Website (pilih salah satu cara)

### Cara A: Import dari GitHub (disarankan — auto-deploy tiap push)

```bash
cd mpp-website
git init && git add -A
git commit -m "Website MPP Kesatria Academy v1.0"
git branch -M main
# buat repo kosong di github.com/new (nama: mpp-website), lalu:
git remote add origin https://github.com/<USERNAME>/mpp-website.git
git push -u origin main
```

Kemudian di [vercel.com/new](https://vercel.com/new):
1. **Import** repo `mpp-website`
2. Framework Preset: **Other** (biarkan default — tidak perlu build command)
3. Klik **Deploy** → selesai! Dapat URL `https://mpp-website-xxx.vercel.app`

### Cara B: Via CLI (tanpa GitHub)

```bash
npm i -g vercel
cd mpp-website
vercel login          # buka browser untuk autentikasi
vercel                # deploy preview (jawab Y untuk semua pertanyaan setup)
vercel --prod         # deploy ke produksi
```

## Langkah 3 — Uji Website (tanpa database pun sudah jalan)

Buka URL Vercel kamu:
- `/` → landing page 
- `/daftar` → formulir (tanpa KV akan fallback ke **mode demo** localStorage)
- `/dashboard` → login dengan `KSA-DEMO-MPP` 
- `/api/health` → `{"ok":true,"kv_configured":false,...}`

## Langkah 4 — Aktifkan Database (agar pendaftaran mitra tersimpan permanen)

Serverless Vercel tidak punya disk permanen, jadi data disimpan di **Vercel KV (Redis)** — gratis hingga 256MB / 30 ribu perintah per bulan (cukup untuk ratusan mitra).

1. Dashboard Vercel → tab **Storage** → **Create Database** → **KV**
2. Beri nama: `mpp-db` → region **Singapore (sin1)** terdekat ke Indonesia
3. **Connect Project** → pilih project MPP kamu → Vercel otomatis menyuntikkan
   env var `KV_REST_API_URL` & `KV_REST_API_TOKEN`
4. Tambahkan juga env var manual di **Settings → Environment Variables**:
   | Nama | Nilai |
   |---|---|
   | `ADMIN_TOKEN` | token rahasia buatanmu (untuk `/api/admin/stats`) |
   | `BASE_PUBLIC_URL` | URL produksi, mis. `https://mpp-website-xxx.vercel.app` |
5. **Deployments → ⋯ → Redeploy** (agar env var terbaca)

Pool 200 kode resmi dari Lampiran S dokumen akan **di-seed otomatis** saat pendaftaran pertama.

## Langkah 5 — Verifikasi End-to-End

```bash
BASE=https://<url-vercel-kamu>.app

# 1. KV aktif?
curl $BASE/api/health          # → kv_configured: true

# 2. Daftar mitra (atau lewat halaman /daftar)
curl -X POST $BASE/api/register -H "Content-Type: application/json" -d '{
  "nama":"Uji Coba","email":"uji@example.com","whatsapp":"081234567890",
  "status":"Mahasiswa Aktif","institusi":"Universitas Uji",
  "setuju_etika":true,"setuju_data":true,"setuju_status":true}'
# → ref_code: "KSA-674961-MPP"  (kode pertama Lampiran S )

# 3. Klik referral tercatat
curl -X POST $BASE/api/track -H "Content-Type: application/json" \
  -d '{"ref_code":"KSA-674961-MPP"}'

# 4. Dashboard membaca data riil
curl $BASE/api/partner/KSA-674961-MPP

# 5. Statistik admin
curl -H "Authorization: Bearer <ADMIN_TOKEN>" $BASE/api/admin/stats
```

Terakhir: buka `/daftar` di browser → isi form → pastikan kode yang muncul adalah
kode resmi berurutan, lalu login di `/dashboard` dengan kode tersebut.

## Langkah 6 — Domain Sendiri (opsional)

**Settings → Domains → Add** → mis. `mpp.kesatriaacademy.id`:
- Tambahkan record sesuai instruksi Vercel di DNS pengelola domain (A `76.76.21.21` atau CNAME `cname.vercel-dns.com`)
- SSL gratis otomatis aktif
- Setelah live, update domain di `sitemap.xml`, `robots.txt`, dan env `BASE_PUBLIC_URL`

## Langkah 7 — Sebelum Go-Live (checklist dari dokumen proposal)

- [ ] Ganti kontak placeholder di footer `index.html` & `daftar.html`: email `mpp@kesatriaacademy.id`, nomor WhatsApp, username Instagram
- [ ] Konfirmasi nominal komisi final dengan tim finance (angka di kalkulator masih ilustratif dokumen)
- [ ] Set `ADMIN_TOKEN` yang kuat (jangan pakai contoh)
- [ ] Pasang analitik (Vercel Analytics / GA4) untuk KPI conversion rate
- [ ] Uji alur lengkap: daftar → onboarding → aktivasi kode → klik referral → dashboard

---

## Arsitektur di Vercel

```
Pengunjung ──► Vercel Edge Network (CDN global, SSL otomatis)
                ├── /                  → index.html   (statis, ter-cache)
                ├── /daftar            → daftar.html  (statis)
                ├── /dashboard         → dashboard.html (statis)
                └── /api/*             → Serverless Functions (Node 20)
                        ├── register.js      ─┐
                        ├── track.js          ├─► Vercel KV (Upstash Redis)
                        ├── partner/[code].js │     • pool 200 kode resmi (FIFO)
                        └── admin/stats.js   ─┘     • data mitra, klik, atribusi
```

**Catatan biaya:** Hobby plan Vercel = gratis (website + 100GB bandwidth + KV free tier).
Lebih dari cukup untuk target 40 mitra / 3 bulan pertama sesuai dokumen.

**Upgrade path:** jika skala membesar, migrasikan data KV → PostgreSQL
(skema siap pakai di `database/schema.sql`, panduan di `database/README.md`).
`server/index.js` tetap tersedia untuk deploy VPS/Docker.
