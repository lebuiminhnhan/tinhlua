# Requirements Document

## Introduction

**OCB Farm: Nâng cấp Cinema & Mở rộng Nông trại**

Đây là bản **nâng cấp** cho complex-app `ocb-farm` đã hoàn thiện (xem `.kiro/specs/ocb-farm/` cho spec gốc, mã nguồn tại `src/app/modules/complex-app/ocb-farm/`). Bản nâng cấp này tập trung vào **trải nghiệm người dùng (UX) và hiển thị 3D**, không bổ sung business logic kinh tế/gameplay mới.

Phạm vi chính:

1. Nút toàn màn hình (fullscreen) chỉ hiển thị khung 3D (farm-stage), ẩn mọi panel/UI khác.
2. Chế độ Picture-in-Picture (PiP) tự dựng: chỉ hiển thị farm-stage, không nút điều khiển, camera tự động chuyển động cinema (pan/zoom/rotate ngẫu nhiên, chill).
3. Bổ sung model 3D mới (cây cối, con vật, vật trang trí nông trại) từ nguồn poly.pizza, tuân thủ quy trình kiểm giấy phép đã có.
4. Chó và mèo — vật nuôi thuần decoration, di chuyển tự do toàn nông trại (không giới hạn vào một ô).
5. 6 loài vật nuôi hiện có (gà, cá, cừu, heo, bò, ngựa) — mở rộng vùng di chuyển hiển thị ra các ô lân cận ô đã đặt, trong khi ô gốc vẫn giữ quyền chiếm chỗ ở server.
6. Mở rộng animation nền tảng (`FarmAnimalLayer`) để áp dụng cho các model mới.
7. Mở rộng lưới đất từ 13×15 lên 20×25 ô.
8. Tăng `CELL_SIZE` gấp đôi.
9. Mở rộng decoration rải (`farm-scatter`: cỏ, hoa, đá sỏi) cho phù hợp lưới lớn hơn — thuần hiển thị, không tương tác/mua bán.

Ràng buộc nền tảng: nông trại hiện có của nhân viên đang chơi (`farm_states.state.plots` theo lưới 13×15, `CELL_SIZE` cũ) không được vỡ hoặc mất dữ liệu khi nâng cấp — cần tương thích ngược / mở rộng êm.

## Glossary

- **Farm_Stage**: Vùng canvas WebGL chứa khung nhìn 3D của nông trại (do `FarmSceneService` + `FarmCanvas` component render), không bao gồm panel, HUD, hoặc nút điều khiển.
- **Fullscreen_Mode**: Trạng thái hiển thị trong đó Farm_Stage chiếm toàn bộ viewport trình duyệt thông qua Fullscreen API chuẩn, mọi panel/HUD/nav khác bị ẩn, chỉ còn nút thoát.
- **Cinema_Mode**: Chế độ Picture-in-Picture tự dựng của ứng dụng (không phải Document PiP API của trình duyệt) trong đó Farm_Stage hiển thị full khung nhìn, không có nút điều khiển nào, và camera di chuyển tự động (pan, zoom, rotate) theo kịch bản ngẫu nhiên liên tục để tạo cảm giác "quay cinema".
- **Cinema_Camera_Controller**: Thành phần điều khiển vị trí/zoom/góc camera trong Cinema_Mode, hoạt động độc lập với trạng thái game và input người dùng.
- **Farm_Grid**: Lưới ô đất hình chữ nhật của nông trại, được định nghĩa bởi số hàng × số cột.
- **Legacy_Grid_Farm**: Một bản ghi `farm_states` được tạo trước khi nâng cấp này triển khai, có cấu trúc `state.plots` tham chiếu lưới 13×15 ô với `CELL_SIZE` cũ.
- **Free_Roam_Pet**: Vật nuôi thuộc loài chó hoặc mèo — không gắn với một ô cố định, có thể hiển thị di chuyển tới bất kỳ ô đất đã mở nào trên Farm_Grid.
- **Anchored_Animal**: Vật nuôi thuộc 6 loài hiện có (gà, cá, cừu, heo, bò, ngựa) — có một ô gốc (anchor cell) giữ quyền chiếm chỗ ở server, nhưng được hiển thị di chuyển tự do trong các ô lân cận ô gốc.
- **Anchor_Cell**: Ô đất mà một Anchored_Animal được đặt vào qua lệnh server (`MOVE_ENTITY`/`BUY_ANIMAL`), dùng để tính chiếm chỗ (occupancy) — không đổi trừ khi có lệnh server hợp lệ.
- **Roam_Radius**: Vùng ô lân cận quanh Anchor_Cell mà Anchored_Animal được phép hiển thị di chuyển qua, tính thuần client-side.
- **Scatter_Decoration**: Vật thể hiển thị thuần trang trí (cỏ, hoa, đá sỏi) rải trên Farm_Grid, không có id, không lưu trong `state`, không mua/bán/di chuyển được.
- **Asset_Manifest**: File `public/assets/ocb-farm/asset-manifest.json` — nguồn chân lý duy nhất về model 3D và đường dẫn GLB theo mức chất lượng.
- **FarmAnimalLayer**: Lớp render vật nuôi có hoạt ảnh xương (skeletal animation) hiện có tại `scene/farm-animal-layer.ts`.
- **Grid_Migration**: Quá trình mở rộng `state.plots` của một Legacy_Grid_Farm từ lưới/kích thước ô cũ sang Farm_Grid mới mà không làm mất vật thể, vị trí hiện có, hoặc số dư Hạt OCB.

