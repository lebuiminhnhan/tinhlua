-- Migration: create_farm_helps
-- Date: 2026-10-01
-- Description: OCB Farm — lượt giúp đồng nghiệp tưới cây / cho ăn (US-27). Idempotency bằng khóa
--              tự nhiên UNIQUE(helper_user_id, owner_user_id, help_date): mỗi nông trại chỉ được
--              cùng một người giúp một lần trong ngày (BR-22). Hạn mức lượt giúp/ngày đếm theo
--              (helper_user_id, help_date). `help_date` do backend tính theo UTC+7.

CREATE TABLE IF NOT EXISTS farm_helps (
  id              BIGSERIAL    PRIMARY KEY,
  helper_user_id  INT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_user_id   INT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  help_date       DATE         NOT NULL,
  action_type     VARCHAR(20)  NOT NULL CHECK (action_type IN ('water', 'feed')),
  -- Hạt OCB thưởng cho người giúp
  reward          BIGINT       NOT NULL DEFAULT 0 CHECK (reward >= 0),
  -- Cờ "mới" trong hộp thư của chủ nông trại (US-8, US-27)
  seen_by_owner   BOOLEAN      NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_farm_helps_helper_owner_date UNIQUE (helper_user_id, owner_user_id, help_date),
  CONSTRAINT ck_farm_helps_not_self CHECK (helper_user_id <> owner_user_id)
);

-- Hộp thư "ai đã giúp nông trại của tôi" + kiểm tra đã được giúp trong ngày chưa
CREATE INDEX IF NOT EXISTS idx_farm_helps_owner_date
  ON farm_helps(owner_user_id, help_date);

-- Đếm hạn mức lượt giúp mỗi ngày của một nhân viên (BR-22)
CREATE INDEX IF NOT EXISTS idx_farm_helps_helper_date
  ON farm_helps(helper_user_id, help_date);
