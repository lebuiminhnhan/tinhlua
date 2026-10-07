# Implementation Plan — OCB Farm: Nâng cấp Cinema & Mở rộng Nông trại

## Overview

Đây là bản **nâng cấp** cho complex-app `ocb-farm` đã hoàn thiện (`src/app/modules/complex-app/ocb-farm/`, backend `backend/src/services/ocb-farm/`). Không tạo app mới, không đổi cơ chế occupancy server-side cho 6 loài hiện có, không thêm business logic kinh tế.

Thứ tự triển khai theo đúng phụ thuộc đã nêu trong design: **module hàm thuần backend (grid migration) → tích hợp repository backend → module hàm thuần frontend (scene-math/constants) → module hàm thuần frontend (cinema-camera/free-roam-pet/anchored-roam, có PBT) → tích hợp FarmSceneService/FarmAnimalLayer → FullscreenService → UI component (farm-canvas, ocb-farm-main) → asset manifest + model mới (poly.pizza) + license checklist → Swagger update → checkpoint cuối**.

Xác nhận trước khi bắt đầu:

- **Không tạo migration SQL mới** cho `grid_version` — field này nằm trong cột JSONB tự do `farm_states.state`, không có constraint schema SQL cần `ALTER TABLE`. Quy tắc "Database File Convention" (file `.sql` riêng, idempotent) chỉ áp dụng cho thay đổi *schema bảng*, không áp dụng cho field JSONB mới. Chỉ cần sửa code backend (`farm-grid-migration.ts`, `farm-state.repository.ts`, `farm-plot-layout.ts`, `ocb-farm.types.ts`).
- **Swagger phải cập nhật đồng bộ** khi `GET /me` response schema đổi (thêm `state.grid_version`) — theo quy tắc Swagger Sync bắt buộc của project.
- SQL (nếu có nơi nào cần truy vấn, dù thiết kế này không thêm truy vấn mới) luôn dùng `$1`, `$2` dạng string concat, không template literal.
- Component chính/sub-component mới dùng `export default`, standalone, `inject()`, signals, control flow `@if`/`@for` (không `*ngIf`).
- UI ngoài khung 3D (toolbar, panel, dialog, thông báo) dùng AdminLTE 4 / Bootstrap 5 (`.card`, `.btn`, `.alert`, `.badge`), icon `bi bi-*`, nội dung tiếng Việt.
- Model 3D mới từ poly.pizza phải tải qua tài khoản thật, không nhúng trực tiếp từ trang nguồn; `ASSET-LICENSES.md` phải được cập nhật trước khi coi model đó là "đã nhận" vào dự án.
- Task có dòng `_Skills: ..._` thì PHẢI kích hoạt đúng skill đó trước khi viết code.

---

## Tasks

- [x] 1. Grid_Migration — module hàm thuần backend

  - [x] 1.1 Mở rộng kiểu dữ liệu `FarmStateJson` và bố cục lưới mới
    - `backend/src/types/ocb-farm.types.ts`: thêm `grid_version?: number` vào `FarmStateJson` (field JSONB tự do, không cần migration SQL — xác nhận lại: KHÔNG tạo file `.sql` nào cho field này)
    - `backend/src/services/ocb-farm/farm-plot-layout.ts`: thêm `EXPANSION_PLOTS_V2` (bố cục lưới 20×25, giữ vùng 1 là khối 5×5 `"0,0".."4,4"` chứa `centerCell = "2,2"` không đổi vị trí tương đối), **giữ nguyên** `EXPANSION_PLOTS` (lưới 13×15 cũ) để `ensurePlotLayout` hiện có không bị phá vỡ
    - _Requirements: 7.1, 7.2, 7.4, 8.2_

  - [ ]* 1.2 Viết unit test cho bố cục `EXPANSION_PLOTS_V2`
    - Duyệt toàn bộ phạm vi lưới cố định đã chọn (hàng/cột đủ để phủ 500 ô), xác nhận mỗi ô thuộc đúng 1 plot, không ô nào thiếu/trùng; xác nhận vùng 1 vẫn ở khối `"0,0".."4,4"` với `centerCell = "2,2"` (kiểm cấu hình tĩnh, không PBT)
    - _Requirements: 7.2, 7.4_

  - [x] 1.3 Viết `farm-grid-migration.ts`
    - File mới `backend/src/services/ocb-farm/farm-grid-migration.ts`: `CURRENT_GRID_VERSION = 2`, hàm thuần `migrateGridTo20x25(state: FarmStateJson): FarmStateJson`
    - Nếu `(state.grid_version ?? 1) >= CURRENT_GRID_VERSION` → trả nguyên `state` (idempotent)
    - Giữ nguyên mọi `plot` đã có (id, unlocked, cells, terrain); chỉ thêm `plot` từ `EXPANSION_PLOTS_V2` có `id` chưa tồn tại và `cells` chưa bị chiếm (cùng logic lọc `used` set như `ensurePlotLayout`)
    - Không đổi `animals`, `plants`, `decors`, `storage`, `tree`, `badges_shown`, `counters`
    - Trường hợp lỗi: `state.plots` không phải array hoặc thiếu plot id 1 → trả nguyên `state`, không throw
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [ ]* 1.4 Viết property test cho `migrateGridTo20x25`
    - **Property 12: Grid_Migration giữ nguyên toạ độ ô của mọi vật thể hiện có** — **Validates: Requirements 8.2**
    - **Property 13: Grid_Migration giữ nguyên trạng thái `unlocked` của mọi plot đã có** — **Validates: Requirements 8.3**
    - **Property 14: Grid_Migration không đổi các field khác ngoài `plots`/`grid_version`** — **Validates: Requirements 8.4**
    - **Property 15: Grid_Migration chỉ mở rộng, không thu hẹp, và phủ đủ lưới mới** — **Validates: Requirements 8.5**
    - **Property 16: Grid_Migration là idempotent** — **Validates: Requirements 8.6**
    - Dùng fast-check (hoặc thư viện PBT tương ứng đã dùng trong `backend/package.json`), tối thiểu 100 lần lặp mỗi property, đặt tại `backend/src/services/ocb-farm/farm-grid-migration.spec.ts`, tag mỗi test `// Feature: ocb-farm-cinema-upgrade, Property {number}: {property_text}`
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.6_

