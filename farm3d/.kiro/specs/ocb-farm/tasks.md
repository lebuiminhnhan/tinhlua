# Implementation Plan — OCB Farm (Nông trại OCB)

## Overview

Triển khai OCB Farm theo đúng thiết kế: **complex-app** với backend Express/PostgreSQL là nguồn chân lý (server-authoritative), một endpoint lệnh duy nhất, các module hàm thuần chứa toàn bộ logic nghiệp vụ, và frontend Angular 20 standalone + `three` cho khung 3D.

Thứ tự triển khai: **schema + đăng ký app → module hàm thuần → API → frontend nền tảng → khung 3D → các panel UI → trang quản trị → hoàn thiện**. Mỗi bước đều được nối vào bước trước, không để lại code lơ lửng.

Quy ước bắt buộc áp dụng xuyên suốt:

- Mọi thay đổi DB là **một file `.sql` riêng, idempotent** trong `backend/src/db/migrations/` (không nhúng DDL vào TS).
- Mọi thay đổi API phải **cập nhật Swagger đồng bộ** (`backend/src/swagger/tags/ocb-farm.yaml` + `components/schemas.yaml` + đăng ký trong `index.ts`).
- App phải được đăng ký ở **cả** `APP_REGISTRY` (FE) và `APPS_CATALOG` (BE), kèm mapping tên trong `admin-analytics`.
- UI ngoài khung 3D dùng class AdminLTE 4 / Bootstrap 5 (`.card`, `.btn`, `.badge`, `.modal`, `.nav-pills`, `.small-box`), icon `bi bi-*`, nội dung tiếng Việt (RB-3, RB-4).
- Component chính dùng `export default`, standalone, `inject()`, signals, control flow `@if`/`@for`.
- SQL luôn dùng tham số `$1`, `$2` (string concat `'$' + idx`, không dùng template literal).

---

## Tasks

- [x] 1. Nền tảng dữ liệu và đăng ký ứng dụng

  - [x] 1.1 Tạo các file migration schema OCB Farm
    - Tạo 9 file `.sql` riêng biệt trong `backend/src/db/migrations/`, tất cả dùng `CREATE TABLE IF NOT EXISTS`: `20261001_001_create_farm_states.sql`, `..._002_create_farm_transactions.sql`, `..._003_create_farm_checkins.sql`, `..._004_create_farm_achievements.sql`, `..._005_create_farm_anniversary_claims.sql`, `..._006_create_farm_helps.sql`, `..._007_create_farm_greetings.sql`, `..._008_create_farm_config.sql`, `..._009_create_farm_admin_audit.sql`
    - `farm_states`: `seeds BIGINT NOT NULL DEFAULT 0 CHECK (seeds >= 0)`, `version INT NOT NULL DEFAULT 0`, `state JSONB`, `settings JSONB`, `last_tick_at`, `last_seen_at`, `join_date`, `join_date_source`, `join_date_admin_locked`, `total_assets_cached`, `checkin_streak`, `last_checkin_date`
    - Ràng buộc idempotency bằng khóa tự nhiên: `UNIQUE(user_id, checkin_date)`, `UNIQUE(user_id, achievement_code)`, `UNIQUE(user_id, anniversary_year)`, `UNIQUE(helper_user_id, owner_user_id, help_date)`
    - Index phục vụ xếp hạng và truy vấn: `farm_states(join_date)`, `farm_states(total_assets_cached DESC)`, `farm_states(checkin_streak DESC)`, `farm_transactions(user_id, occurred_at DESC)`, `farm_helps(owner_user_id, help_date)`
    - _Requirements: US-21, US-22, US-24, US-25, US-27, US-28, US-29, US-40, BR-9, BR-12, BR-13, BR-22, BR-27_

  - [x] 1.2 Tạo file seed cấu hình cân bằng game và bản ghi app
    - `20261001_010_seed_farm_config.sql`: nạp toàn bộ bộ thông số khởi điểm ở mục "Cấu hình cân bằng game" của design (key, value, unit, min, max, group), dùng `ON CONFLICT DO NOTHING`
    - `20261001_011_seed_apps_ocb_farm.sql`: chèn bản ghi app `ocb-farm` với `access_mode = 'restricted'` làm dự phòng cho môi trường không chạy auto-sync
    - _Requirements: US-37, US-45, BR-25, BR-28_

  - [x] 1.3 Định nghĩa kiểu dữ liệu dùng chung
    - Tạo `backend/src/types/ocb-farm.types.ts`: hình dạng JSONB `state` (plots, animals, plants, decors, storage, tree, badges_shown, counters), `settings`, DTO request/response của `/commands`, danh mục mã lệnh, mã lỗi nghiệp vụ
    - Tạo `src/app/modules/complex-app/ocb-farm/models/ocb-farm.model.ts` mirror đúng các kiểu trên cho frontend
    - _Requirements: US-40_

  - [x] 1.4 Đăng ký ứng dụng vào hệ thống IT Hub
    - `src/app/core/registry/app-registry.ts`: entry `ocb-farm` (route `modules/ocb-farm`, category `Khác`, author `OCB Tech Team`, `loadComponent` trỏ tới `ocb-farm-main.component`)
    - `backend/src/config/apps-catalog.ts`: entry tương ứng với `access_mode: 'restricted'`
    - `src/app/app.routes.ts`: thêm `modules/ocb-farm` và `admin/farm` trong children của `LayoutShell`, cả hai `canActivate: [authGuard]`
    - `src/app/core/layout/sidebar/nav-config.ts`: `Nông trại OCB` (`bi bi-tree`) cho mọi user; `Quản lý → Nông trại OCB` với `roles: ['admin']`
    - `src/app/pages/admin/admin-analytics/admin-analytics.component.ts`: thêm `pageNames` (`/modules/ocb-farm`, `/admin/farm`) và `appNames` (`ocb-farm`)
    - _Requirements: BR-25, BR-26_