## Requirements

### Requirement 1: Nút toàn màn hình cho Farm_Stage

**User Story:** Là một nhân viên đang chơi OCB Farm, tôi muốn xem nông trại ở chế độ toàn màn hình, để tôi có thể quan sát nông trại rõ hơn mà không bị panel/HUD che khuất.

#### Acceptance Criteria

1. WHEN nhân viên bấm nút toàn màn hình, THE Farm_Stage SHALL chuyển sang Fullscreen_Mode bằng Fullscreen API chuẩn của trình duyệt.
2. WHILE đang ở Fullscreen_Mode, THE Farm_Stage SHALL ẩn toàn bộ panel, HUD, và điều hướng ngoài khung 3D, chỉ hiển thị khung 3D và một nút thoát.
3. WHEN nhân viên bấm nút thoát hoặc nhấn phím Esc trong Fullscreen_Mode, THE Farm_Stage SHALL thoát Fullscreen_Mode và khôi phục toàn bộ panel/HUD về trạng thái trước đó.
4. IF trình duyệt từ chối hoặc không hỗ trợ Fullscreen API, THEN THE Farm_Stage SHALL hiển thị thông báo tiếng Việt giải thích lý do và giữ nguyên chế độ hiển thị thông thường.
5. WHILE đang ở Fullscreen_Mode, THE Farm_Stage SHALL giữ nguyên mọi cử chỉ điều khiển camera hiện có (kéo, cuộn/chụm phóng to nhỏ, xoay 90°).
6. WHEN trình duyệt thoát Fullscreen_Mode do nguồn bên ngoài ứng dụng (ví dụ nhân viên nhấn phím Esc do hệ điều hành xử lý, hoặc chuyển ứng dụng), THE Farm_Stage SHALL đồng bộ lại trạng thái UI về chế độ hiển thị thông thường.

### Requirement 2: Chế độ Cinema_Mode (Picture-in-Picture tự dựng)

**User Story:** Là một nhân viên muốn thư giãn, tôi muốn xem nông trại tự xoay như một đoạn phim ngắn, để tôi có cảm giác chill mà không cần tự điều khiển camera.

#### Acceptance Criteria