- [x] 2. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 3. Tích hợp Grid_Migration vào repository backend + khởi tạo nông trại mới

  - [ ] 3.1 Áp `migrateGridTo20x25` vào `farm-state.repository.ts`
    - Gọi `migrateGridTo20x25(ensurePlotLayout(row.state))` ở **cả** `readFarmState` và `readFarmStateForUpdate` (hai hàm đọc đều phải thấy dữ liệu đã migrate, để lệnh ghi như `EXPAND_PLOT` hoạt động đúng trên lưới đã mở rộng)
    - Xác nhận lại: không thêm bất kỳ truy vấn SQL mới nào cho bước này — chỉ xử lý trong code sau khi đọc JSONB
    - _Requirements: 8.1, 8.7_

  - [x] 3.2 Cập nhật khởi tạo nông trại mới dùng lưới 20×25
    - `backend/src/services/ocb-farm/farm-init.service.ts`: `buildInitialFarmStateJson` dùng `EXPANSION_PLOTS_V2` qua `ensurePlotLayout`, đặt `grid_version: CURRENT_GRID_VERSION` ngay khi tạo (nông trại mới không cần migrate)
    - _Requirements: 7.1, 7.3_

  - [ ]* 3.3 Viết integration test cho khởi tạo + migration qua repository
    - Test `POST /me/init` sau nâng cấp tạo nông trại với `grid_version = 2` và đủ plot cho 500 ô; test `GET /me` gọi lặp lại nhiều lần trên state cũ (không có `grid_version`) trả cùng kết quả plots sau lần migrate đầu tiên (1-2 ví dụ, mock DB row)
    - _Requirements: 8.1, 8.6_

  - [x] 3.4 Cập nhật Swagger cho `GET /me` response
    - `backend/src/swagger/components/schemas.yaml`: thêm field `grid_version` (integer, optional) vào schema `FarmStateJson`
    - Verify `/api-docs` render đúng field mới sau khi khởi động lại backend
    - _Requirements: 8.1_

- [ ] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Frontend scene-math — CELL_SIZE gấp đôi + mirror type

  - [x] 5.1 Sửa `scene/farm-scene-math.ts`
    - Đổi `CELL_SIZE` từ giá trị cũ sang gấp đôi (10 → 20); **giữ nguyên** `MAX_ZOOM`, `DEFAULT_MAX_ZOOM`, `MIN_VIEW_CELLS` (không đổi — các công thức `updateMaxZoom()`/`fitFrustumAndShadow` đã độc lập đơn vị dài, tự co giãn đúng theo `CELL_SIZE` mới)
    - Xác nhận `cellToWorld`/`worldToCell` dùng đúng `CELL_SIZE` module-level mới cho mọi lời gọi
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 5.2 Mirror `grid_version` và `FarmFreeRoamSpecies` vào frontend model
    - `src/app/modules/complex-app/ocb-farm/models/ocb-farm.model.ts`: thêm `grid_version?: number` vào `FarmStateJson` (mirror backend); thêm `FARM_FREE_ROAM_SPECIES = ['dog', 'cat'] as const` và `type FarmFreeRoamSpecies` — **không** gộp vào `FARM_SPECIES` dùng cho `state.animals`
    - _Requirements: 4.4, 8.1_

  - [ ]* 5.3 Viết property test cho scene-math
    - **Property 17: Quy đổi ô ↔ toạ độ thế giới là round-trip đúng với CELL_SIZE mới** — **Validates: Requirements 9.1, 9.4**
    - **Property 18: Tỉ lệ khung nhìn tối đa so với CELL_SIZE bất biến khi CELL_SIZE đổi** — **Validates: Requirements 9.2**
    - fast-check, tối thiểu 100 lần lặp, đặt tại `scene/farm-scene-math.spec.ts`, tag `// Feature: ocb-farm-cinema-upgrade, Property {number}: {property_text}`
    - _Requirements: 9.1, 9.2, 9.4_

