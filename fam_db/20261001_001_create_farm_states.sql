-- Migration: create_farm_states
-- Date: 2026-10-01
-- Description: OCB Farm — trạng thái nông trại, 1 dòng / nhân viên (server-authoritative).
--              `state`/`settings` là JSONB (đồ thị thực thể nông trại + thiết lập theo người dùng),
--              `version` là khóa lạc quan (optimistic lock) cho đa thiết bị (US-40),
--              `seeds >= 0` biến BR-9 (không được âm Hạt OCB) thành bất biến của DB.

CREATE TABLE IF NOT EXISTS farm_states (
  user_id                INT          PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  farm_name              VARCHAR(100),
  join_date              DATE,
  -- Nguồn ngày vào làm: hr = lấy từ LDAP/users, self = nhân viên tự khai, admin = quản trị viên sửa
  join_date_source       VARCHAR(20)  CHECK (join_date_source IN ('hr', 'self', 'admin')),
  -- true khi admin đã sửa ngày vào làm — nhân viên không tự đổi được nữa (BR-7)
  join_date_admin_locked BOOLEAN      NOT NULL DEFAULT false,
  -- Số dư Hạt OCB — không bao giờ âm (BR-9)
  seeds                  BIGINT       NOT NULL DEFAULT 0 CHECK (seeds >= 0),
  checkin_streak         INT          NOT NULL DEFAULT 0 CHECK (checkin_streak >= 0),
  last_checkin_date      DATE,
  -- Tổng giá trị tài sản đã tính sẵn, phục vụ xếp hạng (US-28)
  total_assets_cached    BIGINT       NOT NULL DEFAULT 0 CHECK (total_assets_cached >= 0),
  -- Đồ thị thực thể nông trại: plots, animals, plants, decors, storage, tree, badges_shown, counters
  state                  JSONB        NOT NULL DEFAULT '{}'::jsonb,
  -- quality, quality_manual, bgm, sfx, scene_lock — theo nhân viên nên giữ nguyên khi đổi thiết bị (US-32, US-36)
  settings               JSONB        NOT NULL DEFAULT '{}'::jsonb,
  -- Khóa lạc quan: mọi lệnh thành công tăng 1; lệch version → 409 (US-22, US-40)
  version                INT          NOT NULL DEFAULT 0 CHECK (version >= 0),
  -- Mốc mô phỏng gần nhất — server tick từ mốc này tới hiện tại trước khi áp lệnh (US-23)
  last_tick_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_seen_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Xếp hạng theo thâm niên (join_date càng cũ càng cao)
CREATE INDEX IF NOT EXISTS idx_farm_states_join_date
  ON farm_states(join_date);

-- Xếp hạng theo tổng tài sản
CREATE INDEX IF NOT EXISTS idx_farm_states_total_assets
  ON farm_states(total_assets_cached DESC);

-- Xếp hạng theo chuỗi check-in
CREATE INDEX IF NOT EXISTS idx_farm_states_checkin_streak
  ON farm_states(checkin_streak DESC);