1. WHEN nhân viên bật Cinema_Mode, THE Farm_Stage SHALL hiển thị toàn khung nhìn mà không có bất kỳ nút điều khiển, panel, hoặc HUD nào ngoài một nút thoát duy nhất.
2. WHILE đang ở Cinema_Mode, THE Cinema_Camera_Controller SHALL tự động thay đổi vị trí, mức zoom, và góc xoay camera theo chu kỳ liên tục, không cần tương tác người dùng.
3. WHILE đang ở Cinema_Mode, THE Cinema_Camera_Controller SHALL chọn điểm nhìn và chuyển động kế tiếp theo cách không lặp lại y nguyên quỹ đạo trước đó trong cùng một lượt bật Cinema_Mode (ngẫu nhiên hoá điểm đến, mức zoom, và tốc độ chuyển động mỗi khi hoàn tất một đoạn chuyển động).
4. WHILE đang ở Cinema_Mode, THE Cinema_Camera_Controller SHALL nội suy mượt (easing) giữa các điểm nhìn, không đổi hướng hoặc zoom đột ngột.
5. WHEN nhân viên tương tác (chạm/kéo/cuộn) vào Farm_Stage trong khi Cinema_Mode đang chạy, THE Farm_Stage SHALL thoát Cinema_Mode và khôi phục chế độ hiển thị thông thường kèm toàn bộ panel/HUD.
6. WHEN nhân viên bấm nút thoát Cinema_Mode, THE Farm_Stage SHALL dừng Cinema_Camera_Controller và khôi phục chế độ hiển thị thông thường.
7. WHILE đang ở Cinema_Mode, THE Cinema_Camera_Controller SHALL không làm thay đổi bất kỳ trường nào của trạng thái trò chơi (`state`, `version`, `balance`) và không gửi lệnh nào tới server.
8. WHILE đang ở Cinema_Mode, THE Farm_Stage SHALL tiếp tục đồng bộ tick trạng thái nông trại (vật nuôi, cây trồng) theo đúng chu kỳ hiện có, không bị Cinema_Camera_Controller làm chậm hoặc chặn.
9. IF tab trình duyệt bị trình duyệt tiết giảm tần số khung hình (background throttling) trong khi Cinema_Mode đang chạy, THEN THE Cinema_Camera_Controller SHALL tiếp tục chuyển động đúng theo thời gian thực khi tab được focus lại, không nhảy khung hình hoặc dừng vĩnh viễn.
10. WHILE đang ở Cinema_Mode, THE Farm_Stage SHALL áp dụng mức chất lượng đồ họa hiện tại của nhân viên (`QualityService`), không tự đổi mức chất lượng.

### Requirement 3: Bổ sung model 3D mới từ nguồn ngoài

**User Story:** Là một nhân viên chơi OCB Farm, tôi muốn nông trại có thêm cây cối, con vật, và vật trang trí sinh động hơn, để nông trại trông đẹp và đa dạng hơn.

#### Acceptance Criteria

1. WHEN một model 3D mới được thêm vào dự án, THE Asset_Manifest SHALL khai báo mã hiển thị, nhãn tiếng Việt, đường dẫn GLB theo 3 mức chất lượng (thấp/vừa/cao), và màu khối hộp fallback cho model đó trước khi model được render.
2. IF một model 3D được tải từ nguồn ngoài (poly.pizza hoặc nguồn dự phòng), THEN THE model đó SHALL chỉ được chấp nhận khi giấy phép cho phép sử dụng thương mại, theo đúng quy trình kiểm giấy phép đã áp dụng cho asset hiện có.
3. WHEN một model 3D mới được chấp nhận vào dự án, THE ASSET-LICENSES.md SHALL ghi thêm một dòng kê khai gồm tên asset, nguồn tải, tên giấy phép, ngày tải, yêu cầu ghi công, và mã tương ứng trong Asset_Manifest.
4. IF một model 3D có giấy phép yêu cầu ghi công bắt buộc và phần ghi công không thể đặt được ở trang trợ giúp của app, THEN model đó SHALL bị loại khỏi dự án và không được khai báo trong Asset_Manifest.
5. WHERE một mã hiển thị chưa được khai báo trong Asset_Manifest, THE Farm_Stage SHALL không render model đó và SHALL hiển thị khối hộp fallback theo nhóm loại vật thể.
6. WHEN mô hình thật của một mã đã khai báo tải lỗi tại thời điểm chạy, THE Farm_Stage SHALL hiển thị khối hộp fallback màu theo loại vật thể tại đúng ô và ghi mã đó vào danh sách hạng mục tải lỗi, không chặn hiển thị các vật thể khác.

### Requirement 4: Chó và mèo — vật nuôi tự do di chuyển toàn nông trại