- [ ] 6. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Module hàm thuần frontend — Cinema_Camera_Controller

  - [x] 7.1 Viết `scene/cinema-camera.ts`
    - Định nghĩa `CinemaBounds`, `CinemaSegment`, `CinemaState`
    - `cinemaBoundsFromPlots(plots)`: tính bounds chỉ từ các `plot.unlocked === true` (loại ô khoá)
    - `nextCinemaSegment(bounds, minZoom, maxZoom, previous, nowMs, rand)`: chọn target/zoom ngẫu nhiên trong biên hợp lệ, azimuth ngẫu nhiên liên tục `[0, 2π)`, retry có giới hạn (tối đa 10 lần) nếu trùng y nguyên segment trước
    - `cinemaCameraAt(state, nowMs)`: nội suy easing dựa trên **hiệu số timestamp thực** (`nowMs - startedAtMs`), clamp `t` về tối đa 1 trước khi nội suy — không cộng dồn theo số khung hình
    - _Requirements: 2.2, 2.3, 2.4, 2.9_

  - [ ]* 7.2 Viết property test cho `cinema-camera.ts`
    - **Property 2: Cinema camera luôn kết thúc đúng vị trí đích và nội suy đơn điệu** — **Validates: Requirements 2.4**
    - **Property 3: Segment cinema kế tiếp không lặp y nguyên segment trước và nằm trong biên hợp lệ** — **Validates: Requirements 2.3**
    - **Property 4: Cinema mode không thay đổi state trò chơi dù chạy qua nhiều bước** — **Validates: Requirements 2.7**
    - **Property 5: Cinema camera phục hồi đúng theo thời gian thực sau khoảng dừng dài (throttling)** — **Validates: Requirements 2.9**
    - fast-check, tối thiểu 100 lần lặp mỗi property, đặt tại `scene/cinema-camera.spec.ts`, tag `// Feature: ocb-farm-cinema-upgrade, Property {number}: {property_text}`
    - _Requirements: 2.3, 2.4, 2.7, 2.9_

- [x] 8. Module hàm thuần frontend — Free_Roam_Pet

  - [x] 8.1 Viết `scene/free-roam-pet.ts`
    - Định nghĩa `FreeRoamPetSpawn`, `FreeRoamPetConfig` (mặc định `{ countPerSpecies: 1 }`)
    - `initialFreeRoamPets(plots, centerCell, userId, config)`: tất định theo seed `stableHash(userId|pet)` (tái dùng từ `farm-asset-provider.ts`), chọn ô `unlocked && terrain === 'land'`, khác `centerCell`
    - `nextFreeRoamTarget(plots, centerCell, rand)`: trả `null` hoặc một `FarmCellRef` thuộc `plot.unlocked === true` có `terrain === 'land'`, khác `centerCell`, không giới hạn vùng lân cận
    - _Requirements: 4.1, 4.2, 4.5_

  - [ ]* 8.2 Viết property test cho `free-roam-pet.ts`
    - **Property 6: Luôn có ít nhất một Free_Roam_Pet mỗi loài khi có vùng đất mở** — **Validates: Requirements 4.1**
    - **Property 7: Đích di chuyển của Free_Roam_Pet luôn hợp lệ trên toàn lưới đã mở** — **Validates: Requirements 4.2, 4.5**
    - **Property 8: Free_Roam_Pet không bao giờ xuất hiện trong `state.animals`** — **Validates: Requirements 4.4**
    - fast-check, tối thiểu 100 lần lặp mỗi property, đặt tại `scene/free-roam-pet.spec.ts`, tag `// Feature: ocb-farm-cinema-upgrade, Property {number}: {property_text}`
    - _Requirements: 4.1, 4.2, 4.4, 4.5_

