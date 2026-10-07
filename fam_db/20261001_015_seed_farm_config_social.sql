-- Seed: farm_config (nhóm giúp đỡ / lời chúc)
-- Date: 2026-10-01
-- Description: OCB Farm — bổ sung hạn mức lời chúc mỗi ngày cho mỗi nông trại (US-48).
--              Ngày kỷ niệm vào làm của chủ nông trại luôn giới hạn 1 lời chúc / người (US-8),
--              không phụ thuộc khóa này.

INSERT INTO farm_config (key, value, unit, min_value, max_value, config_group, description) VALUES
  ('greeting_quota_per_day', 3, 'lượt', 1, 100, 'khac', 'Số lời chúc / biểu cảm tối đa một nhân viên gửi cho mỗi nông trại trong một ngày (UTC+7)')
ON CONFLICT DO NOTHING;