**User Story:** Là một nhân viên chơi OCB Farm, tôi muốn có chó và mèo chạy nhảy tự do khắp nông trại, để nông trại cảm thấy sống động và gần gũi hơn.

#### Acceptance Criteria

1. WHERE nhân viên đã mở khóa ít nhất một vùng đất, THE Farm_Stage SHALL hiển thị tối thiểu một Free_Roam_Pet (chó hoặc mèo) di chuyển trong nông trại của nhân viên đó.
2. WHILE một Free_Roam_Pet đang hiển thị, THE Farm_Stage SHALL cho phép Free_Roam_Pet di chuyển hiển thị tới bất kỳ ô đất đã mở nào trên Farm_Grid, không giới hạn vào một ô cố định.
3. WHILE một Free_Roam_Pet đang di chuyển, THE Farm_Stage SHALL phát hoạt ảnh di chuyển (đi/chạy) tương ứng và quay đầu theo hướng di chuyển, theo cùng cơ chế hoạt ảnh của FarmAnimalLayer hiện có.
4. THE Free_Roam_Pet SHALL không có sản phẩm thu hoạch, không tham gia bất kỳ lệnh kinh tế nào (mua/bán/cho ăn/thu hoạch), và không được lưu trong `state.animals`.
5. IF chuyển động ngẫu nhiên tiếp theo của một Free_Roam_Pet dẫn tới một ô chưa mở khóa hoặc ô trung tâm Cây OCB, THEN THE Farm_Stage SHALL chọn lại một ô đích khác trong vùng đất đã mở.
6. WHILE một Free_Roam_Pet đang hiển thị, THE Farm_Stage SHALL duy trì chuyển động liên tục qua lại giữa các ô đất đã mở theo chu kỳ đi/chạy/đứng nghỉ, tương tự hành vi hiện có của vật nuôi khác.

### Requirement 5: Mở rộng vùng di chuyển hiển thị cho vật nuôi hiện có (Anchored_Animal)

**User Story:** Là một nhân viên chơi OCB Farm, tôi muốn vật nuôi của tôi (gà, cá, cừu, heo, bò, ngựa) đi lại quanh khu vực đã đặt, để nông trại trông tự nhiên hơn thay vì vật nuôi đứng yên một ô.

#### Acceptance Criteria

1. WHEN một Anchored_Animal được đặt vào Anchor_Cell qua lệnh server, THE Farm_Stage SHALL cho phép Anchored_Animal đó hiển thị di chuyển trong Roam_Radius quanh Anchor_Cell.
2. THE Roam_Radius SHALL chỉ bao gồm các ô đất đã mở khóa và cùng loại địa hình hợp lệ với loài đó (cá chỉ trong ô nước, các loài khác chỉ trong ô đất).
3. WHILE một Anchored_Animal đang hiển thị di chuyển trong Roam_Radius, THE Anchor_Cell của Anchored_Animal đó SHALL tiếp tục được tính là ô bị chiếm chỗ ở server, không bị vật thể khác chiếm vào.
4. IF một ô trong Roam_Radius của một Anchored_Animal đã bị một Anchored_Animal khác hoặc một vật thể khác chiếm Anchor_Cell, THEN Farm_Stage SHALL không hiển thị hai vật thể chiếm cùng vị trí hiển thị tại cùng thời điểm.
5. WHEN nhân viên thực hiện lệnh cho ăn, thu hoạch, hoặc bán trên một Anchored_Animal, THE Farm_Stage SHALL áp dụng lệnh đó theo đúng Anchor_Cell của vật nuôi, không phụ thuộc vị trí hiển thị hiện tại trong Roam_Radius.
6. WHEN nhân viên chọn (tap/click) một Anchored_Animal đang hiển thị ở một ô trong Roam_Radius khác Anchor_Cell, THE Farm_Stage SHALL vẫn nhận diện đúng vật nuôi đó theo id, không theo vị trí hiển thị.
7. IF Anchored_Animal đang ở trạng thái buồn (độ no bằng 0), THEN THE Farm_Stage SHALL hiển thị Anchored_Animal đó di chuyển chậm hơn và ưu tiên đứng yên trong Roam_Radius, theo đúng hành vi "đói" hiện có của FarmAnimalLayer.

