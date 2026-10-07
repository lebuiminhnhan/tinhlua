-- Migration: create_farm_anniversary_claims
-- Date: 2026-10-01
-- Description: OCB Farm — hái quả ngày kỷ niệm vào làm (US-7). Idempotency bằng khóa tự nhiên
--              UNIQUE(user_id, anniversary_year): mỗi năm kỷ niệm chỉ hái được một lần (BR-6, BR-12).
--              `anniversary_year` là năm dương lịch của ngày kỷ niệm (ví dụ 2026).

CREATE TABLE IF NOT EXISTS farm_anniversary_claims (
  id               BIGSERIAL    PRIMARY KEY,
  user_id          INT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  anniversary_year INT          NOT NULL CHECK (anniversary_year BETWEEN 1990 AND 2200),
  -- Năm gắn bó thứ mấy tại thời điểm hái (>= 3 theo BR-4)
  seniority_years  INT          NOT NULL DEFAULT 0 CHECK (seniority_years >= 0),
  fruit_picked     INT          NOT NULL DEFAULT 0 CHECK (fruit_picked >= 0),
  reward_total     BIGINT       NOT NULL DEFAULT 0 CHECK (reward_total >= 0),
  claimed_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_farm_anniversary_claims_user_year UNIQUE (user_id, anniversary_year)
);

CREATE INDEX IF NOT EXISTS idx_farm_anniversary_claims_user_year
  ON farm_anniversary_claims(user_id, anniversary_year DESC);
