-- Migration: create_farm_greetings
-- Date: 2026-10-01
-- Description: OCB Farm — lời chúc / biểu cảm gửi lên nông trại đồng nghiệp (US-8, US-48).
--              Hạn mức số lượt gửi mỗi nông trại mỗi ngày đếm theo
--              (sender_user_id, owner_user_id, greet_date) — `greet_date` tính theo UTC+7.
--              Chủ nông trại xoá được lời chúc: dùng xoá mềm (`deleted_at`) để nội dung không
--              hiển thị lại nhưng hạn mức trong ngày vẫn đếm đúng.

CREATE TABLE IF NOT EXISTS farm_greetings (
  id             BIGSERIAL    PRIMARY KEY,
  sender_user_id INT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_user_id  INT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  greet_date     DATE         NOT NULL,
  kind           VARCHAR(20)  NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'emoji')),
  message        TEXT         NOT NULL,
  -- Cờ "mới" trong hộp thư của chủ nông trại
  seen_by_owner  BOOLEAN      NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ,
  CONSTRAINT ck_farm_greetings_not_self CHECK (sender_user_id <> owner_user_id)
);

-- Hộp thư lời chúc của chủ nông trại, mới nhất trước, bỏ qua bản ghi đã xoá
CREATE INDEX IF NOT EXISTS idx_farm_greetings_owner_created
  ON farm_greetings(owner_user_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Đếm hạn mức gửi trong ngày cho một nông trại (US-48)
CREATE INDEX IF NOT EXISTS idx_farm_greetings_sender_owner_date
  ON farm_greetings(sender_user_id, owner_user_id, greet_date);