- [x] 9. Module hàm thuần frontend — Anchored_Animal roam

  - [x] 9.1 Viết `scene/anchored-roam.ts`
    - `clampRoamTarget(homeCell, candidateX, candidateZ, plots, species, occupiedByOthers)`: quy đổi candidate → cell gần nhất; nếu không `unlocked`, sai địa hình theo loài, hoặc nằm trong `occupiedByOthers` (Anchor_Cell của entity khác) → trả toạ độ `homeCell`; ngược lại trả nguyên candidate
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ]* 9.2 Viết property test cho `anchored-roam.ts`
    - **Property 9: Đích roam của Anchored_Animal luôn trong Roam_Radius, trên địa hình hợp lệ, đã mở khoá, và giữ nguyên Anchor_Cell cho logic nghiệp vụ** — **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**
    - **Property 10: Chọn (pick) Anchored_Animal đang roam luôn trả đúng id và Anchor_Cell gốc** — **Validates: Requirements 5.6**
    - fast-check, tối thiểu 100 lần lặp mỗi property, đặt tại `scene/anchored-roam.spec.ts`, tag `// Feature: ocb-farm-cinema-upgrade, Property {number}: {property_text}`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 10. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Mở rộng `FarmAnimalLayer` cho loài mới và roam

  - [x] 11.1 Mở rộng `MOTION` và `sync()` trong `scene/farm-animal-layer.ts`
    - Thêm 2 dòng vào bảng `MOTION` cho `dog`/`cat` (`speed`, `roam: 999` không dùng vì free roam dùng target toàn lưới, `idleMin/idleMax`, `weights`)
    - Tăng giá trị `roam` cho 6 loài hiện có từ "trong 1 ô" lên giá trị Roam_Radius theo CELL_SIZE mới (xem Data Models trong design)
    - Mở rộng chữ ký `sync(spawns, templateOf, roamContext: { plots })` — truyền `plots` để `enterMove()` gọi `clampRoamTarget` mỗi khi chọn điểm đích mới
    - Giữ nguyên tuyệt đối: `FarmAnimalSpawn.cell` luôn là Anchor_Cell, không bị ghi đè bởi vị trí roam hiển thị
    - _Skills: kích hoạt trước khi làm — `threejs-animation`_
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 5.6, 5.7, 6.1, 6.2_

  - [ ]* 11.2 Viết unit test cho hành vi "buồn" (độ no 0) của Anchored_Animal
    - Test Anchored_Animal ở độ no 0 di chuyển chậm hơn và ưu tiên đứng yên trong Roam_Radius (kiểm ví dụ cụ thể theo máy trạng thái hiện có, không cần PBT vì đây là hành vi dự phòng đã có từ spec gốc)
    - _Requirements: 5.7_

  - [x] 11.3 Thêm chuyển động thủ tục dự phòng và phân biệt instancing/skeletal cho model mới
    - Xác nhận cơ chế dự phòng hiện có (hop/bob/nod) tự động áp dụng cho `dog`/`cat` khi thiếu clip hoạt ảnh xương phù hợp — không cần code mới nếu máy trạng thái đã nhận diện theo tên clip (regex), chỉ bổ sung test xác nhận
    - Xác nhận `swayAmplitude()` không bị áp nhầm vào vật thể có xương (`animal`) — chỉ áp cho `decor:*` instancing tĩnh
    - _Requirements: 6.1, 6.2, 6.4_

  - [ ]* 11.4 Viết property test cho biên độ đung đưa (`swayAmplitude`)
    - **Property 11: Biên độ đung đưa của mã trang trí mới khớp đúng nhóm** — **Validates: Requirements 6.3**
    - fast-check, tối thiểu 100 lần lặp, đặt tại `services/farm-scene.service.spec.ts` (hoặc `scene/sway.spec.ts` nếu tách riêng), tag `// Feature: ocb-farm-cinema-upgrade, Property 11: {property_text}`
    - _Requirements: 6.3_

- [x] 12. Tích hợp Cinema_Mode, Free_Roam_Pet, roam vào `FarmSceneService`

  - [x] 12.1 Tích hợp `CinemaCameraController` vào `FarmSceneService`
    - Thêm field `cinema: CinemaState | null`, signal `cinemaActive`; `enterCinemaMode()` (guard `if (!this.bounds) return`, tính bounds qua `cinemaBoundsFromUnlockedPlots()`), `exitCinemaMode()`
    - Trong `frame(time)`: nếu `this.cinema`, gọi `cinemaCameraAt` thay cho đọc `target`/`zoom`/`azimuth` trực tiếp; khi `finished`, sinh segment kế tiếp qua `nextCinemaSegment(..., previous: this.cinema.segment, ...)`
    - Xác nhận bất biến: không gọi `FarmStateStore.dispatch`, không tham chiếu `state`/`version`/`balance` trong toàn bộ đường gọi cinema
    - _Skills: kích hoạt trước khi làm — `threejs-fundamentals`_
    - _Requirements: 2.1, 2.2, 2.4, 2.6, 2.7, 2.8, 2.10_

  - [x] 12.2 Tích hợp Free_Roam_Pet vào `FarmSceneService`
    - Thêm field riêng `freeRoamSpawns: FreeRoamPetSpawn[]`, khởi tạo một lần trong `syncTerrain()` qua `initialFreeRoamPets`, không bị ghi đè bởi `setState()`
    - Mở rộng `FarmAnimalLayer` nhận danh sách spawn phụ (Free_Roam_Pet) song song với spawn từ `state.animals`; actor Free_Roam_Pet cập nhật lại `homeX/homeZ` thành vị trí mới mỗi khi tới đích (khác Anchored_Animal)
    - _Skills: kích hoạt trước khi làm — `threejs-animation`_
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.6_

  - [x] 12.3 Nối `roamContext` vào `groupEntities()`
    - `FarmSceneService.groupEntities()` truyền `plots`/thông tin ô đã mở vào `FarmAnimalLayer.sync()` để `enterMove()` gọi đúng `clampRoamTarget`
    - _Requirements: 5.1, 5.2, 5.4_

  - [ ]* 12.4 Viết integration-style unit test cho tích hợp FarmSceneService
    - Test `enterCinemaMode()` không bật khi `bounds === null`; test Free_Roam_Pet không bị mất khi `setState()` được gọi nhiều lần liên tiếp (bổ sung ví dụ cụ thể cho Property 8 ở mức service, không lặp PBT)
    - _Requirements: 2.1, 4.4_

  - [x] 12.5 Thêm output `cinemaInterrupted` cho `farm-canvas.component.ts`
    - `attachControls` phát `cinemaInterrupted` khi `pointerdown`/`wheel` xảy ra lúc `scene.cinemaActive()` đang `true`
    - _Requirements: 2.5_

