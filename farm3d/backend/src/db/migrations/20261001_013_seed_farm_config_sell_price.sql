-- Migration: seed_farm_config_sell_price
-- Date: 2026-10-01
-- Description: OCB Farm — bổ sung giá bán một đơn vị cho mỗi sản phẩm trong kho
--              (task 5.4, `SELL_PRODUCT`). Thiếu ở `20261001_010_seed_farm_config.sql`
--              vì bảng "Cấu hình cân bằng game" trong design.md không liệt kê riêng
--              giá bán — chỉ có giá mua (`animal_price_*`, `seed_price_*`). Đặt giá
--              bán bằng khoảng 40% giá mua tương ứng (thấp hơn `resell_ratio` 50%
--              của vật nuôi/cây để tạo chênh lệch lãi hợp lý qua chu kỳ nuôi/trồng
--              nhiều lần, theo đúng tinh thần US-21/US-22: "kiếm và tiêu vào đâu").

INSERT INTO farm_config (key, value, unit, min_value, max_value, config_group, description) VALUES
  -- Sản phẩm vật nuôi (US-13)
  ('sell_price_egg',     10, 'Hạt OCB/đơn vị', 1, 1000000, 'kinh_te', 'Giá bán một quả trứng'),
  ('sell_price_milk',    20, 'Hạt OCB/đơn vị', 1, 1000000, 'kinh_te', 'Giá bán một đơn vị sữa'),
  ('sell_price_wool',    25, 'Hạt OCB/đơn vị', 1, 1000000, 'kinh_te', 'Giá bán một đơn vị len'),
  ('sell_price_fish',    15, 'Hạt OCB/đơn vị', 1, 1000000, 'kinh_te', 'Giá bán một con cá tươi'),
  ('sell_price_manure',   5, 'Hạt OCB/đơn vị', 1, 1000000, 'kinh_te', 'Giá bán một đơn vị phân hữu cơ'),
  -- Quả (US-20)
  ('sell_price_banana',  14, 'Hạt OCB/đơn vị', 1, 1000000, 'kinh_te', 'Giá bán một quả chuối'),
  ('sell_price_orange',  17, 'Hạt OCB/đơn vị', 1, 1000000, 'kinh_te', 'Giá bán một quả cam'),
  ('sell_price_mango',   20, 'Hạt OCB/đơn vị', 1, 1000000, 'kinh_te', 'Giá bán một quả xoài'),
  -- Hoa (US-20)
  ('sell_price_sunflower', 5, 'Hạt OCB/đơn vị', 1, 1000000, 'kinh_te', 'Giá bán một bông hoa hướng dương'),
  ('sell_price_daisy',     8, 'Hạt OCB/đơn vị', 1, 1000000, 'kinh_te', 'Giá bán một bông hoa cúc'),
  ('sell_price_rose',     12, 'Hạt OCB/đơn vị', 1, 1000000, 'kinh_te', 'Giá bán một bông hoa hồng')
ON CONFLICT DO NOTHING;
