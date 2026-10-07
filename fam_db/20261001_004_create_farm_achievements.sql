-- Migration: create_farm_achievements
-- Date: 2026-10-01
-- Description: OCB Farm — thành tựu đã đạt (US-29). Idempotency bằng khóa tự nhiên
--              UNIQUE(user_id, achievement_code): một thành tựu chỉ mở khoá một lần và
--              không bị thu hồi kể cả khi thâm niên giảm (BR-8).

CREATE TABLE IF NOT EXISTS farm_achievements (
  id               BIGSERIAL    PRIMARY KEY,
  user_id          INT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_code VARCHAR(50)  NOT NULL,
  unlocked_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  -- Ảnh chụp bộ đếm tại thời điểm mở khoá, phục vụ hiển thị tiến trình
  progress         JSONB,
  CONSTRAINT uq_farm_achievements_user_code UNIQUE (user_id, achievement_code)
);

CREATE INDEX IF NOT EXISTS idx_farm_achievements_user_unlocked
  ON farm_achievements(user_id, unlocked_at DESC);
