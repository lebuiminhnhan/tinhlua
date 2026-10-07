-- Seed: farm_config (mở rộng nông trại)
-- Date: 2026-10-05
-- Description: OCB Farm — giá nhóm trang trí mới (cây cảnh, bụi cây, khóm hoa, luống rau,
--              trái cây trang trí), giá mở các vùng đất/ao mới 8..14 (vùng 7 là ao khởi đầu
--              miễn phí, mặc định đã mở) và nâng giới hạn trang trí cho phù hợp diện tích lớn hơn.
-- Usage: psql -U <user> -d <dbname> -f 20261005_001_seed_farm_config_expansion.sql

INSERT INTO farm_config (key, value, unit, min_value, max_value, config_group, description) VALUES
  ('decor_price_tree',       300, 'Hạt OCB', 1, 1000000, 'khac', 'Giá mua vật phẩm trang trí nhóm cây cảnh'),
  ('decor_price_bush',        90, 'Hạt OCB', 1, 1000000, 'khac', 'Giá mua vật phẩm trang trí nhóm bụi cây'),
  ('decor_price_flowerbed',   70, 'Hạt OCB', 1, 1000000, 'khac', 'Giá mua vật phẩm trang trí nhóm khóm hoa / thảm hoa'),
  ('decor_price_crop',       110, 'Hạt OCB', 1, 1000000, 'khac', 'Giá mua vật phẩm trang trí nhóm luống rau'),
  ('decor_price_produce',     50, 'Hạt OCB', 1, 1000000, 'khac', 'Giá mua vật phẩm trang trí nhóm trái cây trang trí'),
  ('expand_price_plot8',    3000, 'Hạt OCB', 1, 10000000, 'dat', 'Giá mở vùng ao số 8 (mở rộng ao khởi đầu)'),
  ('expand_price_plot9',   30000, 'Hạt OCB', 1, 10000000, 'dat', 'Giá mở vùng đất số 9'),
  ('expand_price_plot10',  40000, 'Hạt OCB', 1, 10000000, 'dat', 'Giá mở vùng đất số 10'),
  ('expand_price_plot11',  45000, 'Hạt OCB', 1, 10000000, 'dat', 'Giá mở vùng đất số 11'),
  ('expand_price_plot12',  55000, 'Hạt OCB', 1, 10000000, 'dat', 'Giá mở vùng đất số 12'),
  ('expand_price_plot13',  70000, 'Hạt OCB', 1, 10000000, 'dat', 'Giá mở vùng đất số 13'),
  ('expand_price_plot14',   8000, 'Hạt OCB', 1, 10000000, 'dat', 'Giá mở vùng ao số 14')
ON CONFLICT DO NOTHING;

-- Giới hạn trang trí: chỉ nâng khi quản trị chưa chỉnh khỏi giá trị mặc định cũ.
UPDATE farm_config SET value = 120 WHERE key = 'max_decors' AND value = 60;