### Requirement 6: Mở rộng animation cho model mới

**User Story:** Là một nhân viên chơi OCB Farm, tôi muốn các model 3D mới (cây cối, con vật, vật trang trí) cũng có chuyển động sống động, để nông trại không bị cứng nhắc.

#### Acceptance Criteria

1. WHEN một model vật nuôi mới (bao gồm chó, mèo) có clip hoạt ảnh xương trong file GLB, THE Farm_Stage SHALL phát clip hoạt ảnh đó theo cùng máy trạng thái hành vi (đứng/đi/chạy/ăn/phản ứng) hiện có của FarmAnimalLayer.
2. IF một model vật nuôi mới không có clip hoạt ảnh xương phù hợp cho một hành vi, THEN THE Farm_Stage SHALL áp dụng chuyển động thủ tục thay thế (nhún nhảy, gật đầu, bật nảy) theo đúng cơ chế dự phòng hiện có của FarmAnimalLayer.
3. WHERE một model cây cối hoặc bụi cây trang trí mới được thêm vào nhóm trang trí (`tree`, `bush`, `flowerbed`), THE Farm_Stage SHALL áp dụng hiệu ứng đung đưa trước gió theo biên độ đã định nghĩa cho nhóm đó.
4. THE Farm_Stage SHALL phân biệt rõ vật thể có hoạt ảnh xương (vật nuôi) với vật thể instancing tĩnh có hiệu ứng đung đưa (trang trí), không áp hoạt ảnh xương vào vật thể instancing.

### Requirement 7: Mở rộng lưới đất lên 20×25 ô

**User Story:** Là một nhân viên chơi OCB Farm, tôi muốn nông trại có nhiều không gian hơn, để tôi có thể bố trí nhiều vật nuôi, cây trồng, và vật trang trí hơn.

#### Acceptance Criteria

1. WHEN một nông trại mới được khởi tạo (`POST /me/init`) sau khi nâng cấp này triển khai, THE Farm_Grid của nông trại đó SHALL được định nghĩa trên lưới kích thước 20 hàng × 25 cột.
2. THE Farm_Grid 20×25 SHALL giữ nguyên vị trí tương đối của ô trung tâm Cây OCB và vùng khởi đầu so với tỉ lệ đã thiết kế cho lưới 13×15 (cùng quy ước vùng số 1 là vùng khởi đầu chứa ô trung tâm).
3. WHEN một nhân viên mở rộng vùng đất mới (`EXPAND_PLOT`) trên Farm_Grid 20×25, THE Farm_Grid SHALL chỉ cho mở vùng kề vùng đã mở, theo đúng quy tắc hiện có.
4. THE Farm_Grid 20×25 SHALL chứa đủ số vùng đất (`plots`) để phủ hết toàn bộ 500 ô, mỗi ô thuộc đúng một vùng.

### Requirement 8: Tương thích ngược cho nông trại hiện có (Grid_Migration)

**User Story:** Là một nhân viên đã chơi OCB Farm trước khi nâng cấp, tôi muốn nông trại hiện có của tôi vẫn giữ đầy đủ vật nuôi, cây trồng, trang trí, và Hạt OCB sau khi nâng cấp, để tôi không bị mất tiến trình đã chơi.

#### Acceptance Criteria

1. WHEN hệ thống nâng cấp phiên bản được triển khai, THE Grid_Migration SHALL áp dụng cho mọi Legacy_Grid_Farm mà không yêu cầu nhân viên thực hiện hành động nào.
2. THE Grid_Migration SHALL giữ nguyên toạ độ ô (`cell`) của mọi vật nuôi, cây trồng, và vật trang trí hiện có trong Legacy_Grid_Farm.
3. THE Grid_Migration SHALL giữ nguyên trạng thái `unlocked` của mọi vùng đất (`plots`) đã có trong Legacy_Grid_Farm.
4. THE Grid_Migration SHALL không làm thay đổi số dư Hạt OCB, kho sản phẩm, thành tựu, huy hiệu, hoặc thâm niên Cây OCB của Legacy_Grid_Farm.
5. WHEN Grid_Migration hoàn tất cho một Legacy_Grid_Farm, THE Farm_Grid của nông trại đó SHALL mở rộng thêm các vùng đất mới (khoá, chưa mở) để đạt kích thước 20×25, không thu hẹp vùng đất đã có.
6. IF Grid_Migration áp dụng cho một Legacy_Grid_Farm nhiều lần (ví dụ gọi lại `GET /me` nhiều lần sau khi đã mở rộng), THEN kết quả SHALL giống hệt kết quả của lần áp dụng đầu tiên (migration là idempotent).
7. WHILE một Legacy_Grid_Farm đã qua Grid_Migration, THE Farm_Stage SHALL hiển thị vị trí thế giới (world position) của vật thể hiện có đúng theo `CELL_SIZE` mới, không bị lệch hoặc chồng lấp với lưới mới.

