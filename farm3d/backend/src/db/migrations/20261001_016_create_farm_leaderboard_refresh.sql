-- Migration: create_farm_leaderboard_refresh
-- Date: 2026-10-01
-- Description: OCB Farm — mốc làm mới gần nhất của `farm_states.total_assets_cached` (US-28).
--              Bảng một dòng duy nhất (id = 1). Backend khóa dòng này bằng
--              `SELECT ... FOR UPDATE SKIP LOCKED` khi làm mới để chỉ một tiến trình tính lại
--              tổng tài sản trong mỗi chu kỳ `leaderboard_refresh`.

CREATE TABLE IF NOT EXISTS farm_leaderboard_refresh (
  id            SMALLINT     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  refreshed_at  TIMESTAMPTZ,
  farm_count    INT          NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO farm_leaderboard_refresh (id, refreshed_at) VALUES (1, NULL)
ON CONFLICT DO NOTHING;
