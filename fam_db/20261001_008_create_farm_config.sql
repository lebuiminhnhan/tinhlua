-- Migration: create_farm_config
-- Date: 2026-10-01
-- Description: OCB Farm — thông số cân bằng game, admin sửa được mà không đổi code (US-45).
--              Mỗi dòng là một khóa cấu hình: giá trị số + đơn vị + khoảng hợp lệ (min/max)
--              để trang quản trị kiểm tra đầu vào ngay ở mức DB.

CREATE TABLE IF NOT EXISTS farm_config (
  key          VARCHAR(100) PRIMARY KEY,
  value        NUMERIC      NOT NULL,
  unit         VARCHAR(30),
  min_value    NUMERIC,
  max_value    NUMERIC,
  -- Nhóm hiển thị trên trang cấu hình: khoi_tao, cay_ocb, vat_nuoi, cay_trong, kho,
  -- kinh_te, dat, checkin, giup_do, gioi_han, moi_truong, hieu_nang, xep_hang, khac
  config_group VARCHAR(50)  NOT NULL DEFAULT 'khac',
  description  TEXT,
  updated_by   INT          REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_farm_config_range CHECK (
    min_value IS NULL OR max_value IS NULL OR min_value <= max_value
  ),
  CONSTRAINT ck_farm_config_value_in_range CHECK (
    (min_value IS NULL OR value >= min_value) AND (max_value IS NULL OR value <= max_value)
  )
);

CREATE INDEX IF NOT EXISTS idx_farm_config_group
  ON farm_config(config_group, key);
