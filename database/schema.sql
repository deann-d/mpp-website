-- ============================================================
-- SKEMA DATABASE — Marketing Partner Program (MPP)
-- Kompatibel: PostgreSQL 14+ / Supabase / Neon
-- Jalankan sekali saat provisioning database.
-- ============================================================

-- ---------- 1. MITRA (Marketing Partner) ----------
CREATE TABLE IF NOT EXISTS partners (
  id              BIGSERIAL PRIMARY KEY,
  ref_code        TEXT NOT NULL UNIQUE,          -- KSA-######-MPP
  nama            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,
  whatsapp        TEXT NOT NULL,
  kota            TEXT,
  status          TEXT NOT NULL CHECK (status IN ('Mahasiswa Aktif','Fresh Graduate','Freelancer','Lainnya')),
  institusi       TEXT,
  jurusan         TEXT,
  semester        TEXT,
  akun_sosmed     TEXT,
  platform_sosmed TEXT,                          -- dipisah koma
  motivasi        TEXT,

  -- pencairan komisi
  metode_bayar    TEXT CHECK (metode_bayar IN ('bank','ewallet')),
  nama_rekening   TEXT,
  no_rekening     TEXT,                          -- WAJIB dienkripsi di level aplikasi

  -- persetujuan (bukti audit)
  setuju_etika    BOOLEAN NOT NULL DEFAULT FALSE,
  setuju_data     BOOLEAN NOT NULL DEFAULT FALSE,
  setuju_status   BOOLEAN NOT NULL DEFAULT FALSE,
  ip_pendaftar    INET,
  user_agent      TEXT,

  -- siklus hidup mitra
  tier            TEXT NOT NULL DEFAULT 'starter'
                    CHECK (tier IN ('starter','active','lead')),
  lifecycle       TEXT NOT NULL DEFAULT 'menunggu_verifikasi'
                    CHECK (lifecycle IN ('menunggu_verifikasi','onboarding','aktif','suspended','terminated')),
  onboarding_at   TIMESTAMPTZ,
  activated_at    TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partners_lifecycle ON partners(lifecycle);
CREATE INDEX IF NOT EXISTS idx_partners_tier     ON partners(tier);
CREATE INDEX IF NOT EXISTS idx_partners_email    ON partners(email);

-- ---------- 2. POOL KODE REFERRAL ----------
-- Berisi 200 kode resmi dari Lampiran S dokumen proposal.
-- Kode dialokasikan ke mitra secara berurutan (FIFO), bukan dibuat acak,
-- sehingga kode di website selalu identik dengan kode di dokumen.
CREATE TABLE IF NOT EXISTS ref_codes (
  code        TEXT PRIMARY KEY,
  partner_id  BIGINT REFERENCES partners(id) ON DELETE SET NULL,
  allocated_at TIMESTAMPTZ,
  is_active   BOOLEAN NOT NULL DEFAULT FALSE     -- aktif setelah onboarding selesai
);

CREATE INDEX IF NOT EXISTS idx_ref_codes_unassigned
  ON ref_codes(allocated_at NULLS FIRST) WHERE partner_id IS NULL;

-- ---------- 3. PROSPEK & ATRIBUTI REFERAL ----------
-- First-click attribution sesuai FAQ no.7 dokumen:
-- prospek dikunci ke mitra yang klik/kodenya tercatat PERTAMA.
CREATE TABLE IF NOT EXISTS referrals (
  id            BIGSERIAL PRIMARY KEY,
  ref_code      TEXT NOT NULL REFERENCES ref_codes(code),
  prospect_key  TEXT NOT NULL,   -- hash email/no.WA prospek (jaga privasi)
  prospect_name TEXT,
  program       TEXT,            -- bootcamp yang diminati
  utm_source    TEXT,
  utm_medium    TEXT,
  utm_campaign  TEXT,
  landing_url   TEXT,
  ip_address    INET,
  user_agent    TEXT,
  clicked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_first_click BOOLEAN NOT NULL DEFAULT TRUE
);

-- Satu prospek hanya boleh dikunci ke SATU mitra (enforce first-click di DB)
CREATE UNIQUE INDEX IF NOT EXISTS uq_referrals_prospect ON referrals(prospect_key);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(ref_code, clicked_at DESC);

-- ---------- 4. FUNNEL / STATUS PROSPEK ----------
CREATE TABLE IF NOT EXISTS referral_status (
  id            BIGSERIAL PRIMARY KEY,
  referral_id   BIGINT NOT NULL REFERENCES referrals(id) ON DELETE CASCADE,
  stage         TEXT NOT NULL CHECK (stage IN ('klik','konsultasi','closing','ditolak','refund')),
  catatan       TEXT,
  changed_by    TEXT,            -- id/email staf admisi
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refstatus_ref ON referral_status(referral_id, changed_at DESC);

-- ---------- 5. TRANSAKSI CLOSING ----------
CREATE TABLE IF NOT EXISTS closings (
  id            BIGSERIAL PRIMARY KEY,
  referral_id   BIGINT NOT NULL UNIQUE REFERENCES referrals(id),
  batch_code    TEXT,            -- periode batch bootcamp
  revenue       NUMERIC(14,2) NOT NULL CHECK (revenue >= 0),
  verified      BOOLEAN NOT NULL DEFAULT FALSE,
  verified_by   TEXT,
  verified_at   TIMESTAMPTZ,
  closing_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_closings_batch ON closings(batch_code, verified);

-- ---------- 6. KOMISI ----------
CREATE TABLE IF NOT EXISTS commissions (
  id            BIGSERIAL PRIMARY KEY,
  partner_id    BIGINT NOT NULL REFERENCES partners(id),
  closing_id    BIGINT REFERENCES closings(id),
  period_month  DATE NOT NULL,           -- 1st of month, mis. 2026-10-01
  tier_at_time  TEXT NOT NULL,           -- snapshot tier saat dihitung
  kind          TEXT NOT NULL CHECK (kind IN ('per_closing','batch_bonus')),
  rate          NUMERIC(5,4) NOT NULL,   -- 0.0700 atau 0.0500
  base_amount   NUMERIC(14,2) NOT NULL,
  amount        NUMERIC(14,2) NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','paid','rejected','reversed')),
  paid_at       TIMESTAMPTZ,
  payout_ref    TEXT,                    -- no. referensi transfer
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comm_partner_period ON commissions(partner_id, period_month, status);

-- ---------- 7. PAYOUT (Pencairan Bulanan) ----------
CREATE TABLE IF NOT EXISTS payouts (
  id            BIGSERIAL PRIMARY KEY,
  partner_id    BIGINT NOT NULL REFERENCES partners(id),
  period_month  DATE NOT NULL,
  total_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
  metode        TEXT,
  destination   TEXT,                    -- terenkripsi di level aplikasi
  status        TEXT NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','processing','sent','failed')),
  scheduled_for DATE,                    -- tgl 10 bulan berikutnya (sesuai FAQ no.4)
  sent_at       TIMESTAMPTZ,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (partner_id, period_month)
);

-- ---------- 8. PELANGGARAN KODE ETIK ----------
CREATE TABLE IF NOT EXISTS violations (
  id            BIGSERIAL PRIMARY KEY,
  partner_id    BIGINT NOT NULL REFERENCES partners(id),
  kategori      TEXT NOT NULL CHECK (kategori IN
                  ('informasi_menyesatkan','spamming','harga_tidak_resmi','identitas_tidak_transparan','lainnya')),
  deskripsi     TEXT,
  bukti_url     TEXT,
  sanksi        TEXT NOT NULL DEFAULT 'peringatan'
                  CHECK (sanksi IN ('peringatan','suspension','terminasi')),
  reported_by   TEXT,
  resolved      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_violations_partner ON violations(partner_id, created_at DESC);

-- ---------- 9. AUDIT LOG ----------
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  entity      TEXT,
  entity_id   BIGINT,
  payload     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);

-- ---------- 10. VIEW: RINGKASAN PERFORMA MITRA ----------
-- Dipakai langsung oleh dashboard.html (menggantikan data mock).
CREATE OR REPLACE VIEW v_partner_performance AS
SELECT
  p.id,
  p.ref_code,
  p.nama,
  p.tier,
  p.lifecycle,
  COUNT(DISTINCT r.id)                                        AS total_klik,
  COUNT(DISTINCT r.id) FILTER (WHERE rs.stage = 'konsultasi') AS total_konsultasi,
  COUNT(DISTINCT c.id) FILTER (WHERE c.verified)              AS total_closing,
  COUNT(DISTINCT c.id) FILTER (WHERE c.verified
        AND date_trunc('month', c.closing_date) = date_trunc('month', CURRENT_DATE))
                                                              AS closing_bulan_ini,
  COALESCE(SUM(c.revenue) FILTER (WHERE c.verified), 0)       AS total_revenue,
  COALESCE(SUM(cm.amount) FILTER (WHERE cm.status = 'paid'), 0)   AS komisi_terbayar,
  COALESCE(SUM(cm.amount) FILTER (WHERE cm.status <> 'paid'
                                  AND cm.status <> 'rejected'), 0) AS komisi_pending
FROM partners p
LEFT JOIN referrals r        ON r.ref_code = p.ref_code
LEFT JOIN referral_status rs ON rs.referral_id = r.id
LEFT JOIN closings c         ON c.referral_id = r.id
LEFT JOIN commissions cm     ON cm.partner_id = p.id
GROUP BY p.id, p.ref_code, p.nama, p.tier, p.lifecycle;

-- ---------- 11. FUNGSI: PENENTUAN TIER OTOMATIS ----------
-- Sesuai dokumen bagian K: Starter (<3), Active (>=3), Lead (>=10) closing/bulan.
CREATE OR REPLACE FUNCTION fn_recalc_tier(p_partner_id BIGINT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v_closing INT;
  v_tier    TEXT;
BEGIN
  SELECT COUNT(*) INTO v_closing
  FROM closings c
  JOIN referrals r ON r.id = c.referral_id
  JOIN partners p  ON p.ref_code = r.ref_code
  WHERE p.id = p_partner_id
    AND c.verified
    AND date_trunc('month', c.closing_date) = date_trunc('month', CURRENT_DATE);

  v_tier := CASE WHEN v_closing >= 10 THEN 'lead'
                 WHEN v_closing >= 3  THEN 'active'
                 ELSE 'starter' END;

  UPDATE partners
     SET tier = v_tier, updated_at = now()
   WHERE id = p_partner_id AND tier <> v_tier;

  INSERT INTO audit_log(actor, action, entity, entity_id, payload)
  VALUES ('system','tier_recalc','partners', p_partner_id,
          jsonb_build_object('closing_bulan_ini', v_closing, 'tier_baru', v_tier));

  RETURN v_tier;
END $$;

-- ---------- 12. FUNGSI: HITUNG KOMISI SATU CLOSING ----------
CREATE OR REPLACE FUNCTION fn_calc_commission(p_closing_id BIGINT)
RETURNS NUMERIC LANGUAGE plpgsql AS $$
DECLARE
  v_close   closings%ROWTYPE;
  v_ref     referrals%ROWTYPE;
  v_partner partners%ROWTYPE;
  v_bonus   NUMERIC(14,2) := 0;
  v_total   NUMERIC(14,2) := 0;
BEGIN
  SELECT * INTO v_close FROM closings WHERE id = p_closing_id AND verified;
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT * INTO v_ref     FROM referrals WHERE id = v_close.referral_id;
  SELECT * INTO v_partner FROM partners  WHERE ref_code = v_ref.ref_code;

  -- idempoten: jangan hitung dua kali
  IF EXISTS (SELECT 1 FROM commissions WHERE closing_id = p_closing_id) THEN
    RETURN 0;
  END IF;

  -- Komisi dasar 7% per closing (semua tier)
  INSERT INTO commissions(partner_id, closing_id, period_month, tier_at_time,
                          kind, rate, base_amount, amount, status)
  VALUES (v_partner.id, p_closing_id,
          date_trunc('month', v_close.closing_date)::date, v_partner.tier,
          'per_closing', 0.0700, v_close.revenue, v_close.revenue * 0.0700, 'pending')
  RETURNING amount INTO v_total;

  -- Bonus 5% revenue per batch hanya untuk tier active & lead
  IF v_partner.tier IN ('active','lead') THEN
    v_bonus := v_close.revenue * 0.0500;
    INSERT INTO commissions(partner_id, closing_id, period_month, tier_at_time,
                            kind, rate, base_amount, amount, status)
    VALUES (v_partner.id, p_closing_id,
            date_trunc('month', v_close.closing_date)::date, v_partner.tier,
            'batch_bonus', 0.0500, v_close.revenue, v_bonus, 'pending');
    v_total := v_total + v_bonus;
  END IF;

  PERFORM fn_recalc_tier(v_partner.id);
  RETURN v_total;
END $$;

-- ---------- 13. TRIGGER updated_at ----------
CREATE OR REPLACE FUNCTION fn_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_partners_touch ON partners;
CREATE TRIGGER trg_partners_touch BEFORE UPDATE ON partners
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();
