/* Perenderan tabel riwayat referral untuk dashboard mitra.

   Semua data dari API maupun data contoh dimasukkan lewat textContent, bukan
   lewat perakitan string HTML. textContent tidak pernah di-parse sebagai
   markup, sehingga data yang berisi tag HTML tetap tampil sebagai teks biasa.

   Berkas ini dipakai dua cara:
   - di browser, dimuat dengan <script src="assets/dashboard-render.js"> dan
     tersedia sebagai global MppDashboardRender;
   - di test Node, dimuat dengan require(). */
(function (root) {
  'use strict';

  var KELAS_BADGE_TERVERIFIKASI = 'verified';
  var KELAS_BADGE_MENUNGGU = 'pending';
  var KELAS_BADGE_PROSES = 'proses';

  /* Kelas badge diambil hanya dari daftar tetap. Nilai status dari data tidak
     pernah dipakai langsung sebagai nama kelas. */
  function badgeClassFor(status) {
    if (status === 'Terverifikasi') return KELAS_BADGE_TERVERIFIKASI;
    if (status === 'Menunggu Verifikasi') return KELAS_BADGE_MENUNGGU;
    return KELAS_BADGE_PROSES;
  }

  /* Menyamakan perilaku lama, yaitu penggabungan nilai dengan string kosong. */
  function asText(nilai) {
    return '' + nilai;
  }

  function buatSel(teks) {
    var sel = document.createElement('td');
    sel.textContent = teks;
    return sel;
  }

  /* formatRupiah sengaja diterima sebagai parameter supaya halaman tetap
     memakai satu fungsi format mata uang yang sama dengan kartu statistik. */
  function buildTransactionRow(transaksi, formatRupiah) {
    var data = transaksi || {};
    var kelasBadge = badgeClassFor(data.status);
    var terverifikasi = kelasBadge === KELAS_BADGE_TERVERIFIKASI;

    var baris = document.createElement('tr');
    baris.appendChild(buatSel(asText(data.tanggal)));
    baris.appendChild(buatSel(asText(data.nama)));
    baris.appendChild(buatSel(asText(data.program)));

    var selStatus = document.createElement('td');
    var badge = document.createElement('span');
    badge.className = 'badge ' + kelasBadge;
    badge.textContent = asText(data.status);
    selStatus.appendChild(badge);
    baris.appendChild(selStatus);

    baris.appendChild(buatSel(data.nilai ? formatRupiah(data.nilai) : '—'));

    var selKomisi = document.createElement('td');
    selKomisi.style.fontWeight = '700';
    selKomisi.style.color = terverifikasi ? 'var(--green)' : 'var(--muted)';
    selKomisi.textContent = terverifikasi ? formatRupiah(data.nilai * 0.07) : '—';
    baris.appendChild(selKomisi);

    return baris;
  }

  var api = {
    badgeClassFor: badgeClassFor,
    buildTransactionRow: buildTransactionRow
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MppDashboardRender = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