- [ ] 13. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. `FullscreenService`

  - [x] 14.1 Viết `services/fullscreen.service.ts`
    - `@Injectable({ providedIn: 'root' })`, signal `_active`/`_unsupported`, readonly `active`/`unsupported`
    - Listener `fullscreenchange` trên `document` là nguồn chân lý duy nhất cho `_active` (gỡ qua `DestroyRef.onDestroy`)
    - `enter(el)`: gọi `el.requestFullscreen()`, bắt lỗi/API không tồn tại → set `_unsupported = true`, trả `false`; không tự set `_active`
    - `exit()`: gọi `document.exitFullscreen()` nếu đang fullscreen
    - _Requirements: 1.1, 1.3, 1.4, 1.6_

  - [ ]* 14.2 Viết property test cho `FullscreenService`
    - **Property 1: Fullscreen state luôn đồng bộ với `document.fullscreenElement`** — **Validates: Requirements 1.6**
    - fast-check, tối thiểu 100 lần lặp (mock `document.fullscreenElement` qua chuỗi sự kiện ngẫu nhiên), đặt tại `services/fullscreen.service.spec.ts`, tag `// Feature: ocb-farm-cinema-upgrade, Property 1: {property_text}`
    - _Requirements: 1.6_

- [x] 15. UI component — `farm-canvas` (Fullscreen + Cinema entry points)

  - [x] 15.1 Thêm nút Fullscreen và nút thoát vào `farm-canvas.component.ts/.html`
    - Nút bật fullscreen gọi `FullscreenService.enter(.farm-stage)`; khi `isFullscreen() === true`, hiển thị `.farm-stage-fullscreen` (CSS nền đen, 100% kích thước) và nút thoát duy nhất `.farm-fullscreen-exit`
    - Khi `_unsupported()` true, hiển thị `.alert.alert-warning` tiếng Việt "Trình duyệt không hỗ trợ hoặc đã từ chối chế độ toàn màn hình.", giữ nguyên chế độ hiển thị thường
    - Giữ nguyên mọi cử chỉ điều khiển camera hiện có (kéo, cuộn/chụm, xoay 90°) trong `.farm-stage` khi fullscreen
    - _Requirements: 1.1, 1.2, 1.4, 1.5_

  - [x] 15.2 Đồng bộ thoát Fullscreen qua nguồn bên ngoài
    - Component lắng nghe `FullscreenService.active()` (signal) để tự đồng bộ UI khi trình duyệt thoát fullscreen do nguồn ngoài (Esc do OS, chuyển app) — không cần xử lý thêm, chỉ cần template bind đúng theo `active()`
    - _Requirements: 1.3, 1.6_

- [ ] 16. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 17. UI component — `ocb-farm-main` (toggle Fullscreen_Mode/Cinema_Mode, ẩn panel/HUD)

  - [x] 17.1 Thêm signal `isFullscreen`/`cinemaMode` và ẩn panel theo điều kiện
    - `ocb-farm-main.component.ts/.html`: `isFullscreen = computed từ FullscreenService.active()`, `cinemaMode = signal(false)`
    - Khi `isFullscreen()`: ẩn `.card-header`, tiêu đề `<h4>`, `app-farm-hud` qua `@if (!isFullscreen())`
    - Khi `cinemaMode()`: ẩn toàn bộ `.card-header`, `app-farm-hud`, mọi panel, chỉ còn `.farm-stage` + 1 nút thoát nổi trên canvas
    - Fullscreen_Mode và Cinema_Mode độc lập, có thể bật cùng lúc
    - _Requirements: 1.2, 2.1_

  - [x] 17.2 Nối nút bật/tắt Cinema_Mode và xử lý `cinemaInterrupted`
    - Nút "Chế độ Cinema" gọi `cinemaMode.set(true)` + `scene.enterCinemaMode()`; nút thoát hoặc nhận `cinemaInterrupted` từ `farm-canvas` → `cinemaMode.set(false)` + `scene.exitCinemaMode()`
    - _Requirements: 2.1, 2.5, 2.6_

  - [x] 17.3 Xác nhận Fullscreen/Cinema không đổi settings và không tự khởi động lại
    - Xác nhận template/component không đọc/ghi `FarmSettings.quality`/`bgm`/`sfx` ở bất kỳ đường toggle Fullscreen/Cinema nào
    - Xác nhận `isFullscreen`/`cinemaMode` luôn khởi tạo `false` khi component được tạo mới (không đọc từ localStorage/state cũ)
    - _Requirements: 12.1, 12.2, 12.3_

  - [ ]* 17.4 Viết property test cho bất biến settings và khởi tạo lại component
    - **Property 24: Fullscreen/Cinema không đổi settings chất lượng/âm thanh** — **Validates: Requirements 12.1, 12.2**
    - **Property 25: Fullscreen/Cinema không tự khởi động lại sau khi tạo lại component** — **Validates: Requirements 12.3**
    - fast-check, tối thiểu 100 lần lặp mỗi property, đặt tại `ocb-farm-main.component.spec.ts` (hoặc `services/farm-settings-sync.service.spec.ts` nếu tách), tag `// Feature: ocb-farm-cinema-upgrade, Property {number}: {property_text}`
    - _Requirements: 12.1, 12.2, 12.3_

  - [ ]* 17.5 Viết unit test cho DOM fullscreen/cinema UI
    - Test `.farm-stage` nhận đúng class khi `isFullscreen() === true`; nút thoát xuất hiện/biến mất đúng theo cờ; ẩn đúng các phần tử panel/HUD khi `cinemaMode() === true`
    - _Requirements: 1.2, 2.1_

