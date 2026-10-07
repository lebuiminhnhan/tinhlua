-- Migration: create_farm_command_results
-- Date: 2026-10-01
-- Description: OCB Farm — cache idempotency cho POST /api/ocb-farm/commands (US-40).
--              Nhiều lệnh (ví dụ MOVE_ENTITY, ROTATE_DECOR) không phát sinh dòng
--              farm_transactions nào, nên UNIQUE(user_id, idempotency_key) của
--              farm_transactions (20261001_002) không đủ để chặn áp lệnh hai lần khi
--              client gửi lại request với cùng idempotency_key (mất mạng, double-tap).
--              Bảng này lưu đúng response 200 đã trả cho lần áp lệnh THÀNH CÔNG đầu
--              tiên của mỗi (user_id, idempotency_key) — lần gọi lại chỉ đọc lại dòng
--              này và trả nguyên vẹn, không chạy lại logic nghiệp vụ.
--              Không lưu các lần bị từ chối (409/422): client gửi lại cùng khóa sau khi
--              sửa request vẫn phải được xử lý lại bình thường.

CREATE TABLE IF NOT EXISTS farm_command_results (
  user_id         INT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT         NOT NULL,
  command         VARCHAR(50)  NOT NULL,
  -- Response 200 (FarmCommandSuccessResponse) đã trả cho lần áp lệnh gốc, trả lại
  -- nguyên vẹn cho mọi lần gọi lại cùng khóa.
  response        JSONB        NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, idempotency_key)
);

-- Dọn bớt các dòng cũ không còn cần giữ lâu dài (idempotency chỉ cần hiệu lực trong
-- phạm vi "client thử lại ngay sau lỗi mạng", không cần giữ vĩnh viễn).
CREATE INDEX IF NOT EXISTS idx_farm_command_results_created_at
  ON farm_command_results(created_at);