- [x] 2. Các module hàm thuần ở backend (toàn bộ logic nghiệp vụ kiểm chứng được)

  - [x] 2.1 Viết `farm-calendar.ts`
    - `backend/src/services/ocb-farm/farm-calendar.ts`: `nowVN()`, `startOfDayVN()`, `addMonthsClamped()`, `anniversaryOf()`
    - Mọi mốc ngày tính theo UTC+7; kẹp ngày cuối tháng khi tháng đích không có ngày tương ứng; 29/02 → 28/02 trong năm không nhuận
    - _Requirements: US-5, US-7, US-25, BR-5, BR-13_

  - [ ]* 2.2 Viết unit test cho `farm-calendar`
    - Thiết lập test runner cho backend nếu chưa có; test biên 00:00 UTC+7, ngày vào làm 31, năm nhuận
    - _Requirements: US-5, US-7, BR-5_

  - [x] 2.3 Viết `farm-seniority.ts`
    - `seniority(joinDate, now)` trả năm/tháng tròn, `milestoneIndex()` theo số kỳ 6 tháng đã hoàn thành (có trần cấu hình), `branchCount()` = số năm tròn − 2 (tối thiểu 0, có trần), `daysToNextMilestone()`, `milestoneTimeline()` phục vụ dòng thời gian
    - Mốc mới có hiệu lực từ 00:00:00 UTC+7 của ngày tròn mốc
    - _Requirements: US-5, US-6, US-51, BR-2, BR-3, BR-8_

  - [ ]* 2.4 Viết unit test cho `farm-seniority`
    - Test mốc 0/6 tháng/1 năm/trần, số nhánh ở 2 năm 11 tháng và 3 năm, trường hợp giảm thâm niên
    - _Requirements: US-5, US-6, BR-2, BR-3_

  - [x] 2.5 Viết `farm-environment.ts`
    - `dayPhaseAt(ts)` (4 khoảng giờ phủ kín 24h, không chồng lấn, ranh giới thuộc buổi bắt đầu), `weatherAt(ts, seed)` là hàm thuần của thời gian nên mọi nông trại giống nhau, `rainWindowsBetween(from, to)`, `seasonThemeAt(date)` chọn dịp có ưu tiên cao nhất
    - _Requirements: US-30, US-31, US-33, BR-30_

  - [ ]* 2.6 Viết unit test cho `farm-environment`
    - Test ranh giới buổi, tính xác định của thời tiết theo cùng timestamp, chồng lấn nhiều dịp lễ
    - _Requirements: US-30, US-31, US-33, BR-30_

  - [x] 2.7 Viết `farm-grid.ts` và `farm-economy.ts`
    - `farm-grid.ts`: `canPlace(state, cell, kind)` — ô trung tâm Cây OCB bất khả xâm phạm, cá chỉ vào ao nước, loài khác chỉ trên đất đã mở, ô đã bị chiếm, vùng chưa mở, kiểm tra kề vùng khi mở rộng
    - `farm-economy.ts`: `sellPrice()`, `horseBonus()` (chỉ ngựa trạng thái bình thường, có trần tổng tỷ lệ), `refund()` theo tỷ lệ cấu hình, `applyBalance()` chặn số dư âm trước khi trừ, `totalAssets()` cho xếp hạng
    - _Requirements: US-9, US-10, US-14, US-15, US-22, US-24, US-28, US-34, BR-9, BR-10, BR-18, BR-19_

  - [ ]* 2.8 Viết unit test cho `farm-grid` và `farm-economy`
    - Test chặn đặt lên ô trung tâm, cá ngoài ao, trần thưởng ngựa, từ chối giao dịch làm số dư âm
    - _Requirements: US-9, US-14, BR-9, BR-18_

  - [x] 2.9 Viết `farm-simulation.ts`
    - `tick(state, fromTs, toTs, config)` là hàm thuần: giảm độ no về sàn 0, đóng băng sinh trưởng khi thiếu nước, tự tưới theo các chu kỳ mưa trong khoảng, tích lũy sản phẩm có trần riêng cho từng vật nuôi/cây, dừng tích lũy từ thời điểm độ no về 0
    - Khoảng thời gian âm hoặc bằng 0 (lệch đồng hồ) → tích lũy 0, không trừ tiến trình đã có
    - Trả kèm bảng tổng kết offline (từng loại sản phẩm, số lượng, đối tượng đã đạt trần, độ dài thời gian vắng mặt)
    - _Requirements: US-12, US-17, US-18, US-23, US-31, BR-15, BR-16, BR-17_

  - [ ]* 2.10 Viết unit test cho `farm-simulation`
    - Test trần tích lũy, vật nuôi độ no 0 giữa kỳ, cây thiếu nước có/không có mưa, thời gian vắng mặt âm, tính bất biến của hàm (cùng đầu vào → cùng đầu ra)
    - _Requirements: US-12, US-17, US-23, BR-17_

  - [x] 2.11 Viết `farm-checkin.ts` và `farm-achievement.ts`
    - `farm-checkin.ts`: `nextStreak(lastDate, today)` (+1 nếu đúng hôm qua, về 1 nếu lần đầu hoặc cách ≥ 2 ngày), `milestoneReward(streak)` cho mốc 3/7/14/30 và bội số của 30
    - `farm-achievement.ts`: `evaluate(state, counters, config)` trả danh sách mã thành tựu vừa đạt (6 loài, mốc thu hoạch, mốc chuỗi check-in, mốc giúp đồng nghiệp, mốc thâm niên Cây OCB, mở hết vùng đất)
    - _Requirements: US-25, US-29, BR-12, BR-13, BR-14_

  - [ ]* 2.12 Viết unit test cho `farm-checkin` và `farm-achievement`
    - Test chuỗi liên tiếp/bỏ ngày, thưởng mốc tại bội số 30, thành tựu chỉ trao một lần, nhiều thành tựu đạt cùng lúc
    - _Requirements: US-25, US-29, BR-12, BR-14_

- [x] 3. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Hạ tầng API và trạng thái nông trại

  - [x] 4.1 Viết middleware truy cập và service cấu hình
    - `backend/src/middleware/farm-access.middleware.ts`: kiểm tra quyền app `ocb-farm` (restricted) sau `authMiddleware`; nhóm `/admin/*` thêm `adminMiddleware`
    - `backend/src/services/ocb-farm/farm-config.service.ts`: đọc `farm_config` với cache trong tiến trình, invalidate khi ghi, validate min/max, ghi `farm_admin_audit` khi thay đổi
    - _Requirements: US-45, BR-25, BR-26, BR-27_

  - [x] 4.2 Viết repository trạng thái và endpoint `GET /api/ocb-farm/me`
    - `backend/src/services/ocb-farm/farm-state.repository.ts`: đọc/ghi `farm_states` (có `SELECT ... FOR UPDATE`), ghi `farm_transactions` append-only
    - `GET /me`: tick server-side từ `last_tick_at` → hiện tại, trả `state`, `version`, `balance`, bảng tổng kết offline, trạng thái check-in, buổi trong ngày, thời tiết, dịp lễ, thông báo từ admin (sửa ngày vào làm / reset)
    - `GET /config`: trả cấu hình đang áp dụng để client hiển thị giá và thời gian
    - _Requirements: US-4, US-21, US-23, US-25, US-30, US-31, US-33, US-40, US-42, US-44, US-45_

  - [x] 4.3 Viết endpoint khởi tạo nông trại và tra ngày vào làm
    - `POST /me/init`: idempotent theo `user_id` (một nông trại duy nhất kể cả hai thẻ/hai thiết bị gọi đồng thời), chạy trong transaction — thất bại thì không để lại nông trại dở dang; xác thực ngày vào làm trong khoảng [01/01/`ocb_founded_year`, hôm nay theo UTC+7]; ghi `join_date_source`
    - `GET /me/join-date-suggestion`: tra ngày vào làm từ `users`/LDAP, có timeout theo cấu hình, giá trị ngoài khoảng hợp lệ thì không đề xuất và trả lý do
    - Chặn mọi lệnh nông trại khi chưa xác nhận ngày vào làm
    - _Requirements: US-1, US-2, US-3, BR-7_

  - [x] 4.4 Đăng ký route và Swagger cho nhóm API nền
    - Tạo `backend/src/routes/ocb-farm.routes.ts` với chuỗi middleware `authMiddleware` → `farmAccessMiddleware`; đăng ký `/api/ocb-farm` trong `backend/src/index.ts`
    - Tạo `backend/src/swagger/tags/ocb-farm.yaml` cho `/config`, `/me`, `/me/init`, `/me/join-date-suggestion`; đưa schema dùng chung vào `backend/src/swagger/components/schemas.yaml`; đăng ký tag file trong `backend/src/swagger/index.ts`
    - _Requirements: US-1, US-2, US-3, US-21_

  - [ ]* 4.5 Viết integration test cho nhóm API nền
    - Test 403 khi không có quyền app, khởi tạo đồng thời chỉ tạo một nông trại, ngày vào làm ngoài khoảng bị từ chối, `/me` tick đúng sau khoảng vắng mặt
    - _Requirements: US-1, US-2, US-23, BR-25_

