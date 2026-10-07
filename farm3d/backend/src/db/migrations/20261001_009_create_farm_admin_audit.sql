-- Migration: create_farm_admin_audit
-- Date: 2026-10-01
-- Description: OCB Farm — lưu vết thao tác quản trị (BR-27): ai làm, lúc nào, giá trị trước và sau.
--              Bảng APPEND-ONLY: chỉ INSERT, không có route UPDATE/DELETE, không có updated_at.
--              `admin_user_id` không có ON DELETE để bản ghi lưu vết không thể mất người thực hiện.

CREATE TABLE IF NOT EXISTS farm_admin_audit (
  id              BIGSERIAL    PRIMARY KEY,
  admin_user_id   INT          NOT NULL REFERENCES users(id),
  -- NULL khi thao tác không nhắm vào một nhân viên cụ thể (ví dụ sửa cấu hình cân bằng game)
  target_user_id  INT          REFERENCES users(id) ON DELETE SET NULL,
  -- update_join_date, adjust_seeds, reset_farm, update_config, ...
  action          VARCHAR(50)  NOT NULL,
  before_value    JSONB,
  after_value     JSONB,
  reason          TEXT,
  -- Chống áp dụng trùng khi client thử lại (POST /admin/users/:id/seeds)
  idempotency_key TEXT,
  occurred_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  -- Không có updated_at — bản ghi bất biến (append-only, BR-27)
);

-- Xem lưu vết theo nhân viên bị tác động
CREATE INDEX IF NOT EXISTS idx_farm_admin_audit_target_occurred
  ON farm_admin_audit(target_user_id, occurred_at DESC);

-- Xem lưu vết theo người thực hiện
CREATE INDEX IF NOT EXISTS idx_farm_admin_audit_admin_occurred
  ON farm_admin_audit(admin_user_id, occurred_at DESC);

-- Một khóa idempotency chỉ áp dụng tối đa một lần cho mỗi loại thao tác
CREATE UNIQUE INDEX IF NOT EXISTS uq_farm_admin_audit_action_idem
  ON farm_admin_audit(action, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
