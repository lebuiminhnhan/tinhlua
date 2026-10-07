-- Seed: farm_config
-- Date: 2026-10-01
-- Description: OCB Farm — bộ thông số cân bằng game khởi điểm (design mục "Cấu hình cân bằng game", XN-3).
--              Mỗi khóa là một giá trị NUMERIC duy nhất; các thông số phủ nhiều loài/nhiều mốc
--              được tách thành nhiều khóa có hậu tố rõ nghĩa (vd: animal_price_chicken,
--              expand_price_plot2, streak_bonus_3, day_phase_morning_start).
--              min_value/max_value là khoảng hợp lệ mà trang quản trị (US-45) được phép nhập.
-- Usage: psql -U <user> -d <dbname> -f 20261001_010_seed_farm_config.sql

-- =============================================================================
-- [1] KHỞI TẠO
-- =============================================================================
INSERT INTO farm_config (key, value, unit, min_value, max_value, config_group, description) VALUES
  ('initial_seeds', 500, 'Hạt OCB', 0, 1000000, 'khoi_tao', 'Số Hạt OCB được cấp khi khởi tạo nông trại lần đầu')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- [2] CÂY OCB
-- =============================================================================
INSERT INTO farm_config (key, value, unit, min_value, max_value, config_group, description) VALUES
  ('ocb_founded_year',        1996, 'năm',     1900, 2100,    'cay_ocb', 'Năm thành lập OCB — chặn dưới của ngày vào làm (XN-5)'),
  ('tree_max_milestone',        40, 'mốc',        1, 200,     'cay_ocb', 'Số mốc phát triển tối đa của Cây OCB (mỗi mốc 6 tháng, 40 mốc ≈ 20 năm)'),
  ('tree_max_branches',         30, 'nhánh',      0, 200,     'cay_ocb', 'Số nhánh tối đa của Cây OCB (nhánh = số năm tròn trừ 2)'),
  ('anniversary_min_years',      3, 'năm',        0, 50,      'cay_ocb', 'Thâm niên tối thiểu để Cây OCB ra hoa kết quả ngày kỷ niệm'),
  ('anniversary_fruit_count',    5, 'quả',        1, 50,      'cay_ocb', 'Số quả hái được trong ngày kỷ niệm vào làm'),
  ('anniversary_reward',       500, 'Hạt OCB',    0, 1000000, 'cay_ocb', 'Hạt OCB thưởng khi hái quả kỷ niệm (một lần mỗi năm)'),
  ('anniversary_grace_days',     7, 'ngày',       0, 90,      'cay_ocb', 'Số ngày ân hạn sau ngày kỷ niệm vẫn còn nhận được thưởng')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- [3] VẬT NUÔI — giá mua, chi phí cho ăn, độ no, chu kỳ sản phẩm, thưởng ngựa
-- =============================================================================
INSERT INTO farm_config (key, value, unit, min_value, max_value, config_group, description) VALUES
  ('animal_price_chicken',     100, 'Hạt OCB',    1, 1000000, 'vat_nuoi', 'Giá mua gà'),
  ('animal_price_fish',        150, 'Hạt OCB',    1, 1000000, 'vat_nuoi', 'Giá mua cá (chỉ đặt được trên ô nước)'),
  ('animal_price_sheep',       250, 'Hạt OCB',    1, 1000000, 'vat_nuoi', 'Giá mua cừu'),
  ('animal_price_pig',         300, 'Hạt OCB',    1, 1000000, 'vat_nuoi', 'Giá mua heo'),
  ('animal_price_cow',         500, 'Hạt OCB',    1, 1000000, 'vat_nuoi', 'Giá mua bò'),
  ('animal_price_horse',       800, 'Hạt OCB',    1, 1000000, 'vat_nuoi', 'Giá mua ngựa (không có sản phẩm thu hoạch, chỉ cộng thưởng giá bán)'),
  ('feed_cost_ratio',           10, '% giá mua',  0, 100,     'vat_nuoi', 'Chi phí một lần cho ăn, tính theo phần trăm giá mua của vật nuôi'),
  ('fullness_decay_hours',      24, 'giờ',        1, 240,     'vat_nuoi', 'Thời gian để độ no giảm từ 100% về 0% (sàn 0, vật nuôi chuyển trạng thái buồn)'),
  ('produce_cycle_chicken',      2, 'giờ',        1, 168,     'vat_nuoi', 'Chu kỳ tạo một sản phẩm của gà (trứng)'),
  ('produce_cycle_fish',         3, 'giờ',        1, 168,     'vat_nuoi', 'Chu kỳ tạo một sản phẩm của cá (cá tươi)'),
  ('produce_cycle_cow',          4, 'giờ',        1, 168,     'vat_nuoi', 'Chu kỳ tạo một sản phẩm của bò (sữa)'),
  ('produce_cycle_pig',          6, 'giờ',        1, 168,     'vat_nuoi', 'Chu kỳ tạo một sản phẩm của heo (phân hữu cơ)'),
  ('produce_cycle_sheep',        8, 'giờ',        1, 168,     'vat_nuoi', 'Chu kỳ tạo một sản phẩm của cừu (len)'),
  ('offline_cap_per_entity',     5, 'sản phẩm',   1, 100,     'vat_nuoi', 'Trần sản phẩm tích lũy khi nhân viên vắng mặt, tính riêng cho từng vật nuôi/cây'),
  ('horse_bonus_per_horse',      5, '% giá bán',  0, 100,     'vat_nuoi', 'Thưởng giá bán cho mỗi con ngựa ở trạng thái bình thường'),
  ('horse_bonus_max',           25, '% giá bán',  0, 100,     'vat_nuoi', 'Trần tổng thưởng giá bán do ngựa mang lại')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- [4] CÂY TRỒNG — 3 cây ăn quả + 3 loại hoa
