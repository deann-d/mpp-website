# Aturan proyek MPP (Marketing Partner Program Kesatria Academy)

SISTEM: Windows, Windows PowerShell 5.1. Jangan pakai && atau sintaks bash.
Pisahkan perintah dengan baris baru atau titik koma (;).

STRUKTUR
- Node.js murni, tanpa dependensi npm. Jangan menambah dependensi tanpa izin.
- public/ halaman statis (index, daftar, dashboard, 404, assets/)
- api/ serverless function Vercel; api/_lib berisi store.js, kv.js, http.js
- server/index.js server Node standalone dengan penyimpanan JSON
- tools/test-vercel-api.js dan server/test.js adalah test otomatis
- PERHATIAN: logika bisnis ditulis dua kali (server/index.js dan api/_lib/store.js).
  Setiap perubahan logika harus diterapkan di KEDUANYA.

PERINTAH TEST (semua harus lulus sebelum item dianggap selesai)
- npm run test:vercel
- Terminal 1: $env:PORT="3100"; $env:DATA_KEY="x"; $env:ADMIN_TOKEN="r"; node server/index.js
- Terminal 2: $env:TEST_BASE="http://localhost:3100"; node server/test.js

ATURAN UI
- Tampilan mengikuti kesatria.wiratek.id. Warna dan font hanya diubah di :root
  pada public/assets/site.css.
- Dilarang emoji atau ikon dekoratif di kode, teks UI, komentar, dan pesan test.
- Jangan terlihat dibuat otomatis: tanpa label huruf kapital di atas judul,
  tanpa gradasi atau bayangan dekoratif, tanpa animasi masuk di tiap section.
- Teks berbahasa Indonesia, sentence case, kalimat aktif.

CARA KERJA
- Buat rencana singkat dulu dan tunggu persetujuan sebelum mengubah file.
- Kerjakan SATU item per giliran. Setelah selesai, jalankan semua test, ringkas
  file yang berubah, lalu BERHENTI dan tunggu review.
- Jangan mengubah hal di luar item yang diminta.
- Jangan menyentuh database/schema.sql dan jangan mengubah perilaku API kecuali diminta.
- Kalau ada yang ambigu, tanya. Jangan menebak.
- Tambahkan test untuk setiap perubahan perilaku.
- Jangan menjalankan git commit atau git push. Itu dikerjakan manusia.