- [x] 5. Endpoint lệnh duy nhất `POST /api/ocb-farm/commands`

  - [x] 5.1 Viết khung `farm-command.service`
    - `backend/src/services/ocb-farm/farm-command.service.ts`: transaction `BEGIN` → `SELECT ... FOR UPDATE` → `tick()` → kiểm tra `version` → áp lệnh → kiểm tra bất biến → `UPDATE ... version + 1` → ghi sổ → `COMMIT`
    - Lệch `version` → 409 kèm state mới nhất; lệnh không hợp lệ → 422 kèm mã lỗi nghiệp vụ; hỗ trợ `idempotency_key` để lặp request không nhân đôi hiệu lực
    - Response 200: `{ state, version, balance, ledger_delta[], achievements_unlocked[], notices[] }`; đánh giá thành tựu và ghi `farm_achievements` trong cùng transaction
    - _Requirements: US-21, US-29, US-40, BR-9, BR-12, BR-27_

  - [x] 5.2 Triển khai nhóm lệnh vật nuôi
    - `commands/animal.commands.ts`: `BUY_ANIMAL`, `FEED_ANIMAL`, `FEED_ALL`, `HARVEST_ANIMAL`, `HARVEST_ALL`, `MOVE_ENTITY`, `SELL_ANIMAL`
    - Kiểm tra giới hạn số vật nuôi, địa hình, số dư; `FEED_ALL` cho ăn theo thứ tự độ no thấp nhất khi không đủ Hạt OCB; ngựa không có sản phẩm thu hoạch; bán vật nuôi mất sản phẩm chưa thu hoạch và hoàn tiền đúng một lần
    - _Requirements: US-10, US-11, US-12, US-13, US-14, US-15, US-37, BR-15, BR-18, BR-28_

  - [x] 5.3 Triển khai nhóm lệnh cây trồng
    - `commands/plant.commands.ts`: `PLANT_SEED`, `WATER_PLANT`, `WATER_ALL`, `FERTILIZE_PLANT`, `HARVEST_PLANT`
    - Một cây mỗi ô; tưới khi đã đủ nước không kéo dài chu kỳ; bón một lần mỗi giai đoạn, phần giảm vượt quá không chuyển tiếp; cây ăn quả về giai đoạn ra quả, hoa hết vòng đời và giải phóng ô; kho đầy thì không thu hoạch và giữ cây ở giai đoạn sẵn sàng
    - _Requirements: US-16, US-17, US-18, US-19, US-20, BR-16, BR-19, BR-20_

  - [x] 5.4 Triển khai nhóm lệnh kho, bán và mở rộng đất
    - `commands/economy.commands.ts`: `SELL_PRODUCT`, `EXPAND_PLOT`
    - Bán: validate số lượng nguyên trong [1, số đang có], chốt giá tại thời điểm xác nhận, tách giá gốc và thưởng ngựa, từ chối khi số lượng đã thay đổi (bán ở thiết bị khác), tạo đúng một bản ghi sổ
    - Mở rộng: chỉ mở vùng kề vùng đã mở, giá theo bảng cấu hình tăng dần, một vùng không bị trừ tiền lần hai, thất bại thì giữ nguyên khoá và số dư
    - _Requirements: US-21, US-22, US-24, US-28, BR-9, BR-10_

  - [x] 5.5 Triển khai nhóm lệnh trang trí, đổi tên và cài đặt
    - `commands/decor.commands.ts` và `commands/settings.commands.ts`: `BUY_DECOR`, `MOVE_DECOR`, `ROTATE_DECOR`, `SELL_DECOR`, `RENAME_FARM`, `UPDATE_SETTINGS`
    - Trang trí: 6 nhóm tối thiểu, giới hạn số lượng, di chuyển/xoay miễn phí, hướng được lưu bền, vật phẩm mùa lễ đã mua vẫn dùng được sau khi dịp kết thúc
    - Đổi tên: trim, độ dài 1..`farm_name_max_len`, kiểm tra danh sách từ ngữ bị cấm, hạn mức số lần đổi trong chu kỳ, từ chối thì giữ tên cũ
    - Cài đặt: lưu `quality`, `quality_manual`, `bgm`, `sfx`, `scene_lock` theo nhân viên (không theo thiết bị)
    - _Requirements: US-30, US-32, US-33, US-34, US-35, US-36, US-37, BR-24, BR-28_

  - [x] 5.6 Triển khai lệnh check-in, hái quả kỷ niệm và chọn huy hiệu
    - `commands/daily.commands.ts`: `CLAIM_CHECKIN`, `PICK_ANNIVERSARY_FRUIT`, `SELECT_BADGES`
    - Check-in: chặn nhận lần hai trong ngày bằng `UNIQUE(user_id, checkin_date)`, cập nhật chuỗi, cộng thưởng mốc đúng một lần; thất bại thì giữ nguyên số dư và chuỗi, cho thử lại trong ngày
    - Hái quả: chỉ khi thâm niên ≥ 3 năm và trong ngày kỷ niệm hoặc còn trong thời gian ân hạn; chặn nhận lần hai bằng `UNIQUE(user_id, anniversary_year)`
    - Chọn huy hiệu: giới hạn số huy hiệu hiển thị đồng thời theo cấu hình
    - _Requirements: US-7, US-25, US-29, BR-6, BR-12, BR-13, BR-14_

  - [x] 5.7 Viết endpoint lịch sử thu chi và thành tựu
    - `GET /me/ledger`: phân trang, sắp xếp `occurred_at DESC`, mỗi dòng gồm thời điểm, nội dung, dấu tăng/giảm, số thay đổi, số dư sau; trạng thái trống có hướng dẫn
    - `GET /me/achievements`: toàn bộ thành tựu kèm trạng thái đã đạt/ngày đạt hoặc điều kiện + tiến trình hiện tại
    - Đăng ký `POST /commands` vào `ocb-farm.routes.ts`
    - _Requirements: US-21, US-29_

  - [x] 5.8 Cập nhật Swagger cho nhóm lệnh
    - Thêm `/commands` (đầy đủ danh mục mã lệnh, payload, response 200/409/422), `/me/ledger`, `/me/achievements` vào `tags/ocb-farm.yaml`; bổ sung schema dùng chung vào `components/schemas.yaml`
    - _Requirements: US-21, US-29, US-40_

  - [ ]* 5.9 Viết integration test cho endpoint lệnh
    - Test 409 khi `version` lệch, lặp `idempotency_key` không nhân đôi, số dư không bao giờ âm, hai phiên đồng thời giữ trạng thái nhất quán
    - _Requirements: US-22, US-40, BR-9_