-- =============================================================================
INSERT INTO farm_config (key, value, unit, min_value, max_value, config_group, description) VALUES
  ('seed_price_sunflower',      50, 'Hạt OCB',    1, 1000000, 'cay_trong', 'Giá hạt giống hoa hướng dương'),
  ('seed_price_daisy',          80, 'Hạt OCB',    1, 1000000, 'cay_trong', 'Giá hạt giống hoa cúc'),
  ('seed_price_rose',          120, 'Hạt OCB',    1, 1000000, 'cay_trong', 'Giá hạt giống hoa hồng'),
  ('seed_price_banana',        140, 'Hạt OCB',    1, 1000000, 'cay_trong', 'Giá hạt giống cây chuối'),
  ('seed_price_orange',        170, 'Hạt OCB',    1, 1000000, 'cay_trong', 'Giá hạt giống cây cam'),
  ('seed_price_mango',         200, 'Hạt OCB',    1, 1000000, 'cay_trong', 'Giá hạt giống cây xoài'),
  ('grow_total_sunflower',       8, 'giờ',        1, 240,     'cay_trong', 'Tổng thời gian sinh trưởng của hoa hướng dương (hạt đến sẵn sàng thu hoạch)'),
  ('grow_total_daisy',          12, 'giờ',        1, 240,     'cay_trong', 'Tổng thời gian sinh trưởng của hoa cúc'),
  ('grow_total_rose',           18, 'giờ',        1, 240,     'cay_trong', 'Tổng thời gian sinh trưởng của hoa hồng'),
  ('grow_total_banana',         24, 'giờ',        1, 240,     'cay_trong', 'Tổng thời gian sinh trưởng của cây chuối'),
  ('grow_total_orange',         30, 'giờ',        1, 240,     'cay_trong', 'Tổng thời gian sinh trưởng của cây cam'),
  ('grow_total_mango',          36, 'giờ',        1, 240,     'cay_trong', 'Tổng thời gian sinh trưởng của cây xoài'),
  ('water_interval',             8, 'giờ',        1, 168,     'cay_trong', 'Khoảng thời gian giữa hai lần tưới; thiếu nước thì sinh trưởng bị đóng băng'),
  ('fertilize_reduction',       30, '%',          0, 100,     'cay_trong', 'Phần trăm thời gian còn lại được giảm khi bón phân (một lần mỗi giai đoạn)')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- [5] KHO, KINH TẾ, MỞ RỘNG ĐẤT
-- =============================================================================
INSERT INTO farm_config (key, value, unit, min_value, max_value, config_group, description) VALUES
  ('storage_cap',              500, 'đơn vị',     1, 1000000,  'kho',     'Trần tổng số sản phẩm chứa trong kho'),
  ('resell_ratio',              50, '% giá mua',  0, 100,      'kinh_te', 'Tỷ lệ hoàn tiền khi bán lại vật nuôi, cây trồng hoặc vật trang trí'),
  ('expand_price_plot2',      1000, 'Hạt OCB',    1, 10000000, 'dat',     'Giá mở vùng đất số 2'),
  ('expand_price_plot3',      2500, 'Hạt OCB',    1, 10000000, 'dat',     'Giá mở vùng đất số 3'),
  ('expand_price_plot4',      5000, 'Hạt OCB',    1, 10000000, 'dat',     'Giá mở vùng đất số 4'),
  ('expand_price_plot5',     10000, 'Hạt OCB',    1, 10000000, 'dat',     'Giá mở vùng đất số 5'),
  ('expand_price_plot6',     20000, 'Hạt OCB',    1, 10000000, 'dat',     'Giá mở vùng đất số 6')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- [6] CHECK-IN VÀ GIÚP ĐỠ ĐỒNG NGHIỆP
