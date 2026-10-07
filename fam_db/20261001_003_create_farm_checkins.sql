-- Migration: create_farm_checkins
-- Date: 2026-10-01
-- Description: OCB Farm — check-in hằng ngày (US-25). Idempotency bằng khóa tự nhiên
--              UNIQUE(user_id, checkin_date): mỗi nhân viên chỉ nhận thưởng một lần cho
--              mỗi ngày theo giờ Việt Nam (BR-13). `checkin_date` do backend tính theo UTC+7.

CREATE TABLE IF NOT EXISTS farm_checkins (
  id           BIGSERIAL    PRIMARY KEY,
  user_id      INT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checkin_date DATE         NOT NULL,
  -- Thưởng cơ bản của ngày
  reward       BIGINT       NOT NULL DEFAULT 0 CHECK (reward >= 0),
  -- Thưởng thêm khi chạm mốc chuỗi (3 / 7 / 14 / 30 ngày)
  streak_bonus BIGINT       NOT NULL DEFAULT 0 CHECK (streak_bonus >= 0),
  -- Độ dài chuỗi sau khi ghi nhận ngày này
  streak_after INT          NOT NULL DEFAULT 1 CHECK (streak_after >= 1),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_farm_checkins_user_date UNIQUE (user_id, checkin_date)
);

CREATE INDEX IF NOT EXISTS idx_farm_checkins_user_date
  ON farm_checkins(user_id, checkin_date DESC);