### Requirement 9: Tăng CELL_SIZE gấp đôi

**User Story:** Là một nhân viên chơi OCB Farm, tôi muốn mỗi ô đất rộng hơn, để vật nuôi và vật trang trí có không gian hiển thị rõ ràng hơn, ít chồng lấp.

#### Acceptance Criteria

1. THE Farm_Stage SHALL quy đổi tâm ô sang toạ độ thế giới theo giá trị CELL_SIZE gấp đôi giá trị hiện tại.
2. WHEN CELL_SIZE tăng gấp đôi, THE Farm_Stage SHALL điều chỉnh mức zoom tối đa (MAX_ZOOM) và khung nhìn tối thiểu theo tỉ lệ tương ứng, để trải nghiệm phóng to/thu nhỏ hiện có không bị thay đổi cảm giác (vật nuôi vẫn chiếm cùng tỉ lệ khung nhìn ở mức zoom tối đa như trước khi tăng CELL_SIZE).
3. WHILE CELL_SIZE đã tăng gấp đôi, THE Farm_Stage SHALL áp dụng đúng cùng giá trị CELL_SIZE mới cho mọi hình học tự sinh (Cây OCB, lưới ô đất, mặt nước ao, Scatter_Decoration) để không có vật thể bị lệch tỉ lệ so với ô.
4. WHEN một nông trại đã qua Grid_Migration được hiển thị, THE Farm_Stage SHALL dùng CELL_SIZE mới để tính vị trí thế giới cho mọi vật thể, kể cả vật thể đã tồn tại từ trước nâng cấp.

### Requirement 10: Mở rộng Scatter_Decoration (cỏ, hoa, đá sỏi) cho lưới lớn hơn

**User Story:** Là một nhân viên chơi OCB Farm, tôi muốn nền đất rải cỏ, hoa, đá sỏi khắp nông trại rộng hơn, để nông trại trông sinh động và tự nhiên hơn.

#### Acceptance Criteria

1. WHEN Farm_Grid của một nông trại có kích thước 20×25, THE Farm_Stage SHALL rải Scatter_Decoration (cỏ, hoa, đá sỏi) trên mọi ô đất đã mở và chưa mở của Farm_Grid đó, theo đúng cơ chế rải tất định theo mã ô hiện có.
2. THE Scatter_Decoration SHALL không có id, không được lưu trong `state`, và không phản hồi khi nhân viên chọn (tap/click) vào vị trí của nó.
3. THE Scatter_Decoration SHALL tiếp tục được render bằng số lượng `InstancedMesh` cố định (không tăng theo số ô) khi Farm_Grid mở rộng từ 13×15 lên 20×25.
4. WHILE Farm_Grid đã mở rộng tới 20×25 và CELL_SIZE đã tăng gấp đôi, THE Scatter_Decoration SHALL giữ nguyên vị trí tương đối gần mép ô (không che vật thể ở giữa ô) theo đúng tỉ lệ ô mới.

### Requirement 11: Ngân sách hiệu năng cho nông trại mở rộng

**User Story:** Là một nhân viên chơi OCB Farm, tôi muốn nông trại vẫn chạy mượt sau khi mở rộng lưới và tăng kích thước ô, để trải nghiệm chơi không bị giật lag.

#### Acceptance Criteria