- [x] 6. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Tương tác xã hội và bảng xếp hạng (backend)

  - [x] 7.1 Viết endpoint danh sách và xem nông trại đồng nghiệp
    - `GET /farms`: tìm theo tên từ 2 ký tự (không phân biệt hoa/thường, khớp một phần), lọc `department_id`, phân trang, loại chính người đang đăng nhập khỏi danh sách
    - `GET /farms/:userId`: trả nông trại chỉ-xem đã lọc dữ liệu riêng tư (chỉ tên, phòng ban, thâm niên, huy hiệu được chọn hiển thị); trả trạng thái riêng khi đồng nghiệp chưa có nông trại
    - _Requirements: US-8, US-26, US-29, BR-21, BR-23_

  - [x] 7.2 Viết endpoint giúp đỡ đồng nghiệp
    - `POST /farms/:userId/help`: kiểm tra quota ngày và `UNIQUE(helper_user_id, owner_user_id, help_date)`; đưa cây về đủ nước hoặc độ no lên tối đa (không vượt trần khi hai người giúp gần như cùng lúc); cộng thưởng cho cả hai bên đúng một lần trong cùng transaction
    - Thất bại thì không trừ lượt, không cộng Hạt OCB, không đổi trạng thái nông trại
    - _Requirements: US-27, BR-21, BR-22_

  - [x] 7.3 Viết endpoint lời chúc và hộp thư
    - `POST /farms/:userId/greeting`: giới hạn độ dài `greeting_max_len`, kiểm tra danh sách từ ngữ bị cấm, hạn mức mỗi nông trại mỗi ngày (ngày kỷ niệm: một lời chúc mỗi người)
    - `GET /me/inbox`: người đã giúp + lời chúc kèm cờ "mới"; `POST /me/inbox/read`: xoá cờ "mới" và không xuất hiện lại
    - Lời chúc vẫn lưu và hiển thị kể cả khi chủ nông trại không truy cập trong ngày kỷ niệm
    - _Requirements: US-8, US-27, US-48_

  - [x] 7.4 Viết endpoint bảng xếp hạng
    - `GET /leaderboard?metric=seniority|assets|streak&department_id=`: top 20 giảm dần, tie-break theo thâm niên dài hơn rồi thứ tự chữ cái tên; luôn kèm vị trí và giá trị của chính người gọi dù ngoài top 20
    - Tính `total_assets_cached` (Hạt OCB + giá bán sản phẩm trong kho + giá mua vật nuôi/cây/vùng đất đã mở), làm mới theo chu kỳ `leaderboard_refresh` và trả thời điểm cập nhật gần nhất
    - Loại nhân viên chưa có nông trại; không trả thêm thông tin cá nhân nào khác
    - _Requirements: US-28, BR-23_

  - [x] 7.5 Cập nhật Swagger cho nhóm xã hội và xếp hạng
    - Thêm `/farms`, `/farms/{userId}`, `/farms/{userId}/help`, `/farms/{userId}/greeting`, `/me/inbox`, `/me/inbox/read`, `/leaderboard` vào `tags/ocb-farm.yaml`
    - _Requirements: US-26, US-27, US-28_

  - [ ]* 7.6 Viết integration test cho nhóm xã hội và xếp hạng
    - Test hết quota giúp, hai người giúp đồng thời, chặn hành động ghi ở chế độ ghé thăm, tie-break xếp hạng
    - _Requirements: US-26, US-27, US-28, BR-21, BR-22_

- [x] 8. API quản trị

  - [x] 8.1 Viết endpoint tìm nhân viên và sửa ngày vào làm
    - `GET /admin/users`: tìm theo tên hoặc phòng ban, trạng thái không có kết quả rõ ràng
    - `PATCH /admin/users/:id/join-date`: áp dụng cùng quy tắc hợp lệ như phía nhân viên, trả thâm niên và mốc Cây OCB tính lại ngay, đặt `join_date_admin_locked = true`, ghi `farm_admin_audit` (người sửa, thời điểm UTC+7, giá trị trước/sau), tạo thông báo cho nhân viên
    - Giữ nguyên thành tựu, huy hiệu và vật phẩm khi thâm niên giảm
    - _Requirements: US-42, BR-7, BR-8, BR-26, BR-27_

  - [x] 8.2 Viết endpoint điều chỉnh Hạt OCB và đặt lại nông trại
    - `POST /admin/users/:id/seeds`: bắt buộc `reason` ≥ `admin_reason_min_len`, mức điều chỉnh là số nguyên khác 0 và ≤ `admin_adjust_max`, từ chối nếu số dư sau < 0; `Idempotency-Key` bảo đảm xác nhận nhiều lần chỉ ghi một bản ghi sổ có nhãn do quản trị viên điều chỉnh
    - `POST /admin/users/:id/reset`: đưa nông trại về trạng thái khởi tạo, giữ nguyên ngày vào làm, thâm niên, mốc Cây OCB, thành tựu và huy hiệu; trả trước danh sách phần giữ lại / phần bị mất để UI xác nhận hai bước; ghi lưu vết kèm trạng thái trước khi đặt lại và tạo thông báo cho nhân viên
    - _Requirements: US-43, US-44, BR-9, BR-26, BR-27_

  - [x] 8.3 Viết endpoint cấu hình, thống kê và lưu vết
    - `GET/PUT /admin/config`: validate theo min/max của từng thông số, giá trị mới chỉ áp dụng cho lượt chơi sau thời điểm lưu (không tính lại phần thưởng/tiến trình đã phát sinh), ghi lưu vết từng thông số
    - `GET /admin/stats`: tổng số nông trại, nhân viên hoạt động 7/30 ngày, lượt check-in theo ngày, loài vật nuôi và loại cây phổ biến nhất, phân bố thâm niên; lọc theo phòng ban; nêu rõ mốc UTC+7 và thời điểm cập nhật; trạng thái trống khi không có dữ liệu
    - `GET /admin/audit`: chỉ đọc, phân trang
    - _Requirements: US-37, US-45, US-46, BR-26, BR-27_

  - [x] 8.4 Cập nhật Swagger cho nhóm quản trị
    - Thêm toàn bộ path `/admin/*` vào `tags/ocb-farm.yaml`, ghi rõ yêu cầu quyền admin và header `Idempotency-Key`
    - _Requirements: US-42, US-43, US-44, US-45, US-46_

  - [ ]* 8.5 Viết integration test cho nhóm quản trị
    - Test 403 với người không phải admin, lý do quá ngắn bị từ chối, điều chỉnh làm số dư âm bị từ chối, lặp `Idempotency-Key` chỉ ghi một bản ghi, reset giữ nguyên thành tựu
    - _Requirements: US-42, US-43, US-44, BR-26, BR-27_

