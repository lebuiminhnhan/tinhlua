-- Seed: apps — ocb-farm
-- Date: 2026-10-01
-- Description: OCB Farm — bản ghi app `ocb-farm` trong bảng `apps` (BR-25: access_mode = 'restricted').
--              Dự phòng cho môi trường không chạy auto-sync APPS_CATALOG khi server start
--              (vd: deploy Docker chỉ nạp file .sql). Không ghi đè nếu app đã tồn tại.
-- Usage: psql -U <user> -d <dbname> -f 20261001_011_seed_apps_ocb_farm.sql

INSERT INTO apps (id, name, description, route, category, author, is_active, access_mode) VALUES
  ('ocb-farm', 'Nông trại OCB', 'Nông trại 3D cá nhân — nuôi vật nuôi, trồng cây hoa và Cây OCB phát triển theo thâm niên làm việc.', 'modules/ocb-farm', 'Khác', 'OCB Tech Team', TRUE, 'restricted')
ON CONFLICT DO NOTHING;
