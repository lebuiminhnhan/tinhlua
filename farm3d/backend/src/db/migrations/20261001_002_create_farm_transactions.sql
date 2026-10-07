-- Migration: create_farm_transactions
-- Date: 2026-10-01
-- Description: OCB Farm — sổ thu chi Hạt OCB (US-21). Bảng APPEND-ONLY theo BR-27:
--              chỉ INSERT, không có route UPDATE/DELETE và không có cột updated_at.
--              `amount` dương = thu, âm = chi; `balance_after` là số dư sau giao dịch (>= 0 theo BR-9).

CREATE TABLE IF NOT EXISTS farm_transactions (
  id              BIGSERIAL    PRIMARY KEY,
  user_id         INT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  occurred_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  -- Loại giao dịch: buy_animal, feed, sell_product, checkin, streak_bonus, help_reward,
  -- anniversary, expand_plot, admin_adjust, ...
  kind            VARCHAR(50)  NOT NULL,
  amount          BIGINT       NOT NULL,
  balance_after   BIGINT       NOT NULL CHECK (balance_after >= 0),
  -- Tham chiếu tới đối tượng gây ra giao dịch (animal / plant / decor / plot / achievement ...)
  ref_type        VARCHAR(50),
  ref_id          TEXT,
  note            TEXT,
  -- Người thực hiện: NULL/= user_id khi chính chủ, khác user_id khi là admin hoặc đồng nghiệp giúp
  actor_user_id   INT          REFERENCES users(id) ON DELETE SET NULL,
  -- Chống ghi trùng khi client thử lại lệnh (POST /commands, POST /admin/users/:id/seeds)
  idempotency_key TEXT
  -- Không có updated_at — bản ghi bất biến (append-only, BR-27)
);

-- Lịch sử thu chi phân trang theo thời gian giảm dần (US-21)
CREATE INDEX IF NOT EXISTS idx_farm_transactions_user_occurred
  ON farm_transactions(user_id, occurred_at DESC);

-- Một khóa idempotency chỉ sinh tối đa một giao dịch cho mỗi nhân viên
CREATE UNIQUE INDEX IF NOT EXISTS uq_farm_transactions_user_idem
  ON farm_transactions(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