- [x] 9. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Nền tảng frontend và tài nguyên 3D

  - [x] 10.1 Viết `FarmApiService` và `FarmStateStore`
    - `services/farm-api.service.ts`: gọi `/api/ocb-farm` bằng `HttpClient`, hàng chờ lệnh, sinh `idempotency_key`, thử lại khi lỗi mạng
    - `services/farm-state.store.ts`: signals cho `state`, `version`, `balance`, `pending`, `error`, `visitMode`; cập nhật lạc quan và hoàn tác khi nhận 409/422; hiển thị trạng thái mất kết nối và nêu rõ thao tác nào bị huỷ
    - _Requirements: US-21, US-40_

  - [x] 10.2 Viết component chính và overlay tải
    - `ocb-farm-main.component.ts/.html/.scss` dùng `export default`, standalone, signals; layout AdminLTE (`.container-fluid`, `.card`) bao quanh khung 3D
    - `components/loading-overlay/`: tiến trình % chỉ tăng hoặc giữ nguyên, nhãn hạng mục đang tải, timeout theo cấu hình kèm nút thử lại, danh sách hạng mục tải lỗi không chặn sử dụng
    - Gọi `analytics.trackAppUsage('ocb-farm', 'farm_action')` ở hành động chính (check-in / thu hoạch)
    - _Skills: kích hoạt trước khi làm — `threejs-loaders`_
    - _Requirements: US-1, US-39_

  - [x] 10.3 Viết `farm-hud`
    - `components/farm-hud/`: số Hạt OCB luôn hiển thị ở mọi góc nhìn và mọi mức chất lượng, cập nhật trong ≤ 2 giây sau giao dịch; thời tiết, buổi trong ngày, dịp lễ; huy hiệu đang chọn; đếm số vật phẩm hiện tại / giới hạn cho từng nhóm
    - _Requirements: US-21, US-30, US-31, US-33, US-37_

  - [ ]* 10.4 Viết unit test cho `FarmStateStore`
    - Test hoàn tác cập nhật lạc quan khi 409, hàng chờ lệnh khi offline, số Hạt OCB hiển thị không âm
    - _Requirements: US-21, US-40_

  - [x] 10.5 Tạo file manifest tài nguyên 3D
    - `public/assets/ocb-farm/asset-manifest.json` + kiểu `FarmAssetManifest` trong `models/ocb-farm.model.ts`: ánh xạ mã loài vật nuôi / mã loại cây theo từng giai đoạn sinh trưởng / mã nhóm vật trang trí → đường dẫn GLB cho cả 3 mức chất lượng (thấp / vừa / cao)
    - Là nguồn chân lý duy nhất về danh sách tài nguyên: mã chưa khai báo trong manifest thì không được render; `AssetLoaderService` (11.2) và bước kiểm ngân sách (10.9) đọc cùng một file nên không lệch danh sách
    - Khai báo cả các hạng mục tự dựng (Cây OCB, lưới ô đất, mặt nước ao) bằng nhãn riêng thay cho đường dẫn GLB, và màu khối hộp fallback theo từng loại vật thể
    - _Skills: kích hoạt trước khi làm — `threejs-loaders`_
    - _Requirements: US-36, US-39_

  - [x] 10.6 Thu thập model 3D từ nguồn ngoài
    - Tải GLB từ threejsassets.com (Free Commercial License) cho 6 loài vật nuôi (gà, cá, cừu, heo, bò, ngựa), các loại cây theo từng giai đoạn sinh trưởng (hạt, mầm, cây lớn, ra hoa/quả, sẵn sàng thu hoạch) và 6 nhóm vật trang trí
    - Loại nào nguồn chính không có thì dùng nguồn CC0 dự phòng (3dassets.dev, Numinia, Poly Haven)
    - Áp nguyên tắc nhận asset đã ghi trong design: chỉ nhận giấy phép cho phép dùng thương mại, ưu tiên loại không cần ghi công, loại bỏ asset "chỉ phi thương mại" / "chỉ dùng cá nhân" / buộc chia sẻ lại mã nguồn; file thật phải tải qua tài khoản, không nhúng trực tiếp từ trang nguồn
    - Điền mã tương ứng của từng asset đã nhận vào manifest (10.5)
    - _Skills: kích hoạt trước khi làm — `threejs-loaders`_
    - _Requirements: US-9, US-34, US-39, BR-18_

  - [x] 10.7 Tạo file kê khai giấy phép tài nguyên
    - `public/assets/ocb-farm/ASSET-LICENSES.md` trong repo: mỗi dòng gồm tên asset, nguồn tải, tên giấy phép, ngày tải, có yêu cầu ghi công hay không, và mã loài/loại tương ứng trong manifest
    - Asset tự dựng (Cây OCB, lưới ô đất, mặt nước, khối hộp fallback) ghi rõ là sản phẩm nội bộ của OCB Tech Team
    - Asset có giấy phép bắt buộc ghi công thì phần ghi công phải đặt được ở trang trợ giúp của app; không đặt được thì loại asset đó và cập nhật lại manifest
    - Phục vụ rà soát tuân thủ: trả lời được ngay nguồn gốc và giấy phép của từng model mà không phải tra lại trang nguồn
    - _Requirements: US-39_

  - [x] 10.8 Xử lý và tối ưu tài nguyên 3D
    - Gộp mesh và giảm số tam giác **trước** khi nén để mức LOD thấp thật sự nhẹ chứ không chỉ nén chặt hơn; xuất 3 mức LOD tương ứng đúng 3 mức chất lượng cao / vừa / thấp
    - Nén Draco cho geometry; chỉ chuyển texture sang KTX2 khi tổng dung lượng vẫn vượt ngân sách
    - Đặt file kết quả vào `public/assets/ocb-farm/models/` theo đúng đường dẫn đã khai báo trong manifest
    - _Skills: kích hoạt trước khi làm — `threejs-loaders`, `threejs-geometry`, `threejs-textures`_
    - _Requirements: US-36, US-39, BR-1_

  - [x] 10.9 Viết bước kiểm ngân sách dung lượng tài nguyên
    - Script node đọc manifest, cộng tổng dung lượng gzip của đúng tập file tải lần đầu và so với hạn mức 8 MB theo XN-1; chạy được độc lập và gắn được vào `prebuild`
    - Vượt hạn mức → thoát với mã lỗi khác 0 và in danh sách hạng mục sắp theo dung lượng giảm dần, nêu rõ hạng mục nào làm vượt để quay lại bước giảm tam giác (10.8)
    - Tài nguyên không đạt ngân sách thì không được đưa vào thư mục tĩnh
    - _Skills: kích hoạt trước khi làm — `threejs-loaders`_
    - _Requirements: US-39, BR-1_

  - [x] 10.10 Dựng hình học tự sinh của nông trại
    - Cây OCB theo tham số: lắp ghép một thân + một mẫu nhánh + một mẫu tán lá, nhân bản và đặt góc theo số nhánh mà module thâm niên trả về (`branchCount()`), nên mỗi mốc thâm niên cho một hình dạng cây khác nhau
    - Lưới ô đất sinh theo kích thước ô và danh sách vùng đã mở; mặt nước ao sinh theo đúng các ô địa hình `water` với vật liệu trong suốt
    - Khối hộp fallback: hình học cơ bản, màu lấy theo loại vật thể đã khai trong manifest, dùng khi model thật tải lỗi
    - Xuất dưới dạng module tạo hình học để `FarmSceneService` (11.1) và `AssetLoaderService` (11.2) dùng lại, không dựng trực tiếp trong service
    - _Skills: kích hoạt trước khi làm — `threejs-geometry`, `threejs-materials`, `threejs-fundamentals`_
    - _Requirements: US-5, US-6, US-9, US-39, BR-18_

