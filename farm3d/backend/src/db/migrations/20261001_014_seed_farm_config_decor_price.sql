-- Migration: seed_farm_config_decor_price
-- Date: 2026-10-01
-- Description: OCB Farm — giá mua vật phẩm trang trí theo từng nhóm (US-34, task 5.5).
--              `DecorKind` là chuỗi tự do do manifest tài nguyên 3D (task 10.5) quyết định,
--              nên giá được định nghĩa theo NHÓM (`DecorGroup`, 7 nhóm: fence, path, lamp,
--              bench, well, nameplate, seasonal) thay vì theo từng mã vật phẩm cụ thể —
--              mọi vật phẩm trong cùng một nhóm dùng chung giá `decor_price_<group>`.
-- Usage: psql -U <user> -d <dbname> -f 20261001_014_seed_farm_config_decor_price.sql

INSERT INTO farm_config (key, value, unit, min_value, max_value, config_group, description) VALUES
  ('decor_price_fence',       80,  'Hạt OCB', 1, 1000000, 'khac', 'Giá mua vật phẩm trang trí nhóm hàng rào'),
  ('decor_price_path',        60,  'Hạt OCB', 1, 1000000, 'khac', 'Giá mua vật phẩm trang trí nhóm đường đi'),
  ('decor_price_lamp',       150,  'Hạt OCB', 1, 1000000, 'khac', 'Giá mua vật phẩm trang trí nhóm đèn (nguồn sáng ban đêm)'),
  ('decor_price_bench',      120,  'Hạt OCB', 1, 1000000, 'khac', 'Giá mua vật phẩm trang trí nhóm ghế'),
  ('decor_price_well',       200,  'Hạt OCB', 1, 1000000, 'khac', 'Giá mua vật phẩm trang trí nhóm giếng nước'),
  ('decor_price_nameplate',  100,  'Hạt OCB', 1, 1000000, 'khac', 'Giá mua vật phẩm trang trí nhóm bảng tên nông trại'),
  ('decor_price_seasonal',   250,  'Hạt OCB', 1, 1000000, 'khac', 'Giá mua vật phẩm trang trí giới hạn theo dịp lễ/mùa')
ON CONFLICT DO NOTHING;