-- =============================================================================
INSERT INTO farm_config (key, value, unit, min_value, max_value, config_group, description) VALUES
  ('checkin_reward',           100, 'Hạt OCB',    0, 1000000, 'checkin', 'Hạt OCB thưởng cho mỗi lần check-in trong ngày'),
  ('streak_bonus_3',           200, 'Hạt OCB',    0, 1000000, 'checkin', 'Thưởng thêm khi chuỗi check-in đạt mốc 3 ngày'),
  ('streak_bonus_7',           500, 'Hạt OCB',    0, 1000000, 'checkin', 'Thưởng thêm khi chuỗi check-in đạt mốc 7 ngày'),
  ('streak_bonus_14',         1200, 'Hạt OCB',    0, 1000000, 'checkin', 'Thưởng thêm khi chuỗi check-in đạt mốc 14 ngày'),
  ('streak_bonus_30',         3000, 'Hạt OCB',    0, 1000000, 'checkin', 'Thưởng thêm khi chuỗi check-in đạt mốc 30 ngày và mỗi bội số của 30'),
  ('help_quota_per_day',        10, 'lượt',       0, 100,     'giup_do', 'Số nông trại đồng nghiệp được giúp mỗi ngày (theo UTC+7)'),
  ('help_reward_each',          50, 'Hạt OCB',    0, 100000,  'giup_do', 'Hạt OCB thưởng cho mỗi lượt giúp đỡ, cộng cho cả người giúp và chủ nông trại')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- [7] GIỚI HẠN VẬT PHẨM
-- =============================================================================
INSERT INTO farm_config (key, value, unit, min_value, max_value, config_group, description) VALUES
  ('max_animals',               30, 'vật phẩm',   1, 1000, 'gioi_han', 'Số vật nuôi tối đa trên một nông trại'),
  ('max_plants',                40, 'vật phẩm',   1, 1000, 'gioi_han', 'Số cây trồng tối đa trên một nông trại (không tính Cây OCB)'),
  ('max_decors',                60, 'vật phẩm',   1, 1000, 'gioi_han', 'Số vật phẩm trang trí tối đa trên một nông trại'),
  ('badges_shown_max',           3, 'huy hiệu',   1, 20,   'gioi_han', 'Số huy hiệu được chọn hiển thị đồng thời trên nông trại')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- [8] MÔI TRƯỜNG — thời tiết và buổi trong ngày (giờ UTC+7)
-- =============================================================================
INSERT INTO farm_config (key, value, unit, min_value, max_value, config_group, description) VALUES
  ('weather_cycle',             60, 'phút',    1, 1440, 'moi_truong', 'Chu kỳ đổi thời tiết; thời tiết là hàm thuần của thời gian nên mọi nông trại giống nhau'),
  ('day_phase_morning_start',    5, 'giờ VN',  0, 23,   'moi_truong', 'Giờ bắt đầu buổi sáng (05:00 UTC+7)'),
  ('day_phase_noon_start',      11, 'giờ VN',  0, 23,   'moi_truong', 'Giờ bắt đầu buổi trưa (11:00 UTC+7)'),
  ('day_phase_afternoon_start', 14, 'giờ VN',  0, 23,   'moi_truong', 'Giờ bắt đầu buổi chiều (14:00 UTC+7)'),
  ('day_phase_night_start',     18, 'giờ VN',  0, 23,   'moi_truong', 'Giờ bắt đầu buổi đêm (18:00 UTC+7, kéo tới giờ bắt đầu buổi sáng)')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- [9] HIỆU NĂNG VÀ XẾP HẠNG
-- =============================================================================
INSERT INTO farm_config (key, value, unit, min_value, max_value, config_group, description) VALUES
  ('fps_floor',                 25, 'fps',   1, 240,  'hieu_nang', 'Ngưỡng fps dưới mức này thì gợi ý hạ mức chất lượng đồ hoạ'),
  ('fps_low_window',            30, 'giây',  1, 600,  'hieu_nang', 'Thời gian fps liên tục dưới ngưỡng trước khi hiện gợi ý hạ mức'),
  ('leaderboard_refresh',        5, 'phút',  1, 1440, 'xep_hang',  'Chu kỳ làm mới tổng tài sản dùng cho bảng xếp hạng')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- [10] KHÁC — đặt tên nông trại, lời chúc, hạn mức quản trị
-- =============================================================================
INSERT INTO farm_config (key, value, unit, min_value, max_value, config_group, description) VALUES
  ('farm_name_max_len',         40, 'ký tự',   1, 200,       'khac', 'Độ dài tối đa của tên nông trại sau khi trim'),
  ('rename_quota',               3, 'lần',     0, 100,       'khac', 'Số lần đổi tên nông trại cho phép trong một chu kỳ'),
  ('rename_quota_days',          7, 'ngày',    1, 365,       'khac', 'Độ dài chu kỳ tính hạn mức đổi tên nông trại'),
  ('greeting_max_len',         200, 'ký tự',   1, 1000,      'khac', 'Độ dài tối đa của một lời chúc gửi đồng nghiệp'),
  ('admin_adjust_max',      100000, 'Hạt OCB', 1, 100000000, 'khac', 'Mức điều chỉnh Hạt OCB tối đa cho một lần quản trị viên thao tác'),
  ('admin_reason_min_len',      10, 'ký tự',   1, 500,       'khac', 'Độ dài tối thiểu của lý do khi quản trị viên điều chỉnh Hạt OCB')
ON CONFLICT DO NOTHING;