- [x] 11. Khung render 3D

  - [x] 11.1 Viết `FarmSceneService`
    - `OrthographicCamera` góc isometric cố định; kéo di chuyển, cuộn/chụm phóng to nhỏ, 4 nút xoay 90°; lưới ô vuông theo vùng đất và ao nước; `InstancedMesh` theo loài/loại để giới hạn draw call; Cây OCB cố định ở ô trung tâm, không có tương tác di chuyển/bán/xoá
    - _Skills: kích hoạt trước khi làm — `threejs-fundamentals`, `threejs-geometry`, `threejs-interaction`_
    - _Requirements: US-9, US-36, US-38, BR-1_

  - [x] 11.2 Viết `AssetLoaderService`
    - Đọc manifest tài nguyên (10.5) để biết cần nạp file nào ở mức chất lượng hiện tại — không hardcode đường dẫn GLB trong service; mã không có trong manifest thì không nạp và không render
    - Nạp GLTF (nén Draco) theo mức chất lượng, phát tiến trình tải theo hạng mục; mô hình lỗi → đặt khối hộp màu theo loại (10.10) vào đúng ô và ghi vào danh sách hạng mục lỗi; thử lại chỉ tải lại hạng mục đã lỗi
    - _Skills: kích hoạt trước khi làm — `threejs-loaders`, `threejs-materials`_
    - _Requirements: US-36, US-39_

  - [x] 11.3 Viết `QualityService` và `SoundService`
    - `QualityService`: tự dò khả năng thiết bị chọn Thấp/Vừa/Cao (không xác định được → Thấp kèm lý do), lựa chọn thủ công ghi đè và lưu theo nhân viên, áp dụng ngay không mất trạng thái và không reset bộ đếm, theo dõi fps để gợi ý hạ mức kèm lựa chọn bỏ qua
    - `SoundService`: nhạc nền và hiệu ứng tắt theo mặc định, bật/tắt độc lập, lưu theo nhân viên; lỗi tải âm thanh không chặn hành động
    - _Skills: kích hoạt trước khi làm — `threejs-fundamentals`, `threejs-lighting`, `threejs-textures`_
    - _Requirements: US-32, US-36, US-38, BR-29_

  - [x] 11.4 Triển khai ngày/đêm, thời tiết, chủ đề mùa lễ và chụp ảnh
    - Đổi `DirectionalLight`, màu trời, cường độ bóng theo buổi; buổi đêm bật `PointLight` của vật phẩm trang trí là nguồn sáng và tắt khi sang buổi khác; hiệu ứng nắng / nhiều mây / mưa; áp chủ đề mùa lễ; khoá cảnh giữ nguyên hiển thị mà không ảnh hưởng thời tiết, sinh trưởng, độ no hay phần thưởng
    - `components/snapshot-button/`: render một khung vào canvas ngoài luồng, chèn tên nông trại + tên nhân viên + thâm niên, xuất PNG với tên tệp chứa tên nông trại và ngày chụp; chế độ ghé thăm ghi rõ nông trại của đồng nghiệp
    - _Skills: kích hoạt trước khi làm — `threejs-lighting`, `threejs-materials`, `threejs-shaders`, `threejs-postprocessing`, `threejs-fundamentals`_
    - _Requirements: US-30, US-31, US-33, US-41_

  - [x] 11.5 Viết component `farm-canvas`
    - Host khung 3D, cử chỉ chuột và cảm ứng, `touch-action: none` để không cuộn trang, vùng chạm ≥ 44×44 px cho điều khiển cốt lõi, nối vào `FarmSceneService` và `FarmStateStore`
    - _Skills: kích hoạt trước khi làm — `threejs-interaction`, `threejs-fundamentals`_
    - _Requirements: US-36, US-38_

  - [ ]* 11.6 Viết unit test cho `QualityService` và `AssetLoaderService`
    - Test tiến trình % không giảm, fallback khối hộp khi lỗi tải, ghi đè thủ công mức chất lượng, ngưỡng gợi ý hạ mức
    - _Skills: kích hoạt trước khi làm — `threejs-loaders`_
    - _Requirements: US-36, US-39_

