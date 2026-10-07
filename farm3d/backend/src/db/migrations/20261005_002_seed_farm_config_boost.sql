-- Seed: farm_config (vật phẩm hỗ trợ)
-- Date: 2026-10-05
-- Description: OCB Farm — giá thuốc tăng trưởng (vật nuôi hoàn tất ngay chu kỳ sản phẩm)
--              và phân bón siêu cấp (cây lên ngay giai đoạn kế tiếp).
-- Usage: psql -U <user> -d <dbname> -f 20261005_002_seed_farm_config_boost.sql

INSERT INTO farm_config (key, value, unit, min_value, max_value, config_group, description) VALUES
  ('boost_price_growth_potion',    100, 'Hạt OCB', 0, 1000000, 'khac', 'Giá thuốc tăng trưởng: vật nuôi hoàn tất ngay chu kỳ tạo sản phẩm hiện tại'),
  ('boost_price_super_fertilizer',  80, 'Hạt OCB', 0, 1000000, 'khac', 'Giá phân bón siêu cấp: cây trồng lên ngay giai đoạn kế tiếp')
ON CONFLICT DO NOTHING;