- [ ] 18. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 19. Asset Manifest + model 3D mới (poly.pizza) + license checklist

  - [ ] 19.1 Mở rộng `asset-manifest.json` cho model mới
    - `public/assets/ocb-farm/asset-manifest.json`: thêm 2 entry vào `animals` (`dog`, `cat` — cấu trúc `files.low/medium/high`, `fallback_color`), thêm entry vào `decors` cho `tree_pine`, `tree_oak`, `bush_round`, `bush_berry`, `flowerbed_tulip`, `lamp_garden` (đặt tên theo quy ước nhóm `decorGroupOf` đã có)
    - Mỗi mã khai báo mã hiển thị, nhãn tiếng Việt, đường dẫn GLB 3 mức chất lượng, màu khối hộp fallback **trước khi** model được render — mã chưa khai báo thì không render, hiển thị fallback theo nhóm
    - `animal:dog`/`animal:cat` đặt `initial: true` (bắt buộc tải đầu); các mã `decor:*` mới đặt `initial: false` (tải nền sau)
    - _Skills: kích hoạt trước khi làm — `threejs-loaders`_
    - _Requirements: 3.1, 3.5, 11.3, 11.4_

  - [ ] 19.2 Thu thập và kiểm giấy phép model mới từ poly.pizza
    - Tải GLB qua tài khoản thật trên poly.pizza (hoặc nguồn CC0 dự phòng nếu poly.pizza không có model phù hợp) cho 8 mã: `animal:dog`, `animal:cat` (phải có rigging/xương), `decor:tree_pine`, `decor:tree_oak`, `decor:bush_round`, `decor:bush_berry`, `decor:flowerbed_tulip`, `decor:lamp_garden`
    - Áp checklist 6 bước đã nêu trong design: (1) giấy phép CC0/CC-BY/thương mại hợp lệ, (2) nếu CC-BY cần ghi công, (3) nếu không đặt được ghi công ở trang trợ giúp → loại khỏi dự án, (4) model dùng cho `animal:*` phải có rigging, nếu không chỉ dùng cho `decor:*`, (5) dung lượng từng file low/medium/high trong ngân sách, (6) ghi dòng vào `ASSET-LICENSES.md`
    - Model nào không đạt bước (1)-(4) → **loại khỏi dự án, không khai báo vào manifest** (AC 3.4) — không tải trực tiếp từ URL trang nguồn, phải qua tài khoản đã đăng nhập
    - _Requirements: 3.2, 3.4_

  - [ ] 19.3 Cập nhật `ASSET-LICENSES.md`
    - Với mỗi model đã chấp nhận ở 19.2, thêm một dòng kê khai: tên asset, nguồn tải, tên giấy phép, ngày tải, yêu cầu ghi công, mã tương ứng trong Asset_Manifest
    - Model chỉ được coi là "đã nhận" vào dự án **sau khi** dòng kê khai này tồn tại trong `ASSET-LICENSES.md` — không khai báo vào manifest (19.1) trước khi hoàn thành bước này
    - Nếu có yêu cầu ghi công bắt buộc, thêm phần ghi công vào trang trợ giúp của app
    - _Requirements: 3.3, 3.4_

  - [ ] 19.4 Xử lý và tối ưu model mới
    - Gộp mesh, giảm tam giác, xuất 3 mức LOD (low/medium/high), nén Draco geometry, đặt file vào `public/assets/ocb-farm/models/` theo đúng đường dẫn đã khai báo trong manifest (19.1)
    - _Skills: kích hoạt trước khi làm — `threejs-geometry`, `threejs-textures`_
    - _Requirements: 11.3_

  - [ ] 19.5 Cập nhật script kiểm ngân sách dung lượng
    - Chạy lại script kiểm ngân sách hiện có (đọc manifest, cộng tổng dung lượng gzip tập file `initial: true`) với ngân sách mới **12 MB** (tăng từ 8 MB do thêm `animal:dog`/`animal:cat` vào tập tải đầu); vượt ngân sách → quay lại bước 19.4 giảm tam giác/nén thêm
    - _Requirements: 11.3, 11.4_

  - [ ] 19.6 Dựng hình học đung đưa cho nhóm decor mới
    - Xác nhận `swayAmplitude()` hiện có (đã tổng quát theo tiền tố nhóm `tree_*`/`bush_*`/`flowerbed_*`) tự động áp đúng biên độ cho 5 mã decor mới không cần sửa hàm — chỉ cần xác nhận bằng test (đã có ở task 11.4)
    - _Requirements: 6.3_