- [x] 12. Khởi tạo và Cây OCB (frontend)

  - [x] 12.1 Viết `onboarding-wizard`
    - 5 bước hướng dẫn, bỏ qua được ở bất kỳ bước và mở lại từ mục trợ giúp; nhập/xác nhận ngày vào làm với nhãn nguồn (dữ liệu nhân sự / tự khai), hiển thị thâm niên để đối chiếu rồi xác nhận lại; giữ giá trị vừa nhập khi bị từ chối; chặn mọi hoạt động nông trại đến khi xác nhận xong
    - _Requirements: US-1, US-2, US-3_

  - [x] 12.2 Viết `ocb-tree-panel`
    - Ngày vào làm chỉ đọc kèm ghi chú chỉ admin sửa được và hướng dẫn từng bước cách yêu cầu; thâm niên theo năm/tháng và số ngày tới mốc kế tiếp (hoặc nhãn đã đạt mốc cao nhất); bấm vào nhánh xem năm tượng trưng; banner chúc mừng suốt ngày kỷ niệm kèm nút hái quả; dòng thời gian các mốc đã đi qua và mốc kế tiếp
    - _Skills: kích hoạt trước khi làm — `threejs-interaction`_
    - _Requirements: US-4, US-5, US-6, US-7, US-51_

- [x] 13. Các panel kinh tế và tương tác nông trại (frontend)

  - [x] 13.1 Viết `shop-panel`
    - 3 tab `.nav-pills`: vật nuôi / hạt giống / trang trí; hiển thị giá, tổng thời gian sinh trưởng, vật phẩm giới hạn theo dịp có nhãn riêng, vật phẩm khoá theo thâm niên kèm mốc cần đạt; chặn mua khi thiếu Hạt OCB (nêu số còn thiếu) hoặc đạt giới hạn nhóm
    - _Requirements: US-10, US-16, US-33, US-34, US-37, US-49_

  - [x] 13.2 Viết `inventory-panel`
    - Danh sách từng loại sản phẩm kèm số lượng, giá một đơn vị, tổng giá trị ước tính; chọn số lượng bán trong [1, số đang có] và bán toàn bộ; tách riêng giá gốc / thưởng ngựa / tổng nhận trước khi xác nhận; trạng thái trống có hướng dẫn thu hoạch; làm mới và thông báo khi số lượng đã thay đổi ở thiết bị khác
    - _Requirements: US-13, US-14, US-20, US-22_

  - [x] 13.3 Viết `ledger-panel`
    - Tối thiểu 50 giao dịch gần nhất, phân trang, mỗi dòng gồm ngày giờ phút, nội dung, dấu tăng/giảm, số thay đổi, số dư sau; trạng thái trống có hướng dẫn; lỗi tải có nút thử lại mà vẫn hiển thị số Hạt OCB hiện tại
    - _Requirements: US-21_

  - [x] 13.4 Viết `expand-panel`
    - Mỗi vùng chưa mở hiển thị trạng thái khoá và giá của chính vùng đó kể cả khi chưa đủ Hạt OCB; chặn mở vùng không kề kèm nêu vùng cần mở trước; trạng thái đã mở hết; lỗi lưu thì giữ khoá và không trừ Hạt OCB
    - _Requirements: US-24_

  - [x] 13.5 Viết `checkin-dialog` và `offline-summary-dialog`
    - Hộp thưởng check-in: số Hạt OCB sẽ nhận, chuỗi hiện tại, nút nhận; sau khi nhận hiển thị trạng thái đã check-in kèm mốc làm mới 00:00 UTC+7; lỗi thì cho thử lại trong ngày
    - Bảng tổng kết offline: độ dài thời gian vắng mặt, từng loại sản phẩm đang chờ, đối tượng đã đạt trần, nút thu hoạch toàn bộ một thao tác; không hiển thị khi không có gì tích lũy
    - _Requirements: US-23, US-25_

  - [x] 13.6 Nối tương tác vật nuôi và cây trồng vào khung 3D
    - Menu tương tác trên đối tượng: cho ăn, tưới, bón phân, thu hoạch, di chuyển, bán, cùng các thao tác cho ăn tất cả / tưới tất cả / thu hoạch tất cả kèm hộp xác nhận nêu số lượng và tổng chi phí
    - Hiển thị đếm ngược giai đoạn, dấu hiệu sẵn sàng thu hoạch, dấu hiệu thiếu nước và tạm dừng, trạng thái buồn; vô hiệu hoá thao tác khi không có đối tượng phù hợp kèm thông báo lý do
    - _Skills: kích hoạt trước khi làm — `threejs-interaction`, `threejs-animation`_
    - _Requirements: US-11, US-12, US-13, US-15, US-17, US-18, US-19, US-20, US-34_

- [x] 14. Xã hội, xếp hạng, thành tựu và cài đặt (frontend)

  - [x] 14.1 Viết `visit-browser` và `visit-toolbar`
    - Danh sách nông trại với tìm theo tên từ 2 ký tự và lọc phòng ban kết hợp được; trạng thái trống có gợi ý đổi từ khoá; thông báo khi đồng nghiệp chưa có nông trại
    - Chế độ ghé thăm: nhãn hiển thị liên tục, lối thoát quay về nông trại của mình, vô hiệu hoá mọi hành động mua/bán/di chuyển/xoá, chỉ còn hành động giúp và gửi lời chúc, hiệu ứng lễ hội khi chủ nông trại đang trong ngày kỷ niệm
    - _Skills: kích hoạt trước khi làm — `threejs-animation`, `threejs-shaders`_
    - _Requirements: US-8, US-26, US-27, BR-21_

  - [x] 14.2 Viết `inbox-panel`
    - Danh sách người đã giúp (tên, loại hành động, thời điểm) và lời chúc (tên người gửi, thời điểm), đánh dấu "mới" cho tới khi mở danh sách rồi gọi `inbox/read`; hỗ trợ xoá từng lời chúc hoặc xoá toàn bộ
    - _Requirements: US-8, US-27, US-48_

  - [x] 14.3 Viết `leaderboard-panel`
    - 3 tiêu chí với mặc định là thâm niên Cây OCB, lọc phòng ban, top 20 không có dòng giữ chỗ, dòng của chính nhân viên luôn hiển thị và đánh dấu khác biệt, thời điểm cập nhật gần nhất, lỗi tải hiển thị thông báo và không hiển thị danh sách một phần
    - _Requirements: US-28, BR-23_

  - [x] 14.4 Viết `achievement-panel`
    - Danh sách thành tựu: đã đạt hiển thị ngày đạt, chưa đạt hiển thị điều kiện và tiến trình so với mốc; thông báo lần lượt khi nhiều thành tựu đạt cùng lúc; chọn huy hiệu hiển thị khi vượt giới hạn số huy hiệu đồng thời
    - _Requirements: US-29, BR-12_

  - [x] 14.5 Viết `settings-panel`
    - Bật/tắt nhạc nền và hiệu ứng âm thanh độc lập (mặc định tắt), khoá cảnh theo 1 trong 4 buổi, chọn mức chất lượng đồ hoạ; mọi lựa chọn lưu theo nhân viên và giữ nguyên khi đổi thiết bị
    - _Requirements: US-30, US-32, US-36, BR-29_