1. WHEN Farm_Grid mở rộng từ 13×15 (195 ô) lên 20×25 (500 ô), THE Farm_Stage SHALL render lưới ô đất và mặt nước ao bằng số lượng draw call không tỉ lệ thuận với số ô (tiếp tục dùng `InstancedMesh` theo nhóm vật liệu, không dùng một mesh riêng cho mỗi ô).
2. WHEN số loại vật thể hiển thị tăng do thêm model mới (chó, mèo, cây cối, vật trang trí mới), THE Farm_Stage SHALL duy trì số draw call tỉ lệ theo số loại mã hiển thị khác nhau đang có trên nông trại, không tỉ lệ theo số lượng từng vật thể riêng lẻ (trừ vật nuôi có hoạt ảnh xương, vốn đã render riêng từng con theo cơ chế hiện có của FarmAnimalLayer).
3. WHILE Cinema_Mode hoặc Fullscreen_Mode đang chạy, THE Farm_Stage SHALL không vượt ngưỡng dung lượng tải lần đầu đã áp dụng cho tài nguyên 3D của ứng dụng.
4. WHEN Grid_Migration mở rộng một Legacy_Grid_Farm, THE Farm_Stage SHALL không tải thêm tài nguyên 3D vượt quá tập hợp mã đã khai báo trong Asset_Manifest.

### Requirement 12: Trạng thái cài đặt cho Cinema_Mode và Fullscreen_Mode

**User Story:** Là một nhân viên chơi OCB Farm, tôi muốn việc bật/tắt chế độ toàn màn hình hoặc cinema không ảnh hưởng tới cài đặt chất lượng/âm thanh hiện có của tôi, để trải nghiệm nhất quán.

#### Acceptance Criteria

1. WHEN nhân viên bật hoặc tắt Fullscreen_Mode, THE Farm_Stage SHALL giữ nguyên mức chất lượng đồ họa (`FarmSettings.quality`) và cài đặt âm thanh hiện tại.
2. WHEN nhân viên bật hoặc tắt Cinema_Mode, THE Farm_Stage SHALL giữ nguyên mức chất lượng đồ họa và cài đặt âm thanh hiện tại.
3. IF nhân viên thoát ứng dụng hoặc tải lại trang trong khi Cinema_Mode hoặc Fullscreen_Mode đang chạy, THEN THE Farm_Stage SHALL khởi động lại ở chế độ hiển thị thông thường khi nhân viên quay lại, không tự động vào lại Cinema_Mode hoặc Fullscreen_Mode.

## Phi mục tiêu (Out of Scope)

Để tránh mở rộng phạm vi ngoài ý định "nâng cấp UX/hiển thị" của user:

- Không thêm sản phẩm thu hoạch, chu kỳ sinh trưởng, hoặc cơ chế kinh tế mới cho chó/mèo.
- Không thay đổi bảng giá, công thức sinh trưởng, hoặc bất kỳ tham số cân bằng game nào trong `farm_config`.
- Không thêm loại thành tựu/huy hiệu mới liên quan tới chó/mèo hoặc Cinema_Mode.
- Không yêu cầu nhân viên xác nhận hoặc thao tác thủ công cho Grid_Migration.
- Không đổi cơ chế chiếm chỗ (occupancy) ở server cho 6 loài vật nuôi hiện có — chỉ đổi phần hiển thị di chuyển ở client.

## Điểm cần xác nhận

- **XN-5**: Chó và mèo thuộc nhóm vật thể nào trong hệ thống giới hạn số lượng (`FarmLimits`) hiện có, hay là một nhóm đếm riêng không bị giới hạn (vì không mua/bán)? Giả định trong tài liệu này: chó/mèo được hệ thống tự thêm theo nông trại (không qua lệnh mua), không tính vào bất kỳ `FarmLimitCounter` nào.
- **XN-6**: Số lượng Free_Roam_Pet (chó/mèo) cố định cho mọi nông trại là bao nhiêu? Giả định: tối thiểu 1 chó + 1 mèo khi nông trại đã mở ít nhất một vùng đất, số lượng cụ thể để lại cho bước thiết kế đề xuất.
- **XN-7**: Giá trị cụ thể của Roam_Radius (bán kính ô lân cận cho Anchored_Animal) để lại cho bước thiết kế đề xuất dựa trên CELL_SIZE mới và mật độ vật thể mong muốn.