- [ ] 20. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 21. Hiệu năng — xác nhận instancing không tỉ lệ theo số ô/entity

  - [ ] 21.1 Xác nhận `buildPlotGrid`/`buildFarmScatter` không đổi kiến trúc cho lưới 500 ô
    - Xác nhận lưới ô đất + ao tiếp tục dùng ≤ 4 `InstancedMesh` theo nhóm vật liệu (land/soil/pond-bed/pond-surface) khi mở rộng 195→500 ô — không cần sửa code, chỉ xác nhận bằng test
    - Xác nhận Scatter_Decoration tiếp tục dùng đúng 4 `InstancedMesh` (cỏ/sỏi/hoa/lá súng) không đổi theo số ô
    - _Requirements: 10.3, 11.1_

  - [ ]* 21.2 Viết property test cho hiệu năng instancing lưới/scatter/entity
    - **Property 19: Scatter_Decoration xác định (determinism) không đổi theo kích thước lưới** — **Validates: Requirements 10.1**
    - **Property 20: Số InstancedMesh của Scatter_Decoration cố định, không tỉ lệ theo số ô** — **Validates: Requirements 10.3**
    - **Property 21: Vị trí Scatter_Decoration luôn gần mép ô theo đúng tỉ lệ CELL_SIZE bất kỳ** — **Validates: Requirements 10.4**
    - **Property 22: Số InstancedMesh của lưới ô đất/ao cố định, không tỉ lệ theo số ô** — **Validates: Requirements 11.1**
    - **Property 23: Số batch instancing tỉ lệ theo số loại mã hiển thị, không theo số lượng entity** — **Validates: Requirements 11.2**
    - fast-check, tối thiểu 100 lần lặp mỗi property, đặt tại `scene/geometry/farm-scatter.geometry.spec.ts` (Property 19-21), `scene/geometry/plot-grid.geometry.spec.ts` (Property 22), `services/farm-scene.service.spec.ts` (Property 23), tag `// Feature: ocb-farm-cinema-upgrade, Property {number}: {property_text}`
    - _Requirements: 10.1, 10.3, 10.4, 11.1, 11.2_

- [ ] 22. Swagger — rà soát đồng bộ cuối cùng

  - [ ] 22.1 Rà soát toàn bộ thay đổi Swagger liên quan nâng cấp này
    - Xác nhận `backend/src/swagger/components/schemas.yaml` có field `grid_version` trong schema `FarmStateJson` (đã làm ở 3.4) — kiểm lại không có schema nào khác bị lệch do nâng cấp (API không thêm/đổi endpoint mới trong phạm vi này, chỉ đổi response field)
    - Khởi động backend, verify `/api-docs` render đúng field mới, không có lỗi parse YAML
    - _Requirements: 8.1_

- [ ] 23. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 24. Hoàn thiện tích hợp cuối

  - [ ] 24.1 Rà soát toàn bộ tích hợp UI và hiệu năng tải
    - Xác nhận Fullscreen_Mode/Cinema_Mode không vượt ngưỡng ngân sách tải lần đầu (12 MB) đã kiểm ở 19.5; xác nhận Grid_Migration không tải thêm tài nguyên 3D vượt quá tập mã đã khai báo trong manifest
    - Chạy `npm run build:all` để xác nhận không lỗi build sau toàn bộ thay đổi
    - _Requirements: 11.3, 11.4_

  - [ ]* 24.2 Viết integration test luồng chính của bản nâng cấp
    - Luồng: mở nông trại cũ (legacy, chưa có `grid_version`) → `GET /me` tự migrate → thấy đủ plot cũ + plot mới khoá → bật Fullscreen_Mode → bật Cinema_Mode (camera tự chuyển động, không gửi lệnh) → tương tác chuột thoát Cinema_Mode → thấy Free_Roam_Pet di chuyển tự do → thấy Anchored_Animal roam quanh Anchor_Cell nhưng vẫn nhận đúng lệnh cho ăn/thu hoạch theo Anchor_Cell
    - _Requirements: 1.1, 2.1, 2.5, 4.1, 5.1, 5.5, 8.1_