- [x] 15. Trang quản trị OCB Farm (frontend)

  - [x] 15.1 Viết trang quản trị — nhân viên và số dư
    - `src/app/pages/admin/admin-farm/`: tìm nhân viên theo tên/phòng ban với trạng thái không có kết quả; sửa ngày vào làm và hiển thị thâm niên + mốc Cây OCB tính lại ngay không cần tải lại trang; điều chỉnh Hạt OCB có ô lý do bắt buộc và kiểm tra hạn mức; đặt lại nông trại với hai bước xác nhận liệt kê rõ phần giữ lại / phần bị mất
    - _Requirements: US-42, US-43, US-44, BR-26_

  - [x] 15.2 Viết trang quản trị — cấu hình, thống kê và lưu vết
    - Bảng thông số hiển thị đơn vị đo và khoảng min/max, từ chối giá trị ngoài khoảng kèm thông báo; thống kê sử dụng với bộ lọc phòng ban, ghi rõ mốc UTC+7, thời điểm cập nhật và trạng thái trống; bảng lưu vết chỉ đọc có phân trang
    - _Requirements: US-45, US-46, BR-27_

- [x] 16. Hoàn thiện và kiểm tra tích hợp

  - [x] 16.1 Hoàn thiện trải nghiệm di động và khả năng truy cập
    - Bố cục điều khiển cảm ứng: check-in, cho ăn, tưới, thu hoạch, bán đều truy cập được không cần cuộn ngang; vùng chạm ≥ 44×44 px và không bị che; cử chỉ chỉ tác động lên khung nông trại; vẫn đổi được mức chất lượng thủ công trên điện thoại
    - Thêm nhãn ARIA, thứ tự focus và tương phản đạt chuẩn cho toàn bộ UI ngoài khung 3D
    - _Skills: kích hoạt trước khi làm — `threejs-interaction`_
    - _Requirements: US-36, US-38, RB-3_

  - [x] 16.2 Rà soát đăng ký, đồng bộ Swagger và build
    - Kiểm tra lại `APP_REGISTRY`, `APPS_CATALOG`, `app.routes.ts`, `nav-config.ts`, mapping `admin-analytics`; verify `/api-docs` render đúng toàn bộ endpoint `ocb-farm`; chạy `npm run build:all` và `npm run migrate --prefix backend`
    - _Requirements: BR-25, BR-26_

  - [ ]* 16.3 Viết test tích hợp luồng chính
    - Luồng khởi tạo → xác nhận ngày vào làm → check-in → mua vật nuôi → cho ăn → thu hoạch → bán → mở rộng đất; luồng ghé thăm → giúp → nhận thưởng hai bên; luồng admin sửa ngày vào làm → nhân viên thấy thông báo
    - _Requirements: US-1, US-2, US-25, US-27, US-42_

- [x] 17. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Các task có hậu tố `*` là tuỳ chọn, có thể bỏ qua để ra MVP nhanh hơn.
- Thiết kế chưa có mục "Correctness Properties" nên kế hoạch này dùng unit test và integration test, không có property-based test.
- Toàn bộ logic nghiệp vụ có thể kiểm chứng được tập trung ở các module hàm thuần (task 2) để test không cần DB.
- Nhóm tài nguyên 3D (10.5–10.10) phải xong trước task 11: khung 3D chỉ render được vật thể thật khi manifest đã khai báo đầy đủ và file GLB đã nằm trong thư mục tĩnh — thiếu nhóm này thì `AssetLoaderService` chỉ hiển thị được khối hộp fallback.
- Trước khi bắt đầu task 1, cần chốt các điểm còn treo trong design: sai lệch GD-4 (bảng riêng thay cho `generic_storage`) và XN-1 đến XN-7 (trong đó XN-7 là tài khoản đứng tên tải tài nguyên 3D và nơi lưu file GLB — chốt trước khi bắt đầu 10.6).
- Mỗi task backend có thay đổi API đều kèm bước cập nhật Swagger trong cùng phạm vi hoặc ở task Swagger liền sau.
- Task có dòng `_Skills: ..._` thì agent thực thi PHẢI kích hoạt đúng các skill đó (qua công cụ kích hoạt skill) trước khi viết code; nếu cần tổng quan thì kích hoạt thêm `threejs-skills`. Các skill chỉ là hướng dẫn, vẫn phải tuân thủ quy ước dự án (Angular standalone, signals, AdminLTE ngoài khung 3D).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["1.4", "2.1", "2.3", "2.5", "2.7"] },
    { "id": 2, "tasks": ["2.2", "2.4", "2.6", "2.8", "2.9", "2.11"] },
    { "id": 3, "tasks": ["2.10", "2.12", "4.1"] },
    { "id": 4, "tasks": ["4.2"] },
    { "id": 5, "tasks": ["4.3", "4.4"] },
    { "id": 6, "tasks": ["4.5", "5.1"] },
    { "id": 7, "tasks": ["5.2", "5.3", "5.4", "5.5", "5.6"] },
    { "id": 8, "tasks": ["5.7", "5.8", "5.9"] },
    { "id": 9, "tasks": ["7.1"] },
    { "id": 10, "tasks": ["7.2"] },
    { "id": 11, "tasks": ["7.3"] },
    { "id": 12, "tasks": ["7.4"] },
    { "id": 13, "tasks": ["7.5", "7.6", "8.1"] },
    { "id": 14, "tasks": ["8.2"] },
    { "id": 15, "tasks": ["8.3"] },
    { "id": 16, "tasks": ["8.4", "8.5", "10.1", "10.5"] },
    { "id": 17, "tasks": ["10.2", "10.3", "10.4", "10.6"] },
    { "id": 18, "tasks": ["10.7", "10.8"] },
    { "id": 19, "tasks": ["10.9", "10.10"] },
    { "id": 20, "tasks": ["11.1", "11.2", "11.3"] },
    { "id": 21, "tasks": ["11.4", "11.5", "11.6", "12.1"] },
    { "id": 22, "tasks": ["12.2", "13.1", "13.3", "13.5"] },
    { "id": 23, "tasks": ["13.2", "13.4", "13.6"] },
    { "id": 24, "tasks": ["14.1", "14.3", "14.5"] },
    { "id": 25, "tasks": ["14.2", "14.4"] },
    { "id": 26, "tasks": ["15.1"] },
    { "id": 27, "tasks": ["15.2"] },
    { "id": 28, "tasks": ["16.1", "16.2"] },
    { "id": 29, "tasks": ["16.3"] }
  ]
}
```