- [ ] 25. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Các task có hậu tố `*` là tuỳ chọn (có thể bỏ qua để ra MVP nhanh hơn) — **ngoại lệ**: toàn bộ property test (task `*.2`/`*.4` tương ứng mỗi property trong design) vẫn được đánh dấu `*` theo đúng convention đã dùng ở spec gốc `ocb-farm/tasks.md` (test luôn optional-marked dù bắt buộc hay không về mặt chất lượng), nhưng đây là cách **duy nhất** kiểm chứng 25 Correctness Properties đã định nghĩa trong design — khuyến nghị mạnh **không bỏ qua** các task này.
- **Xác nhận không tạo migration SQL**: `grid_version` nằm trong cột JSONB `farm_states.state`, không cần `ALTER TABLE` hay file `.sql` mới. Toàn bộ task liên quan Grid_Migration (1.1, 1.3, 3.1, 3.2) chỉ sửa code TypeScript.
- Nhóm asset (task 19) phải xong trước khi coi tích hợp `FarmAnimalLayer`/`FarmSceneService` cho `dog`/`cat` là hoàn chỉnh về mặt hiển thị — thiếu nhóm này thì model mới chỉ hiển thị khối hộp fallback (vẫn đúng hành vi theo AC 3.5/3.6, không chặn tiến độ các task khác).
- Model 3D mới từ poly.pizza **phải tải qua tài khoản thật** để tải — không nhúng trực tiếp từ URL trang nguồn vào code hoặc build pipeline. Một model chỉ được coi là "đã nhận" vào dự án sau khi dòng kê khai tương ứng đã có trong `ASSET-LICENSES.md` (task 19.3) — khai báo vào `asset-manifest.json` (task 19.1) phải đến **sau** bước này trong thực thi thực tế, dù thứ tự task liệt kê 19.1 trước 19.3 để nhất quán với cấu trúc file (model thực tế được điền vào manifest sau khi 19.2/19.3 xác nhận xong).
- Mỗi property test (task có prefix `*` kèm `**Property N**`) MUST dùng cùng thư viện PBT đã có trong `package.json` của phần tương ứng (frontend/backend) — không tự viết PBT từ đầu, tối thiểu 100 lần lặp (`numRuns: 100`), tag theo format `// Feature: ocb-farm-cinema-upgrade, Property {number}: {property_text}`.
- Task có dòng `_Skills: ..._` thì agent thực thi PHẢI kích hoạt đúng skill đó trước khi viết code; nếu cần tổng quan thêm thì kích hoạt `threejs-skills`. Skill chỉ là hướng dẫn kỹ thuật 3D, vẫn phải tuân thủ quy ước dự án (Angular standalone, signals, AdminLTE ngoài khung 3D, SQL `$1`/`$2`, Swagger sync).
- Mọi thay đổi UI ngoài khung 3D (nút fullscreen, nút cinema, thông báo lỗi, panel ẩn/hiện) dùng class AdminLTE 4 / Bootstrap 5 và icon `bi bi-*`, nội dung tiếng Việt — khung 3D (`.farm-stage`, canvas) không bị ràng buộc này.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.4"] },
    { "id": 3, "tasks": ["2"] },
    { "id": 4, "tasks": ["3.1", "3.2"] },
    { "id": 5, "tasks": ["3.3", "3.4"] },
    { "id": 6, "tasks": ["4"] },
    { "id": 7, "tasks": ["5.1", "5.2"] },
    { "id": 8, "tasks": ["5.3"] },
    { "id": 9, "tasks": ["6"] },
    { "id": 10, "tasks": ["7.1", "8.1", "9.1"] },
    { "id": 11, "tasks": ["7.2", "8.2", "9.2"] },
    { "id": 12, "tasks": ["10"] },
    { "id": 13, "tasks": ["11.1"] },
    { "id": 14, "tasks": ["11.2", "11.3"] },
    { "id": 15, "tasks": ["11.4"] },
    { "id": 16, "tasks": ["12.1", "12.2"] },
    { "id": 17, "tasks": ["12.3", "12.5"] },
    { "id": 18, "tasks": ["12.4"] },
    { "id": 19, "tasks": ["13"] },
    { "id": 20, "tasks": ["14.1"] },
    { "id": 21, "tasks": ["14.2"] },
    { "id": 22, "tasks": ["15.1"] },
    { "id": 23, "tasks": ["15.2"] },
    { "id": 24, "tasks": ["16"] },
    { "id": 25, "tasks": ["17.1"] },
    { "id": 26, "tasks": ["17.2", "17.3"] },
    { "id": 27, "tasks": ["17.4", "17.5"] },
    { "id": 28, "tasks": ["18"] },
    { "id": 29, "tasks": ["19.1"] },
    { "id": 30, "tasks": ["19.2"] },
    { "id": 31, "tasks": ["19.3"] },
    { "id": 32, "tasks": ["19.4"] },
    { "id": 33, "tasks": ["19.5", "19.6"] },
    { "id": 34, "tasks": ["20"] },
    { "id": 35, "tasks": ["21.1"] },
    { "id": 36, "tasks": ["21.2"] },
    { "id": 37, "tasks": ["22.1"] },
    { "id": 38, "tasks": ["23"] },
    { "id": 39, "tasks": ["24.1"] },
    { "id": 40, "tasks": ["24.2"] },
    { "id": 41, "tasks": ["25"] }
  ]
}
```
