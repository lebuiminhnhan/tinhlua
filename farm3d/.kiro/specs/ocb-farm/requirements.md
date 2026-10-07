# Requirements Document

**Tên tính năng:** OCB Farm — Nông trại OCB

## Introduction

### Mục tiêu

Xây dựng một nông trại 3D giải trí nhẹ nhàng cho nhân viên OCB: mỗi người có một nông trại riêng để nuôi vật nuôi, trồng cây hoa, và đặc biệt là sở hữu một **Cây OCB** phát triển theo thâm niên làm việc thực tế tại ngân hàng. Mục đích: tạo khoảng nghỉ thư giãn giữa giờ làm, đồng thời tôn vinh sự gắn bó của nhân viên với OCB một cách trực quan và đáng tự hào.

### Người dùng liên quan

- **Nhân viên (người chơi)**: nhân viên OCB đã đăng nhập vào IT Hub. Sở hữu một nông trại riêng, chăm sóc vật nuôi cây trồng, ghé thăm nông trại đồng nghiệp.
- **Khách chưa đăng nhập**: chỉ xem được trang giới thiệu về nông trại, không có nông trại riêng.
- **Quản trị viên (admin)**: sửa ngày vào làm khi nhân viên nhập sai, điều chỉnh số dư khi có sự cố, cấu hình thông số cân bằng game, xem thống kê sử dụng.

### Phạm vi

#### Trong phạm vi
- Nông trại 3D cá nhân với góc nhìn isometric cố định (kéo di chuyển, phóng to/nhỏ, xoay 4 hướng)
- 6 loài vật nuôi: cá, heo, bò, gà, cừu, ngựa
- Trồng cây ăn quả và hoa theo giai đoạn phát triển
- Cây OCB gắn với thâm niên, có mốc phát triển mỗi 6 tháng
- Vòng kinh tế: Hạt OCB (tiền trong game), kho chứa sản phẩm, mua/bán, mở rộng đất
- Chăm sóc theo thời gian thực: độ no vật nuôi, tưới nước cho cây
- Tích lũy sản phẩm khi người chơi offline
- Check-in hàng ngày và chuỗi ngày liên tiếp
- Ghé thăm nông trại đồng nghiệp, giúp tưới cây/cho ăn
- Bảng xếp hạng, thành tựu huy hiệu
- Chu kỳ ngày/đêm, thời tiết, âm thanh, trang trí, chủ đề mùa lễ
- Chụp ảnh nông trại tải về để chia sẻ
- Ba mức chất lượng đồ hoạ, hỗ trợ điện thoại ở mức giảm hiệu ứng
- Trang quản trị cho admin

#### Ngoài phạm vi
- Nông trại chung theo phòng ban (để phase sau)
- Giao dịch/tặng vật phẩm giữa các người chơi
- Chế độ đi bộ góc nhìn thứ nhất trong nông trại
- Bất kỳ hình thức thanh toán bằng tiền thật
- Giết mổ vật nuôi hoặc nội dung bạo lực

---

## Glossary

- **Nông trại**: không gian 3D riêng của một nhân viên, chứa vùng đất, ao nước, vật nuôi, cây trồng, vật phẩm trang trí và Cây OCB.
- **Cây OCB**: cây duy nhất, cố định tại trung tâm nông trại, phát triển theo thâm niên làm việc thực tế của nhân viên tại OCB.
- **Ngày vào làm**: ngày nhân viên bắt đầu làm việc tại OCB, dùng làm gốc để tính thâm niên.
- **Thâm niên**: khoảng thời gian tính từ ngày vào làm đến hiện tại, biểu diễn theo số năm và số tháng.
- **Mốc phát triển**: cấp độ hình dáng của Cây OCB, thay đổi mỗi 6 tháng thâm niên.
- **Ngày kỷ niệm**: ngày trong năm có ngày và tháng trùng với ngày vào làm.
- **Hạt OCB**: đơn vị tiền tệ trong ứng dụng, chỉ dùng nội bộ ứng dụng, không quy đổi ra tiền thật.
- **Kho**: nơi chứa sản phẩm đã thu hoạch trước khi nhân viên quyết định bán.
- **Sản phẩm**: vật phẩm thu được từ vật nuôi hoặc cây trồng (trứng, sữa, len, cá tươi, phân hữu cơ, quả, hoa).
- **Độ no**: mức độ được cho ăn của một vật nuôi, giảm dần theo thời gian.
- **Trạng thái buồn**: trạng thái của vật nuôi khi độ no bằng 0, dừng tạo sản phẩm nhưng không mất vật nuôi.
- **Giai đoạn sinh trưởng**: một trong các bước hạt, mầm, cây lớn, ra hoa hoặc ra quả, sẵn sàng thu hoạch của cây trồng.
- **Ô đất**: đơn vị nhỏ nhất trên nông trại để đặt một cây hoặc một vật phẩm.
- **Vùng đất**: nhóm ô đất được mở khoá cùng nhau bằng Hạt OCB khi mở rộng nông trại.
- **Chuỗi check-in**: số ngày liên tiếp nhân viên nhận phần thưởng check-in.
- **Ghé thăm**: chế độ chỉ xem nông trại của đồng nghiệp, chỉ cho phép hành động giúp đỡ.
- **Lượt giúp**: số lần trong một ngày mà một nhân viên được tưới cây hoặc cho ăn giúp nông trại đồng nghiệp.
- **Thành tựu**: cột mốc có điều kiện xác định, khi đạt thì mở một huy hiệu và thưởng Hạt OCB.
- **Mức chất lượng đồ hoạ**: một trong ba mức Thấp, Vừa, Cao quyết định độ chi tiết hiển thị của nông trại.
- **Chủ đề mùa lễ**: bộ hiệu ứng và vật phẩm trang trí chỉ xuất hiện trong một dịp lễ hoặc mùa nhất định.
- **Quản trị viên**: người có quyền sửa ngày vào làm, điều chỉnh Hạt OCB, đặt lại nông trại, cấu hình thông số và xem thống kê.

---

## Requirements

### Must-have

#### A. Khởi tạo nông trại & ngày vào làm

- [ ] **US-1**: Với tư cách nhân viên, tôi muốn được tạo nông trại tự động ở lần truy cập đầu tiên để bắt đầu chơi ngay mà không phải thiết lập gì phức tạp.
  - **AC**:
  - Given nhân viên đã đăng nhập và tài khoản chưa có nông trại nào trong OCB Farm
  - When nhân viên mở ứng dụng
  - Then hệ thống tạo đúng một nông trại cho tài khoản, gồm một vùng đất khởi đầu, một Cây OCB ở vị trí trung tâm và số Hạt OCB khởi điểm theo cấu hình
  - And trong lúc khởi tạo, hệ thống hiển thị trạng thái đang khởi tạo và hoàn tất trong thời gian tối đa theo cấu hình
  - And hiển thị hướng dẫn ngắn gồm tối đa 5 bước giới thiệu cách chăm sóc, thu hoạch và bán sản phẩm
  - And nhân viên có thể bỏ qua hướng dẫn ở bất kỳ bước nào, và sau khi bỏ qua vẫn mở lại được hướng dẫn từ mục trợ giúp trong nông trại để xem từ bước đầu
  - And nếu nhân viên mở ứng dụng đồng thời trên hai thẻ trình duyệt hoặc hai thiết bị, hệ thống vẫn chỉ tạo một nông trại duy nhất cho tài khoản; phiên còn lại mở đúng nông trại đã tạo và không tạo nông trại thứ hai
  - And nếu việc tạo nông trại thất bại, hệ thống không lưu lại bất kỳ phần nào của nông trại dở dang, hiển thị thông báo lỗi nêu rõ chưa tạo được nông trại và cho phép nhân viên thử lại; lần thử lại thành công vẫn chỉ tạo một nông trại duy nhất

- [ ] **US-2**: Với tư cách nhân viên, tôi muốn được hỏi ngày vào làm tại OCB ở lần truy cập đầu tiên để Cây OCB của tôi phản ánh đúng thâm niên.
  - **AC**:
  - Given nhân viên mở OCB Farm lần đầu và hệ thống chưa có ngày vào làm của nhân viên
  - When màn hình khởi tạo hiển thị
  - Then hệ thống yêu cầu nhân viên chọn ngày vào làm và chặn toàn bộ hoạt động trong nông trại (chăm sóc, thu hoạch, bán sản phẩm) cho đến khi ngày vào làm được xác nhận
  - And hệ thống chỉ chấp nhận ngày nằm trong khoảng từ ngày đầu năm thành lập OCB theo cấu hình đến ngày hiện tại tính theo giờ Việt Nam (UTC+7)
  - And nếu nhân viên chọn ngày ngoài khoảng cho phép (ngày trong tương lai hoặc trước năm thành lập OCB), hệ thống từ chối, hiển thị thông báo nêu rõ khoảng ngày được phép, giữ nguyên giá trị nhân viên vừa nhập để nhân viên sửa lại và không cho tiếp tục
  - And nếu nhân viên bấm xác nhận khi chưa chọn ngày, hệ thống từ chối với thông báo yêu cầu chọn ngày vào làm và giữ nhân viên ở lại màn hình khởi tạo
  - And sau khi nhân viên bấm xác nhận, hệ thống hiển thị thâm niên đã tính theo số năm và số tháng tròn để nhân viên đối chiếu, kèm bước xác nhận lại hoặc quay lại sửa ngày
  - And nếu nhân viên rời màn hình khởi tạo trước khi hoàn tất bước xác nhận lại, hệ thống không lưu ngày vào làm và hiển thị lại màn hình khởi tạo ở lần truy cập sau

- [ ] **US-3**: Với tư cách nhân viên, tôi muốn hệ thống tự điền ngày vào làm nếu dữ liệu nhân sự đã có để tôi chỉ cần xác nhận, giảm nguy cơ nhập sai.
  - **AC**:
  - Given hệ thống tra được ngày vào làm của nhân viên từ nguồn dữ liệu nhân sự sẵn có
  - When màn hình khởi tạo hiển thị
  - Then ngày vào làm được điền sẵn kèm nhãn ghi rõ nguồn giá trị là dữ liệu nhân sự
  - And nhân viên chỉ cần bấm xác nhận một lần để vào nông trại, không phải nhập lại ngày
  - And nếu nhân viên sửa giá trị điền sẵn, nhãn nguồn chuyển thành do nhân viên tự khai và giá trị mới vẫn phải nằm trong khoảng ngày được phép
  - And nếu ngày lấy từ dữ liệu nhân sự nằm ngoài khoảng ngày được phép, hệ thống không điền sẵn, chuyển sang nhập thủ công và thông báo cho nhân viên biết lý do phải tự nhập
  - And nếu việc tra cứu dữ liệu nhân sự thất bại hoặc vượt thời gian chờ theo cấu hình, hệ thống chuyển sang nhập thủ công, hiển thị thông báo không lấy được dữ liệu nhân sự và không chặn nhân viên hoàn tất khởi tạo

- [ ] **US-4**: Với tư cách nhân viên, tôi muốn biết mình phải liên hệ ai khi nhập sai ngày vào làm để không mất tiến trình cây.
  - **AC**:
  - Given ngày vào làm đã được xác nhận
  - When nhân viên mở thông tin Cây OCB
  - Then hệ thống hiển thị ngày vào làm đang áp dụng ở dạng chỉ đọc, nhân viên không thể tự sửa trực tiếp
  - And hiển thị ghi chú nêu rõ chỉ quản trị viên được phép chỉnh sửa ngày vào làm
  - And hiển thị đường dẫn hoặc hướng dẫn từng bước cách yêu cầu quản trị viên chỉnh sửa, gồm kênh liên hệ và các thông tin nhân viên cần cung cấp trong yêu cầu
  - And hiển thị kèm thâm niên đang áp dụng theo số năm và số tháng tương ứng với ngày vào làm đang hiển thị
  - And nếu quản trị viên đã chỉnh sửa ngày vào làm, lần mở thông tin Cây OCB tiếp theo hiển thị ngày mới cùng thâm niên được tính lại, đồng thời giữ nguyên tiến trình cây đã tích lũy

#### B. Cây OCB

- [ ] **US-5**: Với tư cách nhân viên, tôi muốn Cây OCB lớn dần theo thâm niên với mốc mỗi 6 tháng để thấy rõ sự gắn bó của mình với ngân hàng.
  - **AC**:
  - Given nhân viên đã có ngày vào làm được xác nhận và thâm niên được tính theo giờ Việt Nam (UTC+7) từ ngày vào làm đến ngày hiện tại
  - When nhân viên xem nông trại
  - Then Cây OCB hiển thị ở mốc phát triển bằng số kỳ 6 tháng đã hoàn thành trọn vẹn (dưới 6 tháng, 6 tháng, 1 năm, 1 năm 6 tháng, 2 năm, 2 năm 6 tháng, 3 năm, và tiếp tục mỗi 6 tháng), giới hạn ở mốc tối đa theo cấu hình
  - And tại đúng ngày tròn 6 tháng, mốc mới được áp dụng từ 00:00:00 giờ Việt Nam của ngày đó, tức ngày tròn mốc đã thuộc mốc mới
  - And nếu tháng đích không có ngày trùng với ngày vào làm (ví dụ vào làm ngày 31), ngày tròn mốc được lấy là ngày cuối cùng của tháng đích
  - And mỗi mốc cao hơn có chiều cao hiển thị và bán kính tán lá lớn hơn mốc liền trước tối thiểu theo tỷ lệ cấu hình, để hai người quan sát độc lập đều kết luận giống nhau khi so hai mốc liền kề
  - And hệ thống hiển thị nhãn thâm niên hiện tại theo số năm và số tháng, kèm số ngày còn lại tới mốc kế tiếp
  - And nếu nhân viên đã ở mốc tối đa theo cấu hình, hệ thống hiển thị nhãn cho biết cây đã đạt mốc cao nhất thay cho số ngày còn lại
  - And nếu ngày vào làm sau đó được quản trị viên sửa, hệ thống tính lại mốc ngay ở lần hiển thị nông trại kế tiếp; khi mốc mới thấp hơn mốc đang hiển thị, cây trở về đúng mốc mới mà không mất vật nuôi, cây trồng hay Hạt OCB
  - And nếu hệ thống chưa có ngày vào làm của nhân viên, Cây OCB hiển thị ở mốc dưới 6 tháng kèm thông báo yêu cầu bổ sung ngày vào làm

- [ ] **US-6**: Với tư cách nhân viên có thâm niên từ 3 năm, tôi muốn cây mọc thêm một nhánh mới mỗi năm để mỗi năm gắn bó đều để lại dấu vết trên cây.
  - **AC**:
  - Given nhân viên có thâm niên đã hoàn thành trọn vẹn từ 3 năm trở lên tính theo giờ Việt Nam (UTC+7)
  - When nông trại được hiển thị
  - Then số nhánh lớn trên Cây OCB bằng số năm thâm niên đã hoàn thành trừ 2 (3 năm có 1 nhánh, 7 năm có 5 nhánh), giới hạn ở số nhánh tối đa theo cấu hình
  - And nếu thâm niên dưới 3 năm, Cây OCB không có nhánh lớn nào
  - And nhánh của năm mới xuất hiện từ 00:00:00 giờ Việt Nam của ngày kỷ niệm năm đó, không chờ nhân viên đăng nhập lại
  - And khi nhân viên bấm vào một nhánh, hệ thống hiển thị năm dương lịch mà nhánh đó tượng trưng và đây là năm gắn bó thứ mấy
  - And nếu ngày vào làm được quản trị viên sửa làm giảm thâm niên, số nhánh giảm tương ứng ở lần hiển thị nông trại kế tiếp

- [ ] **US-7**: Với tư cách nhân viên có thâm niên từ 3 năm, tôi muốn Cây OCB ra hoa kết quả đúng ngày kỷ niệm vào làm để ngày đó trở nên đặc biệt.
  - **AC**:
  - Given nhân viên có thâm niên đã hoàn thành trọn vẹn từ 3 năm trở lên
  - When ngày và tháng hiện tại theo giờ Việt Nam (UTC+7) trùng với ngày và tháng vào làm
  - Then Cây OCB ở trạng thái ra hoa và kết quả liên tục từ 00:00:00 đến 23:59:59 giờ Việt Nam của ngày đó
  - And nếu ngày vào làm là 29/02 thì trong năm không nhuận, ngày kỷ niệm được tính là 28/02
  - And hệ thống hiển thị banner chúc mừng nêu rõ số năm đồng hành, banner hiển thị trong suốt ngày kỷ niệm kể cả sau khi nhân viên đã hái quả
  - And nhân viên hái được số quả theo cấu hình để đổi thành Hạt OCB thưởng theo cấu hình, và chỉ hái được một lần cho mỗi ngày kỷ niệm
  - And nếu nhân viên bấm hái lần thứ hai trong cùng ngày kỷ niệm, hệ thống từ chối, không cộng thêm Hạt OCB và thông báo phần thưởng năm nay đã được nhận
  - And nếu nhân viên không mở nông trại trong ngày kỷ niệm, phần thưởng vẫn nhận được trong thời gian ân hạn theo cấu hình tính từ hết ngày kỷ niệm; sau thời gian đó phần thưởng của năm hiện tại không còn nhận được
  - And nếu thâm niên dưới 3 năm, Cây OCB không chuyển sang trạng thái ra hoa kết quả và không có quả để hái
  - And khi hết ngày kỷ niệm, cây trở lại trạng thái tương ứng mốc thâm niên hiện hành, chậm nhất ở lần hiển thị nông trại kế tiếp

- [ ] **US-8**: Với tư cách nhân viên, tôi muốn đồng nghiệp ghé thăm nông trại của tôi đúng ngày kỷ niệm sẽ thấy hiệu ứng lễ hội để họ biết và chúc mừng tôi.
  - **AC**:
  - Given nông trại của một nhân viên đang trong ngày kỷ niệm vào làm tính theo giờ Việt Nam (UTC+7)
  - When đồng nghiệp ghé thăm nông trại đó
  - Then đồng nghiệp thấy hiệu ứng lễ hội và banner chúc mừng nêu rõ số năm đồng hành của chủ nông trại
  - And nếu chủ nông trại có thâm niên dưới 3 năm, đồng nghiệp thấy banner chúc mừng nhưng không thấy trạng thái ra hoa kết quả
  - And đồng nghiệp gửi được một lời chúc có độ dài giới hạn theo cấu hình; lời chúc bị từ chối kèm thông báo lý do nếu vượt giới hạn độ dài hoặc chứa nội dung trong danh sách từ ngữ bị cấm, và nội dung đã nhập được giữ lại để sửa
  - And mỗi đồng nghiệp chỉ gửi được một lời chúc cho một nông trại trong một ngày kỷ niệm; lần gửi thứ hai bị từ chối kèm thông báo đã gửi lời chúc năm nay
  - And chủ nông trại thấy danh sách lời chúc ở lần truy cập tiếp theo, mỗi lời chúc kèm tên người gửi và thời điểm gửi, và lời chúc chưa xem được đánh dấu là mới
  - And lời chúc vẫn được lưu và hiển thị cho chủ nông trại kể cả khi chủ nông trại không truy cập trong ngày kỷ niệm

- [ ] **US-9**: Với tư cách nhân viên, tôi muốn Cây OCB được bảo vệ khỏi mọi thao tác xoá hoặc bán để không bao giờ mất tiến trình thâm niên.
  - **AC**:
  - Given nông trại đang hiển thị
  - When nhân viên chọn Cây OCB
  - Then menu tương tác của Cây OCB không chứa lựa chọn di chuyển, bán hoặc xoá, và hiển thị ghi chú rằng Cây OCB là cố định tại trung tâm nông trại
  - And nếu nhân viên vẫn thực hiện thao tác kéo Cây OCB sang ô khác, cây trở về đúng ô trung tâm, hệ thống hiển thị thông báo lý do và số Hạt OCB không thay đổi
  - And Cây OCB không xuất hiện trong danh sách vật phẩm có thể bán và không được tính là vật phẩm chiếm giới hạn số cây trồng
  - And ô trung tâm chứa Cây OCB không nhận được vật nuôi, cây trồng hay vật phẩm trang trí nào khác, kèm thông báo lý do khi nhân viên thử đặt
  - And khi nông trại được quản trị viên đặt lại về trạng thái ban đầu, Cây OCB vẫn ở ô trung tâm với đúng mốc thâm niên hiện hành
  - And ở chế độ ghé thăm, đồng nghiệp không có bất kỳ lựa chọn nào tác động tới Cây OCB ngoài xem thông tin và hái quả của chính nông trại mình

#### C. Vật nuôi

- [ ] **US-10**: Với tư cách nhân viên, tôi muốn mua và đặt vật nuôi thuộc 6 loài (cá, heo, bò, gà, cừu, ngựa) vào nông trại để tạo nông trại theo sở thích riêng.
  - **AC**:
  - Given nhân viên đang mở cửa hàng vật nuôi, số Hạt OCB hiện có lớn hơn hoặc bằng giá niêm yết của loài được chọn, và số vật nuôi hiện có nhỏ hơn giới hạn số vật nuôi theo cấu hình
  - When nhân viên chọn một trong 6 loài (cá, heo, bò, gà, cừu, ngựa), chọn một ô trống hợp lệ và bấm xác nhận mua
  - Then vật nuôi xuất hiện đúng tại ô đã chọn, số Hạt OCB giảm đúng bằng giá niêm yết của loài đó một lần duy nhất, và số dư Hạt OCB mới hiển thị ngay sau khi xác nhận
  - And vật nuôi mới tạo bắt đầu ở độ no bằng mức tối đa và ở trạng thái bình thường, chu kỳ tạo sản phẩm được tính từ thời điểm xác nhận mua
  - And cá chỉ được đặt trong vùng ao nước, các loài còn lại chỉ được đặt trên vùng đất đã mở khoá
  - And nếu nhân viên huỷ hoặc thoát trước khi bấm xác nhận mua, không có Hạt OCB nào bị trừ và không có vật nuôi nào được thêm
  - And nếu ô đích đã có vật nuôi hoặc vật phẩm khác, hoặc sai loại địa hình với loài được chọn, hoặc thuộc vùng đất chưa mở khoá, thì hệ thống từ chối đặt, hiển thị thông báo nêu rõ lý do trong 3 lý do trên, và không trừ Hạt OCB
  - And nếu số Hạt OCB nhỏ hơn giá niêm yết của loài được chọn, hệ thống hiển thị thông báo thiếu kèm số Hạt OCB còn thiếu và gợi ý cách kiếm thêm, và không trừ Hạt OCB
  - And nếu số vật nuôi hiện có đã bằng giới hạn theo cấu hình, hệ thống chặn thao tác mua và hiển thị thông báo nêu rõ số vật nuôi hiện có và giới hạn tối đa

- [ ] **US-11**: Với tư cách nhân viên, tôi muốn cho vật nuôi ăn để chúng khoẻ mạnh và tiếp tục cho sản phẩm.
  - **AC**:
  - Given một vật nuôi có độ no nhỏ hơn mức tối đa và số Hạt OCB hiện có lớn hơn hoặc bằng chi phí một lần cho ăn của loài đó theo cấu hình
  - When nhân viên bấm cho ăn vật nuôi đó
  - Then độ no của vật nuôi tăng lên đúng mức tối đa, chi phí một lần cho ăn bị trừ đúng một lần, và chu kỳ tạo sản phẩm được tính lại từ thời điểm cho ăn
  - And hệ thống phát hiệu ứng hình ảnh vui vẻ của loài đó; âm thanh của loài chỉ phát khi tuỳ chọn âm thanh đang bật, khi tuỳ chọn âm thanh tắt thì chỉ có hiệu ứng hình ảnh và không có âm thanh
  - And nếu vật nuôi đang có độ no bằng mức tối đa, nút cho ăn của vật nuôi đó ở trạng thái vô hiệu, không trừ Hạt OCB và không thay đổi độ no
  - And khi nhân viên chọn cho ăn tất cả, hệ thống hiển thị hộp xác nhận nêu rõ số vật nuôi đang có độ no dưới mức tối đa và tổng chi phí Hạt OCB, chỉ thực hiện sau khi nhân viên bấm xác nhận; nếu huỷ thì không trừ Hạt OCB và không đổi độ no
  - And nếu số Hạt OCB không đủ cho toàn bộ vật nuôi đang đói, hệ thống cho ăn theo thứ tự độ no thấp nhất trước cho tới khi hết Hạt OCB khả dụng, rồi hiển thị kết quả gồm số vật nuôi đã được cho ăn và số vật nuôi chưa được cho ăn
  - And nếu không có vật nuôi nào có độ no dưới mức tối đa, nút cho ăn tất cả ở trạng thái vô hiệu và hệ thống hiển thị thông báo không có vật nuôi nào đang đói
  - And nếu số Hạt OCB nhỏ hơn chi phí một lần cho ăn, hệ thống hiển thị thông báo thiếu Hạt OCB, giữ nguyên độ no và không trừ Hạt OCB

- [ ] **US-12**: Với tư cách nhân viên, tôi muốn vật nuôi bị bỏ lâu thì buồn nhưng không bao giờ chết để tôi không bị áp lực phải vào app mỗi ngày.
  - **AC**:
  - Given một vật nuôi được cho ăn tại một thời điểm và độ no đang ở mức tối đa
  - When thời gian thực trôi qua mà vật nuôi không được cho ăn
  - Then độ no giảm dần theo tốc độ giảm theo cấu hình, giá trị nhỏ nhất là 0 và không bao giờ nhỏ hơn 0
  - And độ no tiếp tục giảm khi nhân viên không mở ứng dụng; khi nhân viên mở lại, hệ thống tính độ no dựa trên khoảng thời gian thực đã trôi qua kể từ lần cho ăn gần nhất và hiển thị giá trị đã được giới hạn trong khoảng từ 0 đến mức tối đa
  - And khi độ no bằng 0, vật nuôi chuyển sang trạng thái buồn và dừng tạo sản phẩm mới
  - And các sản phẩm đã tạo xong nhưng chưa thu hoạch vẫn được giữ nguyên khi vật nuôi chuyển sang trạng thái buồn và vẫn thu hoạch được
  - And vật nuôi không bị mất, không bị xoá và giá bán lại không thay đổi vì trạng thái buồn
  - And sau khi được cho ăn lại, vật nuôi trở lại trạng thái bình thường ngay và chu kỳ tạo sản phẩm bắt đầu lại tính từ thời điểm được cho ăn, không tính thời gian đã ở trạng thái buồn

- [ ] **US-13**: Với tư cách nhân viên, tôi muốn thu hoạch sản phẩm từ vật nuôi để có nguồn thu nhập trong game.
  - **AC**:
  - Given một vật nuôi có ít nhất một sản phẩm đã hoàn thành chu kỳ tạo sản phẩm và đang chờ thu hoạch
  - When nhân viên bấm thu hoạch trên vật nuôi đó
  - Then sản phẩm tương ứng của loài được chuyển vào kho, số lượng sản phẩm chờ thu hoạch của vật nuôi trở về 0, và hệ thống phát hiệu ứng thu hoạch
  - And gà cho trứng, bò cho sữa, cừu cho len, cá cho cá tươi, heo cho phân hữu cơ dùng để bón cây; ngựa không tạo ra sản phẩm thu hoạch được nên không có nút thu hoạch
  - And sau khi thu hoạch, chu kỳ tạo sản phẩm tiếp theo bắt đầu tính từ thời điểm thu hoạch nếu vật nuôi đang ở trạng thái bình thường
  - And vật nuôi đang ở trạng thái buồn vẫn cho thu hoạch các sản phẩm đã chờ sẵn, nhưng không tạo thêm sản phẩm mới cho tới khi được cho ăn
  - And khi nhân viên chọn thu hoạch tất cả, hệ thống thu toàn bộ sản phẩm đang chờ của mọi vật nuôi trong một thao tác và hiển thị bảng tổng hợp gồm tên từng loại sản phẩm và số lượng thu được của từng loại
  - And nếu không có vật nuôi nào đang có sản phẩm chờ thu hoạch, hệ thống hiển thị thông báo chưa có sản phẩm kèm thời gian còn lại tới sản phẩm gần nhất sẵn sàng, và không thay đổi kho

- [ ] **US-14**: Với tư cách nhân viên, tôi muốn nuôi ngựa như vật nuôi cảnh có tác dụng riêng để mỗi loài đều có lý do tồn tại.
  - **AC**:
  - Given nông trại có ít nhất một con ngựa đang ở trạng thái bình thường
  - When nhân viên mở màn hình bán sản phẩm trong kho và chọn sản phẩm để bán
  - Then giá bán được cộng thêm phần thưởng ngựa tính theo tỷ lệ thưởng mỗi con ngựa theo cấu hình, và tổng tỷ lệ thưởng không vượt quá mức giới hạn tối đa theo cấu hình
  - And mức giới hạn tối đa của tỷ lệ thưởng là một hằng số theo cấu hình, không tăng thêm khi số ngựa tăng vượt mức đạt giới hạn
  - And màn hình bán hiển thị tách riêng ba con số: giá bán gốc, phần Hạt OCB thưởng do ngựa, và tổng số Hạt OCB nhận được
  - And nếu nông trại không có con ngựa nào, hoặc tất cả ngựa đang ở trạng thái buồn, thì phần thưởng ngựa bằng 0, tổng nhận được bằng giá bán gốc và màn hình bán nêu rõ lý do không có thưởng
  - And chỉ những con ngựa đang ở trạng thái bình thường được tính vào tỷ lệ thưởng

- [ ] **US-15**: Với tư cách nhân viên, tôi muốn di chuyển và bán lại vật nuôi để sắp xếp lại nông trại khi thay đổi ý định.
  - **AC**:
  - Given nông trại có ít nhất một vật nuôi
  - When nhân viên chọn một vật nuôi, chọn di chuyển và chọn một ô trống hợp lệ đúng loại địa hình của loài đó
  - Then vật nuôi chuyển sang ô mới, ô cũ trở về trạng thái trống, độ no và tiến độ chu kỳ tạo sản phẩm được giữ nguyên, và không có Hạt OCB nào bị trừ cho thao tác di chuyển
  - And nếu ô đích đã bị chiếm, sai loại địa hình với loài đó, hoặc thuộc vùng đất chưa mở khoá, thì hệ thống hiển thị thông báo nêu rõ lý do, giữ nguyên vị trí cũ, giữ nguyên độ no và tiến độ tạo sản phẩm
  - And khi nhân viên chọn bán một vật nuôi, hệ thống hiển thị hộp xác nhận nêu rõ số Hạt OCB được hoàn lại theo tỷ lệ hoàn tiền theo cấu hình và cảnh báo các sản phẩm chưa thu hoạch của vật nuôi đó sẽ bị mất
  - And khi nhân viên bấm xác nhận bán, vật nuôi bị xoá khỏi nông trại, ô đang đặt trở về trạng thái trống, và số Hạt OCB hoàn lại được cộng đúng một lần
  - And nếu nhân viên huỷ ở hộp xác nhận bán, vật nuôi và sản phẩm chưa thu hoạch được giữ nguyên và không có Hạt OCB nào được cộng
  - And nhân viên được phép bán con vật nuôi cuối cùng; sau đó nông trại không còn vật nuôi vẫn mở và hoạt động bình thường, các chức năng cho ăn tất cả và thu hoạch tất cả ở trạng thái vô hiệu kèm thông báo chưa có vật nuôi

#### D. Trồng cây và hoa

- [ ] **US-16**: Với tư cách nhân viên, tôi muốn trồng cây ăn quả và hoa trên các ô đất để nông trại có màu sắc và nguồn thu đa dạng.
  - **AC**:
  - Given nhân viên đang mở cửa hàng hạt giống, nông trại còn ít nhất một ô đất trống và số Hạt OCB hiện có lớn hơn hoặc bằng giá của hạt giống được chọn
  - When nhân viên chọn một loại hạt giống, chọn một ô đất trống và xác nhận trồng
  - Then hạt giống xuất hiện tại đúng ô đã chọn ở giai đoạn hạt, số Hạt OCB bị trừ đúng bằng giá của hạt giống đó, và giao dịch được ghi vào lịch sử thu chi
  - And mỗi ô đất chỉ chứa được một cây tại một thời điểm; khi nhân viên chọn ô đã có cây, hệ thống không trồng, không trừ Hạt OCB và hiển thị thông báo ô đã có cây
  - And danh mục hạt giống gồm ít nhất 3 loại cây ăn quả và 3 loại hoa, mỗi loại hiển thị rõ giá và tổng thời gian sinh trưởng, và không có hai loại nào trùng cả giá lẫn thời gian sinh trưởng
  - And nếu số Hạt OCB nhỏ hơn giá hạt giống, hệ thống không trồng, không trừ Hạt OCB và hiển thị thông báo thiếu Hạt OCB kèm gợi ý cách kiếm thêm
  - And nếu nông trại không còn ô đất trống, hệ thống hiển thị thông báo hết ô trống và gợi ý mở rộng vùng đất

- [ ] **US-17**: Với tư cách nhân viên, tôi muốn thấy cây đi qua các giai đoạn sinh trưởng rõ rệt để cảm nhận được sự tiến triển.
  - **AC**:
  - Given một cây đã được trồng và đang ở trạng thái đủ nước
  - When thời gian sinh trưởng của giai đoạn hiện tại trôi qua hết
  - Then cây chuyển sang giai đoạn kế tiếp theo đúng thứ tự hạt, mầm, cây lớn, ra hoa hoặc ra quả, sẵn sàng thu hoạch, không bỏ qua giai đoạn nào và không quay về giai đoạn trước
  - And mỗi giai đoạn có hình dáng khác biệt, phân biệt được bằng mắt mà không cần bấm vào cây
  - And khi bấm vào cây, hệ thống hiển thị tên loại cây, tên giai đoạn hiện tại và thời gian còn lại tới giai đoạn kế tiếp dưới dạng đếm ngược
  - And khi cây đạt giai đoạn sẵn sàng thu hoạch, hệ thống hiển thị dấu hiệu sẵn sàng thu hoạch ngay trên cây và không còn hiển thị thời gian đếm ngược
  - And nếu cây đang ở trạng thái thiếu nước, thời gian còn lại giữ nguyên không giảm và được hiển thị kèm dấu hiệu đang tạm dừng
  - And thời gian của từng giai đoạn cho mỗi loại cây theo cấu hình, và tổng thời gian các giai đoạn bằng tổng thời gian sinh trưởng công bố trong cửa hàng hạt giống

- [ ] **US-18**: Với tư cách nhân viên, tôi muốn tưới nước cho cây để cây tiếp tục lớn.
  - **AC**:
  - Given một cây đang ở trạng thái thiếu nước
  - When nhân viên bấm tưới nước cho cây đó
  - Then cây chuyển sang trạng thái đủ nước, hiển thị hiệu ứng nước, và thời gian sinh trưởng tiếp tục được tính từ đúng điểm đã tạm dừng
  - And cây chuyển sang trạng thái thiếu nước sau một khoảng thời gian kể từ lần tưới gần nhất theo cấu hình, và trạng thái thiếu nước có dấu hiệu nhận biết được bằng mắt trên cây
  - And khi nhân viên bấm tưới một cây đang ở trạng thái đủ nước, hệ thống không thay đổi trạng thái, không kéo dài chu kỳ khát nước và hiển thị thông báo cây đã đủ nước
  - And nhân viên tưới tất cả cây đang thiếu nước bằng một thao tác duy nhất; các cây đang đủ nước được bỏ qua và hệ thống hiển thị số cây vừa được tưới
  - And khi nông trại không có cây nào đang thiếu nước, thao tác tưới tất cả bị vô hiệu hoá hoặc hiển thị thông báo không có cây cần tưới
  - And khi cây thiếu nước, thời gian sinh trưởng tạm dừng, cây không chết, không mất giai đoạn đã đạt và không mất phần thời gian đã tích luỹ trong giai đoạn hiện tại

- [ ] **US-19**: Với tư cách nhân viên, tôi muốn dùng phân hữu cơ từ heo để cây lớn nhanh hơn để việc nuôi heo có giá trị thực tế.
  - **AC**:
  - Given kho có ít nhất một phân hữu cơ và có một cây chưa đạt giai đoạn sẵn sàng thu hoạch, chưa được bón trong giai đoạn hiện tại
  - When nhân viên chọn cây đó và xác nhận bón phân
  - Then thời gian còn lại tới giai đoạn kế tiếp giảm theo tỷ lệ cấu hình, số lượng phân hữu cơ trong kho giảm đúng 1, và thời gian còn lại hiển thị trên cây được cập nhật ngay
  - And mỗi cây chỉ được bón một lần trong mỗi giai đoạn; lần bón thứ hai trong cùng giai đoạn bị từ chối, không trừ phân hữu cơ và hiển thị thông báo cây đã được bón trong giai đoạn này
  - And nếu cây đang ở giai đoạn sẵn sàng thu hoạch, hệ thống không cho bón, không trừ phân hữu cơ và hiển thị thông báo cây không cần bón thêm
  - And nếu kho không còn phân hữu cơ, thao tác bón bị từ chối, không cây nào thay đổi và hệ thống hiển thị thông báo hết phân hữu cơ kèm gợi ý thu hoạch phân từ heo
  - And nếu mức giảm lớn hơn hoặc bằng thời gian còn lại, cây chuyển ngay sang giai đoạn kế tiếp và phần thời gian vượt quá không được chuyển tiếp sang giai đoạn sau
  - And cây đang thiếu nước vẫn nhận được mức giảm thời gian, nhưng thời gian sinh trưởng chỉ tiếp tục chạy sau khi cây được tưới nước

- [ ] **US-20**: Với tư cách nhân viên, tôi muốn thu hoạch quả và hoa để đưa vào kho và bán.
  - **AC**:
  - Given một cây đang ở giai đoạn sẵn sàng thu hoạch
  - When nhân viên bấm thu hoạch cây đó
  - Then sản phẩm tương ứng của loại cây (quả hoặc hoa) được cộng vào kho với số lượng theo cấu hình của loại cây đó, kèm hiệu ứng thu hoạch
  - And cây ăn quả quay lại giai đoạn ra quả, giữ nguyên ô đất, và bắt đầu lại thời gian tới lần sẵn sàng thu hoạch kế tiếp theo cấu hình
  - And hoa sau khi thu hoạch thì hết vòng đời, biến mất khỏi ô đất, ô đất trở về trạng thái trống và có thể trồng hạt giống mới ngay sau đó
  - And khi nhân viên bấm thu hoạch một cây chưa đạt giai đoạn sẵn sàng thu hoạch, hệ thống không cộng sản phẩm, không thay đổi giai đoạn của cây và hiển thị thông báo cây chưa tới lúc thu hoạch
  - And khi kho đã đạt giới hạn chứa theo cấu hình, hệ thống không thu hoạch, giữ cây ở giai đoạn sẵn sàng thu hoạch và hiển thị thông báo kho đầy kèm gợi ý bán sản phẩm

#### E. Hạt OCB, kho và mở rộng nông trại

- [ ] **US-21**: Với tư cách nhân viên, tôi muốn thấy rõ số Hạt OCB đang có và lịch sử thu chi để hiểu mình đang kiếm và tiêu vào đâu.
  - **AC**:
  - Given nhân viên đang ở trong nông trại của mình
  - When nông trại hiển thị
  - Then số Hạt OCB hiện tại hiển thị ở khu vực thông tin cố định, luôn nhìn thấy được ở mọi góc nhìn và mọi mức chất lượng đồ hoạ
  - And số Hạt OCB hiển thị là số nguyên không âm, được cập nhật trong vòng tối đa 2 giây sau mỗi giao dịch thu hoặc chi mà nhân viên vừa thực hiện
  - And nhân viên mở được lịch sử thu chi liệt kê tối thiểu 50 giao dịch gần nhất, mỗi dòng gồm thời điểm (ngày và giờ phút), nội dung giao dịch, dấu tăng hoặc giảm, số Hạt OCB thay đổi và số dư sau giao dịch
  - And lịch sử được sắp xếp theo thời điểm giảm dần, giao dịch mới nhất ở trên cùng, và nhân viên xem thêm được các giao dịch cũ hơn theo từng trang với số dòng mỗi trang theo cấu hình
  - And nếu nhân viên chưa có giao dịch nào, lịch sử hiển thị trạng thái trống kèm hướng dẫn cách phát sinh giao dịch đầu tiên thay vì bảng rỗng không có nội dung
  - And số Hạt OCB của nhân viên không bao giờ nhỏ hơn 0: mọi thao tác làm số dư xuống dưới 0 đều bị từ chối trước khi trừ, số dư giữ nguyên và hệ thống thông báo thiếu Hạt OCB kèm số còn thiếu
  - And nếu không tải được lịch sử thu chi, hệ thống hiển thị thông báo lỗi kèm nút thử lại, số Hạt OCB hiện tại vẫn hiển thị bình thường

- [ ] **US-22**: Với tư cách nhân viên, tôi muốn có kho chứa sản phẩm trước khi bán để tự chọn thời điểm bán.
  - **AC**:
  - Given nhân viên đã thu hoạch ít nhất một sản phẩm
  - When nhân viên mở kho
  - Then kho hiển thị từng loại sản phẩm đang có kèm số lượng và giá bán hiện tại của một đơn vị, và tổng giá trị ước tính nếu bán toàn bộ kho
  - And nhân viên chọn được số lượng bán của một loại sản phẩm trong khoảng từ 1 đến số lượng đang có của loại đó, kèm lựa chọn bán toàn bộ
  - And khi nhân viên xác nhận bán, số lượng loại đó trong kho giảm đúng bằng số lượng đã bán và số Hạt OCB tăng đúng bằng số lượng nhân giá bán một đơn vị, cộng phần thưởng do có ngựa nếu có
  - And màn hình bán hiển thị tách riêng số Hạt OCB từ giá bán gốc và số Hạt OCB từ phần thưởng ngựa trước khi nhân viên xác nhận, và giá bán được chốt theo giá tại thời điểm xác nhận
  - And nếu nhân viên nhập số lượng bằng 0, số âm, giá trị không phải số nguyên hoặc lớn hơn số lượng đang có, hệ thống từ chối thao tác bán, giữ nguyên kho và số Hạt OCB, kèm thông báo nêu rõ khoảng số lượng cho phép
  - And nếu kho không có sản phẩm nào, kho hiển thị trạng thái trống kèm hướng dẫn cách thu hoạch, và nút bán ở trạng thái không dùng được
  - And nếu số lượng thực tế trong kho đã thay đổi so với lúc mở kho (ví dụ đã bán ở thiết bị khác), hệ thống từ chối lượt bán đó, làm mới số lượng hiển thị và thông báo lý do, không tạo giao dịch nào
  - And mỗi lượt bán thành công tạo đúng một bản ghi trong lịch sử thu chi nêu loại sản phẩm, số lượng và số Hạt OCB nhận được

- [ ] **US-23**: Với tư cách nhân viên, tôi muốn sản phẩm vẫn tích lũy khi tôi không mở app để tôi quay lại là có thứ để gom.
  - **AC**:
  - Given nhân viên rời khỏi ứng dụng khi vật nuôi và cây đang trong trạng thái tạo sản phẩm
  - When nhân viên mở lại ứng dụng
  - Then hệ thống tính lượng sản phẩm đã tích lũy trong khoảng thời gian vắng mặt và hiển thị bảng tổng kết liệt kê từng loại sản phẩm kèm số lượng đang chờ thu hoạch, cùng độ dài khoảng thời gian vắng mặt được tính
  - And lượng tích lũy của mỗi vật nuôi và của mỗi cây bị giới hạn ở một mức trần theo cấu hình, tính riêng cho từng vật nuôi và từng cây, không cộng dồn vượt trần dù thời gian vắng mặt dài hơn
  - And nếu một vật nuôi hoặc một cây đã đạt mức trần tích lũy, bảng tổng kết ghi rõ đối tượng đó đã đạt trần và thời gian vắng mặt vượt trần không tạo thêm sản phẩm
  - And vật nuôi có độ no bằng 0 trong khoảng thời gian vắng mặt không tích lũy sản phẩm cho phần thời gian kể từ lúc độ no về 0, chỉ phần thời gian trước đó được tính
  - And cây ở trạng thái thiếu nước trong khoảng thời gian vắng mặt không tiến triển sinh trưởng cho phần thời gian thiếu nước, trừ khoảng thời gian có mưa
  - And nếu thời gian vắng mặt ngắn hơn một chu kỳ tạo sản phẩm của mọi vật nuôi và mọi cây, hệ thống không hiển thị bảng tổng kết và vào thẳng nông trại
  - And nếu khoảng thời gian vắng mặt tính ra là số âm hoặc bằng 0 do sai lệch đồng hồ thiết bị, hệ thống coi lượng tích lũy bằng 0, không trừ tiến trình đã có và không tạo sản phẩm
  - And sản phẩm tích lũy chỉ vào kho sau khi nhân viên thực hiện thu hoạch, và bảng tổng kết cho phép thu hoạch toàn bộ bằng một thao tác duy nhất

- [ ] **US-24**: Với tư cách nhân viên, tôi muốn mở rộng diện tích nông trại bằng Hạt OCB để có mục tiêu dài hạn.
  - **AC**:
  - Given nhân viên có số Hạt OCB lớn hơn hoặc bằng giá mở rộng của vùng đất kế tiếp
  - When nhân viên chọn mở rộng một vùng đất đang bị khoá và xác nhận
  - Then vùng đất đó chuyển sang trạng thái đã mở, số Hạt OCB bị trừ đúng bằng giá mở rộng của vùng đó, và toàn bộ ô đất mới ở trạng thái trống, sẵn sàng để đặt vật nuôi, trồng cây hoặc đặt vật phẩm trang trí ngay trong cùng lượt chơi
  - And giá mở rộng của vùng sau luôn lớn hơn giá của vùng liền trước theo bảng giá cấu hình, và giá áp dụng là giá hiển thị tại thời điểm nhân viên xác nhận
  - And mỗi vùng đất chưa mở hiển thị rõ trạng thái khoá kèm giá mở của chính vùng đó, kể cả khi nhân viên chưa đủ Hạt OCB
  - And các vùng đất chỉ được mở theo thứ tự kề với phần nông trại đã mở: nếu nhân viên chọn một vùng chưa kề vùng đã mở, hệ thống từ chối, giữ nguyên số Hạt OCB và nêu rõ vùng cần mở trước
  - And nếu số Hạt OCB nhỏ hơn giá mở rộng, hệ thống từ chối thao tác trước khi trừ, số dư giữ nguyên bằng giá trị cũ, kèm thông báo nêu số Hạt OCB còn thiếu và gợi ý cách kiếm thêm
  - And khi toàn bộ vùng đất theo cấu hình đã được mở, khu vực mở rộng hiển thị trạng thái đã mở hết và không còn thao tác mở rộng nào khả dụng
  - And mỗi lượt mở rộng thành công tạo đúng một bản ghi trong lịch sử thu chi nêu vùng đất đã mở và số Hạt OCB đã trừ, và một vùng đất đã mở không bị trừ tiền lần thứ hai
  - And khi thao tác mở rộng thất bại vì lỗi lưu trạng thái, vùng đất giữ nguyên trạng thái khoá và số Hạt OCB không bị trừ, kèm thông báo lỗi và nút thử lại

#### F. Check-in hàng ngày

- [ ] **US-25**: Với tư cách nhân viên, tôi muốn nhận Hạt OCB khi check-in hàng ngày và giữ chuỗi ngày liên tiếp để có động lực ghé nông trại mỗi ngày.
  - **AC**:
  - Given nhân viên đã đăng nhập và chưa nhận thưởng check-in trong ngày hôm nay, với ranh giới ngày được tính theo 00:00 giờ Việt Nam (UTC+7)
  - When nhân viên mở nông trại
  - Then hệ thống hiển thị hộp thưởng check-in gồm số Hạt OCB sẽ nhận, số ngày của chuỗi hiện tại và nút nhận thưởng
  - And khi nhân viên bấm nhận, số Hạt OCB theo cấu hình được cộng vào số dư, số dư hiển thị cập nhật ngay trong cùng lượt xem và hộp thưởng đóng lại
  - And chuỗi ngày liên tiếp tăng thêm 1 nếu ngày check-in gần nhất đúng là ngày hôm qua
  - And chuỗi ngày liên tiếp được đặt lại về 1 nếu đây là lần check-in đầu tiên, hoặc nếu ngày check-in gần nhất cách ngày hôm nay từ 2 ngày trở lên
  - And tại đúng các mốc chuỗi 3, 7, 14 và 30 ngày, nhân viên nhận thêm phần thưởng mốc theo cấu hình, và mỗi lần chuỗi đạt một mốc thì phần thưởng mốc đó chỉ được cộng một lần
  - And sau khi chuỗi vượt mốc cao nhất là 30 ngày, chuỗi tiếp tục tăng không giới hạn và phần thưởng của mốc 30 được cộng lại mỗi khi chuỗi đạt một bội số của 30 ngày
  - And nếu nhân viên mở lại nông trại sau khi đã nhận thưởng trong ngày, hệ thống không hiển thị hộp thưởng mà hiển thị trạng thái đã check-in kèm thời điểm làm mới là 00:00 giờ Việt Nam (UTC+7) của ngày kế tiếp
  - And nếu nhân viên thực hiện thao tác nhận thưởng lần thứ hai trong cùng một ngày, hệ thống từ chối kèm thông báo đã check-in trong ngày, không cộng thêm Hạt OCB và không thay đổi chuỗi
  - And nếu thao tác nhận thưởng thất bại, hệ thống giữ nguyên số Hạt OCB và chuỗi ngày như trước thao tác, hiển thị thông báo lỗi và cho phép nhân viên thử lại trong cùng ngày
  - And nhân viên thực hiện được toàn bộ luồng check-in trên thiết bị di động với cùng kết quả về Hạt OCB và chuỗi ngày

#### G. Ghé thăm và giúp đỡ đồng nghiệp

- [ ] **US-26**: Với tư cách nhân viên, tôi muốn ghé thăm nông trại đồng nghiệp để xem họ xây gì và cây OCB của họ to cỡ nào.
  - **AC**:
  - Given nhân viên đã đăng nhập và đang ở trong ứng dụng
  - When nhân viên mở danh sách nông trại và chọn một đồng nghiệp
  - Then nông trại của đồng nghiệp được hiển thị ở chế độ chỉ xem kèm tên, phòng ban và thâm niên của chủ nông trại
  - And nhãn cho biết đang ở chế độ ghé thăm hiển thị liên tục trong suốt thời gian xem, cùng lối thoát để quay lại nông trại của chính nhân viên
  - And ở chế độ ghé thăm, các hành động mua, bán, di chuyển và xoá vật phẩm của chủ nông trại đều ở trạng thái không khả dụng; nếu nhân viên vẫn cố thực hiện một trong các hành động đó, hệ thống từ chối kèm thông báo chỉ được xem, và nông trại của chủ giữ nguyên nguyên trạng
  - And nhân viên tìm đồng nghiệp bằng cách nhập tối thiểu 2 ký tự của tên, kết quả khớp theo một phần của tên và không phân biệt chữ hoa chữ thường
  - And nếu không có đồng nghiệp nào khớp từ khoá, danh sách không hiển thị bản ghi nào và hệ thống hiển thị trạng thái trống kèm gợi ý đổi từ khoá
  - And nhân viên lọc danh sách theo phòng ban; khi chọn một phòng ban, danh sách chỉ hiển thị đồng nghiệp thuộc phòng ban đó, và bộ lọc phòng ban kết hợp được với tìm theo tên
  - And nhân viên đang đăng nhập không xuất hiện trong danh sách ghé thăm, và việc xem nông trại của chính mình không được tính là một lượt ghé thăm
  - And nếu đồng nghiệp được chọn chưa từng mở OCB Farm nên chưa có nông trại, hệ thống hiển thị thông báo đồng nghiệp chưa có nông trại, không hiển thị khung nông trại và không cho phép hành động giúp đỡ
  - And số lượt ghé thăm trong ngày không bị giới hạn, nhân viên xem lại cùng một nông trại nhiều lần trong ngày đều được phép

- [ ] **US-27**: Với tư cách nhân viên, tôi muốn tưới cây và cho ăn giúp đồng nghiệp để cả hai đều được thưởng, tạo sự tương tác trong nội bộ.
  - **AC**:
  - Given nhân viên đang ghé thăm nông trại của đồng nghiệp, còn lượt giúp trong ngày, chưa giúp nông trại đó trong ngày hôm nay, và nông trại đó có ít nhất một cây thiếu nước hoặc ít nhất một vật nuôi đang đói
  - When nhân viên bấm giúp tưới cây hoặc giúp cho ăn
  - Then cây được đưa về trạng thái đủ nước hoặc vật nuôi được đưa độ no lên mức tối đa, và cả người giúp lẫn chủ nông trại mỗi bên được cộng Hạt OCB theo cấu hình đúng một lần cho lượt giúp đó
  - And sau khi giúp thành công, số lượt giúp còn lại của người giúp giảm đi 1 và hành động giúp đối với nông trại đó chuyển sang trạng thái không khả dụng cho tới mốc làm mới lượt
  - And nếu nông trại đang ghé thăm không có cây thiếu nước và không có vật nuôi đang đói, hành động giúp ở trạng thái không khả dụng kèm chú thích hiện không có gì cần giúp
  - And một nhân viên có số lượt giúp tối đa mỗi ngày theo cấu hình, và mỗi nông trại chỉ được cùng một người giúp tối đa một lần trong một ngày
  - And khi đã dùng hết lượt, hệ thống hiển thị số lượt còn lại bằng 0 và thời điểm làm mới là 00:00 giờ Việt Nam (UTC+7) của ngày kế tiếp; mọi thao tác giúp sau đó bị từ chối, không cộng Hạt OCB cho bên nào và không thay đổi trạng thái nông trại
  - And nếu hai đồng nghiệp cùng bấm giúp một nông trại tại gần như cùng thời điểm, cả hai đều được ghi nhận là người đã giúp, mỗi người giúp được thưởng một lần và chủ nông trại được thưởng một lần cho mỗi lượt giúp hợp lệ, đồng thời trạng thái nước của cây và độ no của vật nuôi không vượt quá mức tối đa
  - And nếu thao tác giúp thất bại, hệ thống không trừ lượt giúp, không cộng Hạt OCB cho bất kỳ bên nào, không thay đổi trạng thái nông trại, hiển thị thông báo lỗi và cho phép thử lại
  - And chủ nông trại thấy danh sách người đã giúp mình ở lần truy cập tiếp theo, mỗi mục gồm tên người giúp, loại hành động đã giúp và thời điểm giúp
  - And các mục trong danh sách người đã giúp được đánh dấu là mới cho tới khi chủ nông trại mở danh sách, sau khi mở thì dấu mới được xoá và không xuất hiện lại ở các lần truy cập sau

#### H. Bảng xếp hạng

- [ ] **US-28**: Với tư cách nhân viên, tôi muốn xem bảng xếp hạng để so sánh với đồng nghiệp và có thêm động lực.
  - **AC**:
  - Given nhân viên đã có nông trại và mở bảng xếp hạng
  - When nhân viên chọn một trong ba tiêu chí xếp hạng
  - Then hệ thống hiển thị danh sách xếp hạng theo tiêu chí đó, sắp xếp giảm dần theo giá trị, gồm tối đa 20 vị trí đầu, mỗi dòng có thứ hạng, tên nhân viên, phòng ban và giá trị của tiêu chí
  - And ba tiêu chí được hỗ trợ là thâm niên Cây OCB (tính theo số tháng thâm niên), tổng tài sản nông trại, và chuỗi ngày check-in hiện tại (tính theo số ngày liên tiếp)
  - And tổng tài sản nông trại được định nghĩa là tổng của: số Hạt OCB đang có, giá bán của toàn bộ sản phẩm đang ở trong kho, và giá mua của toàn bộ vật nuôi, cây trồng và vùng đất đã mở khoá
  - And khi mở bảng xếp hạng lần đầu trong một phiên, tiêu chí mặc định được chọn là thâm niên Cây OCB
  - And nếu hai nhân viên có cùng giá trị tiêu chí, người có thâm niên dài hơn được xếp trước; nếu thâm niên cũng bằng nhau, xếp theo thứ tự chữ cái của tên
  - And số liệu xếp hạng được làm mới theo chu kỳ theo cấu hình, và hệ thống hiển thị thời điểm cập nhật gần nhất của danh sách
  - And vị trí và giá trị của bản thân nhân viên luôn được hiển thị và được đánh dấu khác biệt so với các dòng còn lại, kể cả khi nhân viên không nằm trong 20 vị trí đầu
  - And nhân viên chưa có nông trại không xuất hiện trong bảng xếp hạng ở bất kỳ tiêu chí nào
  - And nếu số nông trại hợp lệ ít hơn 20, hệ thống chỉ hiển thị đúng số vị trí có dữ liệu, không hiển thị dòng trống hay dòng giữ chỗ
  - And nhân viên lọc được bảng xếp hạng theo phòng ban để xem thi đua trong phòng, và khi phòng ban chỉ có một nhân viên hợp lệ thì hiển thị đúng một dòng ở vị trí thứ nhất thay vì trạng thái rỗng
  - And mỗi dòng xếp hạng chỉ hiển thị tên, phòng ban và giá trị tiêu chí, không hiển thị thêm thông tin cá nhân nào khác
  - And nếu không lấy được dữ liệu xếp hạng, hệ thống hiển thị thông báo lỗi kèm tuỳ chọn thử lại và không hiển thị danh sách một phần

#### I. Thành tựu và huy hiệu

- [ ] **US-29**: Với tư cách nhân viên, tôi muốn nhận huy hiệu khi đạt cột mốc để có cảm giác tiến bộ và sưu tầm.
  - **AC**:
  - Given nhân viên đang chơi và hệ thống theo dõi tiến trình của từng thành tựu
  - When tiến trình của nhân viên đạt hoặc vượt điều kiện của một thành tựu
  - Then ngay tại thời điểm điều kiện được đáp ứng, hệ thống ghi nhận thành tựu đó là đã đạt, mở huy hiệu tương ứng, cộng số Hạt OCB thưởng theo cấu hình và hiển thị thông báo nêu tên thành tựu cùng số Hạt OCB đã cộng
  - And danh sách thành tựu bao gồm tối thiểu: nuôi đủ 6 loài, thu hoạch đạt mốc số lần, check-in liên tiếp đạt mốc, giúp đồng nghiệp đạt mốc, Cây OCB đạt các mốc thâm niên, mở rộng hết các vùng đất
  - And mỗi thành tựu chỉ được trao và chỉ được thưởng Hạt OCB một lần, kể cả khi điều kiện được đáp ứng lại nhiều lần sau đó
  - And nếu nhiều thành tựu được đạt cùng lúc, hệ thống thông báo lần lượt từng thành tựu và cộng thưởng cho từng thành tựu
  - And nếu điều kiện của một thành tựu được đáp ứng nhờ sản phẩm hoặc tiến trình tích lũy trong lúc nhân viên offline, thành tựu vẫn được trao ngay khi hệ thống đối chiếu xong tiến trình ở lần truy cập tiếp theo
  - And thành tựu đã đạt và Hạt OCB đã thưởng không bị thu hồi khi thâm niên hoặc tiến trình sau đó bị giảm, kể cả khi quản trị viên sửa lại ngày vào làm
  - And nhân viên xem được toàn bộ danh sách thành tựu, trong đó thành tựu đã đạt hiển thị ngày đạt, thành tựu chưa đạt hiển thị điều kiện kèm tiến trình hiện tại so với mốc cần đạt
  - And huy hiệu đã đạt hiển thị trên trang nông trại, số huy hiệu hiển thị đồng thời tối đa theo cấu hình, và nhân viên chọn được huy hiệu nào được hiển thị khi số huy hiệu đã đạt vượt giới hạn này
  - And đồng nghiệp ở chế độ ghé thăm chỉ thấy các huy hiệu đã đạt được chọn hiển thị, không thấy thành tựu chưa đạt cũng như tiến trình của chủ nông trại
  - And nếu không cộng được Hạt OCB thưởng, hệ thống vẫn giữ trạng thái đã đạt của thành tựu, hiển thị thông báo lỗi về phần thưởng và cộng bù phần thưởng còn thiếu ở lần truy cập tiếp theo

#### J. Môi trường và không khí

- [ ] **US-30**: Với tư cách nhân viên, tôi muốn nông trại thay đổi ánh sáng theo giờ thật để cảm giác sống động và gần với thực tế.
  - **AC**:
  - Given nhân viên đang xem nông trại và chưa khoá cảnh ở một buổi cố định
  - When thời gian thực tại Việt Nam (UTC+7) bước qua ranh giới giữa hai buổi trong ngày theo các khoảng giờ đã cấu hình cho sáng, trưa, chiều và đêm
  - Then trong vòng tối đa theo cấu hình kể từ thời điểm bước qua ranh giới, ánh sáng, màu trời và bóng đổ của nông trại chuyển sang bộ hiển thị của buổi mới mà không cần nhân viên tải lại trang
  - And bốn khoảng giờ sáng, trưa, chiều, đêm phủ kín 24 giờ và không chồng lấn nhau, thời điểm ranh giới thuộc về buổi bắt đầu
  - And khi nông trại đang ở buổi đêm, mọi vật phẩm trang trí là nguồn sáng đã đặt trong nông trại được bật, các vật phẩm trang trí không phải nguồn sáng không thay đổi hiển thị
  - And khi nông trại chuyển từ buổi đêm sang buổi khác, các nguồn sáng trang trí được tắt
  - And nhân viên bật tuỳ chọn khoá cảnh và chọn một trong bốn buổi, nông trại giữ nguyên hiển thị của buổi đã chọn cho tới khi nhân viên tắt tuỳ chọn này
  - And lựa chọn khoá cảnh được lưu riêng cho từng nhân viên, giữ nguyên sau khi đăng xuất, tải lại trang hoặc đổi thiết bị
  - And khi khoá cảnh đang bật, thời tiết, tốc độ sinh trưởng của cây, độ no của vật nuôi và mọi phần thưởng không bị thay đổi
  - And khi nhân viên tắt khoá cảnh, nông trại trở về hiển thị đúng buổi theo giờ thực tại Việt Nam (UTC+7) trong vòng tối đa theo cấu hình

- [ ] **US-31**: Với tư cách nhân viên, tôi muốn có thời tiết thay đổi và mưa tự tưới cây để nông trại đỡ đơn điệu và việc chăm sóc có yếu tố may mắn.
  - **AC**:
  - Given nhân viên đang xem nông trại
  - When chu kỳ thời tiết theo cấu hình kết thúc và trạng thái thời tiết mới được xác định
  - Then nông trại thể hiện đúng một trong ba trạng thái nắng, nhiều mây hoặc mưa kèm hiệu ứng hình ảnh tương ứng, và trạng thái hiện tại được hiển thị rõ cho nhân viên
  - And tại cùng một thời điểm, mọi nông trại của mọi nhân viên đều có cùng một trạng thái thời tiết, với cùng thời điểm bắt đầu và kết thúc chu kỳ
  - And khi trời chuyển sang mưa, toàn bộ cây đang ở trạng thái thiếu nước trong nông trại được chuyển sang trạng thái đủ nước mà không trừ lượt tưới trong ngày của nhân viên và không tiêu tốn Hạt OCB
  - And mưa không làm thay đổi thời gian còn lại của giai đoạn sinh trưởng hiện tại của cây so với khi nhân viên tự tưới
  - And mưa không tạo thêm phần thưởng tưới cây và không tính vào chỉ tiêu thành tựu liên quan đến số lần nhân viên tưới cây
  - And nếu trong khoảng thời gian nhân viên vắng mặt có ít nhất một chu kỳ mưa, các cây trong nông trại được tính là đủ nước cho toàn bộ các chu kỳ mưa đó khi nhân viên quay lại
  - And khi nhân viên ghé thăm nông trại của đồng nghiệp, trạng thái thời tiết và buổi trong ngày hiển thị giống hệt nông trại của chính nhân viên đó tại cùng thời điểm
  - And nếu không xác định được trạng thái thời tiết mới, nông trại giữ nguyên trạng thái thời tiết của chu kỳ trước và không có cây nào được chuyển sang trạng thái đủ nước

- [ ] **US-32**: Với tư cách nhân viên, tôi muốn có nhạc nền và âm thanh nông trại kèm nút tắt để không làm ồn văn phòng.
  - **AC**:
  - Given nhân viên mở nông trại lần đầu và chưa từng thiết lập tuỳ chọn âm thanh
  - When nông trại được tải xong
  - Then cả nhạc nền và hiệu ứng âm thanh đều ở trạng thái tắt, không có bất kỳ âm thanh nào được phát
  - And nhân viên bật hoặc tắt độc lập hai tuỳ chọn nhạc nền và hiệu ứng âm thanh, thao tác có hiệu lực ngay trong vòng tối đa theo cấu hình
  - And hai tuỳ chọn này được lưu riêng biệt cho từng nhân viên và giữ nguyên sau khi tải lại trang, đăng xuất rồi đăng nhập lại, hoặc mở trên thiết bị khác
  - And nếu tuỳ chọn đang ở trạng thái tắt, sau khi tải lại trang nông trại vẫn không phát âm thanh
  - And khi hiệu ứng âm thanh đang bật, mỗi hành động cho ăn, tưới cây và thu hoạch phát âm thanh phản hồi tương ứng với loài vật nuôi hoặc loại cây được tác động
  - And khi hiệu ứng âm thanh đang tắt, các hành động cho ăn, tưới cây và thu hoạch vẫn thực hiện thành công và cho kết quả giống như khi âm thanh đang bật
  - And nếu không tải được tệp âm thanh, hành động của nhân viên vẫn hoàn tất và hệ thống hiển thị thông báo cho biết âm thanh hiện không khả dụng

- [ ] **US-33**: Với tư cách nhân viên, tôi muốn nông trại đổi không khí theo mùa và dịp lễ để mỗi dịp vào app đều có cái mới.
  - **AC**:
  - Given ngày hiện tại theo giờ Việt Nam (UTC+7) nằm trong khoảng ngày bắt đầu và ngày kết thúc của một dịp lễ hoặc mùa đã được cấu hình
  - When nhân viên mở nông trại
  - Then nông trại hiển thị chủ đề tương ứng của dịp đó, ví dụ Tết có hoa mai hoa đào, Giáng sinh có tuyết và trang trí, và tên dịp đang diễn ra được hiển thị rõ cho nhân viên
  - And mỗi dịp có ngày bắt đầu, ngày kết thúc và mức ưu tiên cấu hình được, nếu nhiều dịp cùng bao phủ ngày hiện tại thì chỉ áp dụng dịp có mức ưu tiên cao nhất
  - And chủ đề tự động trở về mặc định trong lần mở nông trại đầu tiên sau khi ngày kết thúc của dịp đã qua, không cần quản trị viên can thiệp
  - And trong thời gian diễn ra dịp, cửa hàng bán tối thiểu một vật phẩm trang trí giới hạn theo dịp, có nhãn cho biết vật phẩm chỉ bán trong dịp này
  - And sau khi dịp kết thúc, vật phẩm trang trí giới hạn đã mua vẫn ở lại nông trại và vẫn di chuyển, xoay, bán lại được, nhưng không còn xuất hiện để mua trong cửa hàng
  - And chủ đề theo dịp không làm thay đổi giá mua, giá bán, thời gian sinh trưởng của cây, độ no của vật nuôi hay số Hạt OCB của nhân viên
  - And nếu ngày hiện tại không nằm trong dịp nào đã cấu hình, nông trại hiển thị chủ đề mặc định

#### K. Trang trí

- [ ] **US-34**: Với tư cách nhân viên, tôi muốn mua và đặt vật phẩm trang trí để nông trại mang cá tính riêng.
  - **AC**:
  - Given nhân viên đang mở cửa hàng trang trí trong nông trại của mình và số Hạt OCB hiện có lớn hơn hoặc bằng giá của vật phẩm được chọn
  - When nhân viên chọn một vật phẩm trang trí và chọn một ô trống hợp lệ trong vùng đất đã mở
  - Then vật phẩm xuất hiện tại ô đó, số Hạt OCB giảm đúng bằng giá vật phẩm, và giao dịch được ghi vào lịch sử thu chi
  - And danh mục trang trí bao gồm tối thiểu sáu nhóm: hàng rào, đường đi, đèn, ghế, giếng nước và bảng tên nông trại
  - And nếu số Hạt OCB nhỏ hơn giá vật phẩm, hệ thống từ chối giao dịch, hiển thị thông báo nêu rõ còn thiếu bao nhiêu Hạt OCB và không trừ Hạt OCB
  - And nếu ô đích đã có vật nuôi, cây, vật phẩm trang trí khác hoặc thuộc vùng đất chưa mở, hệ thống từ chối đặt, nêu rõ lý do, không trừ Hạt OCB và không thêm vật phẩm vào nông trại
  - And nếu tổng số vật phẩm trang trí trong nông trại đã đạt giới hạn theo cấu hình, hệ thống từ chối mua thêm và hiển thị thông báo nêu rõ giới hạn
  - And nhân viên di chuyển một vật phẩm trang trí sang ô trống hợp lệ khác mà không tốn Hạt OCB, nếu ô đích không hợp lệ thì vật phẩm giữ nguyên vị trí cũ kèm thông báo lý do
  - And nhân viên xoay vật phẩm trang trí lần lượt qua bốn hướng và hướng đã chọn được giữ nguyên sau khi tải lại nông trại
  - And khi nhân viên bán lại một vật phẩm trang trí và xác nhận, vật phẩm bị xoá khỏi ô đang đặt và nhân viên được hoàn một tỷ lệ theo cấu hình so với giá mua, làm tròn theo quy tắc cấu hình
  - And mọi thao tác mua, di chuyển, xoay và bán lại vật phẩm trang trí chỉ thực hiện được trong nông trại của chính nhân viên, không thực hiện được ở chế độ ghé thăm

- [ ] **US-35**: Với tư cách nhân viên, tôi muốn đặt tên cho nông trại của mình để đồng nghiệp dễ nhận ra.
  - **AC**:
  - Given nhân viên đang ở trong nông trại của mình và mở chức năng đặt tên nông trại
  - When nhân viên nhập tên mới và xác nhận lưu
  - Then tên mới hiển thị trên bảng tên nông trại và trong danh sách nông trại mà đồng nghiệp xem được, trong vòng tối đa theo cấu hình
  - And tên nông trại có độ dài tối thiểu 1 ký tự và tối đa số ký tự theo cấu hình, khoảng trắng ở đầu và cuối được loại bỏ trước khi kiểm tra
  - And nếu tên vượt quá độ dài tối đa, hệ thống từ chối lưu, hiển thị thông báo nêu rõ giới hạn độ dài và giữ lại nội dung nhân viên đã nhập để sửa tiếp
  - And nếu tên chứa nội dung thuộc danh sách từ ngữ bị cấm, hệ thống từ chối lưu, hiển thị thông báo cho biết tên chứa nội dung không được phép và giữ lại nội dung đã nhập để sửa tiếp
  - And nếu tên để trống hoặc chỉ gồm khoảng trắng, hệ thống từ chối lưu, hiển thị thông báo yêu cầu nhập tên và giữ nguyên tên đang dùng
  - And khi bị từ chối, tên nông trại đang dùng không thay đổi ở bảng tên nông trại và trong danh sách nông trại
  - And nhân viên chưa từng đặt tên thì nông trại hiển thị tên mặc định theo cấu hình gắn với nhân viên đó, và tên mặc định này cũng tuân thủ giới hạn độ dài
  - And số lần đổi tên trong một khoảng thời gian bị giới hạn theo cấu hình, nếu vượt quá thì hệ thống từ chối và thông báo thời điểm nhân viên được đổi tên lần tới

#### L. Hiệu năng và thiết bị

- [ ] **US-36**: Với tư cách nhân viên dùng laptop công ty cấu hình thấp, tôi muốn chọn được mức chất lượng đồ hoạ để nông trại vẫn chạy mượt.
  - **AC**:
  - Given nhân viên mở nông trại lần đầu trên một thiết bị
  - When nông trại được tải
  - Then hệ thống tự chọn một trong ba mức chất lượng Thấp, Vừa hoặc Cao dựa trên khả năng của thiết bị, hiển thị mức đã chọn kèm lý do tự chọn
  - And nếu không xác định được khả năng của thiết bị, hệ thống dùng mức Thấp và nêu rõ lý do là không xác định được khả năng thiết bị
  - And nhân viên đổi mức chất lượng bất kỳ lúc nào; lựa chọn thủ công ghi đè kết quả tự chọn và được ghi nhớ cho mọi thiết bị mà nhân viên đó đăng nhập
  - And khi đổi mức chất lượng, hệ thống áp dụng ngay trong phiên đang dùng, không mất trạng thái nông trại và không làm gián đoạn hay đặt lại các bộ đếm thời gian đang chạy
  - And khi ở mức Thấp, hệ thống giảm bóng đổ, hiệu ứng hạt và độ chi tiết mô hình 3D để ưu tiên độ mượt
  - And nếu độ mượt duy trì dưới ngưỡng độ mượt theo cấu hình liên tục trong khoảng thời gian theo cấu hình, hệ thống hiển thị gợi ý hạ một mức chất lượng kèm lựa chọn đồng ý và lựa chọn bỏ qua
  - And nếu nhân viên bỏ qua gợi ý hạ mức chất lượng đủ số lần theo cấu hình, hệ thống không hiển thị lại gợi ý đó trong khoảng thời gian theo cấu hình

- [ ] **US-37**: Với tư cách nhân viên, tôi muốn số lượng vật phẩm trong nông trại bị giới hạn hợp lý để nông trại không bị chậm.
  - **AC**:
  - Given nông trại đã đạt số lượng vật nuôi tối đa cho phép
  - When nhân viên thử mua thêm vật nuôi
  - Then hệ thống từ chối giao dịch, không trừ Hạt OCB và thông báo đã đạt giới hạn kèm số lượng hiện tại và số lượng tối đa hiện hành
  - And giới hạn được kiểm tra riêng cho từng nhóm vật nuôi, cây trồng và vật phẩm trang trí; đạt giới hạn ở một nhóm không chặn việc mua ở hai nhóm còn lại
  - And màn hình nông trại hiển thị số lượng hiện tại so với giới hạn cho từng nhóm
  - And quản trị viên cấu hình được giới hạn của từng nhóm, giá trị mới có hiệu lực từ lần tải nông trại tiếp theo của nhân viên
  - And nếu quản trị viên hạ giới hạn xuống thấp hơn số lượng nhân viên đang sở hữu, hệ thống giữ nguyên toàn bộ vật phẩm đã sở hữu, không xoá và không bán tự động, chỉ chặn mua thêm ở nhóm đó cho tới khi số lượng xuống dưới giới hạn mới

- [ ] **US-38**: Với tư cách nhân viên dùng điện thoại, tôi muốn vẫn chăm sóc được nông trại ở mức hiệu ứng giảm để tranh thủ lúc di chuyển.
  - **AC**:
  - Given nhân viên mở nông trại trên điện thoại
  - When nông trại được tải
  - Then hệ thống dùng mức chất lượng Thấp và bố cục điều khiển dành cho cảm ứng
  - And nhân viên thực hiện được các hành động cốt lõi gồm check-in, cho ăn, tưới nước, thu hoạch và bán, tất cả đều truy cập được mà không cần cuộn ngang
  - And mỗi điều khiển của hành động cốt lõi có vùng chạm không nhỏ hơn kích thước tối thiểu theo cấu hình và không bị điều khiển khác che phủ
  - And nhân viên xoay, phóng to và di chuyển góc nhìn bằng cử chỉ cảm ứng; các cử chỉ này chỉ tác động lên khung hình nông trại và không làm trang cuộn theo
  - And nhân viên vẫn đổi được mức chất lượng thủ công trên điện thoại, kể cả chọn mức cao hơn Thấp, và lựa chọn đó được ghi nhớ

- [ ] **US-39**: Với tư cách nhân viên, tôi muốn thấy tiến trình tải nông trại để biết app đang chạy chứ không bị treo.
  - **AC**:
  - Given nhân viên mở OCB Farm
  - When các mô hình 3D và dữ liệu nông trại đang được tải
  - Then hệ thống hiển thị tiến trình tải theo phần trăm từ 0 đến 100 kèm nhãn hạng mục đang tải
  - And giá trị phần trăm chỉ tăng hoặc giữ nguyên, không bao giờ giảm trong cùng một lần tải
  - And nếu việc tải không hoàn tất trong thời gian chờ tối đa theo cấu hình, hệ thống dừng chờ và hiển thị thông báo lỗi nêu nguyên nhân kèm lựa chọn thử lại
  - And nếu một hoặc một số mô hình 3D không tải được, hệ thống hiển thị hình khối thay thế tại đúng vị trí, nông trại vẫn dùng được, và hiển thị thông báo không chặn liệt kê các hạng mục tải lỗi
  - And khi nhân viên chọn thử lại, hệ thống chỉ tải lại các hạng mục đã lỗi và giữ nguyên phần đã tải thành công

- [ ] **US-40**: Với tư cách nhân viên, tôi muốn tiến trình nông trại được lưu chắc chắn để không mất công chăm sóc khi đóng tab hoặc mất mạng.
  - **AC**:
  - Given nhân viên thực hiện một hành động làm thay đổi nông trại
  - When hành động hoàn tất
  - Then trạng thái nông trại được lưu lại và nhân viên thấy đúng trạng thái đó khi mở lại trên thiết bị khác mà không cần thao tác bổ sung
  - And nếu việc lưu thất bại, hệ thống hiển thị thông báo nêu rõ chưa lưu được, giữ hành động ở trạng thái chờ và cho phép thử lại
  - And nếu nhân viên thao tác khi mất kết nối, hệ thống hiển thị trạng thái mất kết nối, và khi có kết nối lại thì hoặc áp dụng đầy đủ các thao tác đang chờ, hoặc huỷ chúng kèm giải thích rõ thao tác nào bị huỷ và vì sao
  - And nếu cùng một nông trại được mở ở hai phiên cùng lúc, hệ thống giữ một trạng thái nhất quán và từ chối thao tác xung đột đến sau kèm thông báo yêu cầu tải lại nông trại
  - And sau khi tải lại, nhân viên thấy đúng trạng thái đã được lưu, không có hành động nào được áp dụng một phần

#### M. Chia sẻ

- [ ] **US-41**: Với tư cách nhân viên, tôi muốn chụp ảnh nông trại tải về để chia sẻ lên nhóm chat nội bộ.
  - **AC**:
  - Given nhân viên đang xem nông trại của mình ở một góc nhìn mong muốn
  - When nhân viên bấm chụp ảnh
  - Then hệ thống tạo một ảnh của khung hình hiện tại, có chèn tên nông trại, tên nhân viên và thâm niên tính đến thời điểm chụp
  - And ảnh được tải xuống thiết bị dưới dạng tệp hình ảnh với tên tệp chứa tên nông trại và ngày chụp
  - And ở chế độ ghé thăm, ảnh được chú thích rõ đây là nông trại của đồng nghiệp kèm tên chủ nông trại, hoặc chức năng chụp ảnh bị vô hiệu hoá kèm lý do
  - And nếu việc tạo ảnh hoặc tải ảnh về thất bại, hệ thống hiển thị thông báo lỗi kèm lựa chọn thử lại và giữ nguyên góc nhìn hiện tại

#### N. Quản trị

- [ ] **US-42**: Với tư cách admin, tôi muốn sửa ngày vào làm của nhân viên để cứu trường hợp nhân viên nhập sai.
  - **AC**:
  - Given admin đã đăng nhập với quyền quản trị, mở trang quản trị OCB Farm và tìm được nhân viên cần sửa bằng ô tìm kiếm theo tên hoặc theo phòng ban
  - When admin đổi ngày vào làm sang một ngày hợp lệ và xác nhận
  - Then thâm niên (số năm, số tháng) và mốc phát triển Cây OCB của nhân viên đó được tính lại theo ngày mới và hiển thị giá trị mới ngay trên trang quản trị, không cần tải lại trang
  - And hệ thống áp dụng đúng quy tắc hợp lệ như phía nhân viên: từ chối ngày sau ngày hiện tại theo giờ Việt Nam (UTC+7) và ngày trước năm thành lập OCB theo cấu hình, kèm thông báo nêu lý do và khoảng ngày được phép, giá trị cũ giữ nguyên
  - And sau khi admin xác nhận, ngày vào làm được đánh dấu là đã xác nhận bởi quản trị viên và nhân viên đó không còn tự sửa được ngày vào làm
  - And nếu ngày mới làm thâm niên giảm, mốc Cây OCB hạ xuống đúng mốc tương ứng, nhưng thành tựu và huy hiệu đã đạt cùng toàn bộ vật phẩm đang sở hữu được giữ nguyên
  - And hệ thống ghi một dòng lưu vết gồm tên người sửa, thời điểm sửa theo giờ Việt Nam (UTC+7), giá trị ngày vào làm trước và sau; dòng lưu vết không sửa được và không xoá được
  - And nhân viên đó thấy thông báo ngày vào làm đã được điều chỉnh, kèm giá trị trước và sau, ở lần truy cập OCB Farm tiếp theo
  - And nếu người truy cập không có quyền quản trị, hệ thống từ chối mở trang quản trị kèm thông báo không đủ quyền và không hiển thị bất kỳ dữ liệu nhân viên nào
  - And nếu không có nhân viên nào khớp từ khoá tìm kiếm, trang hiển thị trạng thái không có kết quả kèm gợi ý đổi từ khoá, thay vì để danh sách trống không giải thích

- [ ] **US-43**: Với tư cách admin, tôi muốn điều chỉnh số Hạt OCB của nhân viên để xử lý sự cố mất dữ liệu.
  - **AC**:
  - Given admin đã đăng nhập với quyền quản trị và đang xem thông tin nông trại của một nhân viên
  - When admin nhập một mức điều chỉnh Hạt OCB theo hướng tăng hoặc giảm, nhập lý do và xác nhận
  - Then số dư của nhân viên bằng đúng số dư trước đó cộng (hoặc trừ) mức điều chỉnh, và số dư mới hiển thị ngay trên trang quản trị
  - And đúng một bản ghi xuất hiện trong lịch sử thu chi của nhân viên đó, có nhãn do quản trị viên điều chỉnh, kèm thời điểm theo giờ Việt Nam (UTC+7), mức thay đổi và lý do
  - And hệ thống từ chối điều chỉnh nếu lý do để trống hoặc ngắn hơn độ dài tối thiểu theo cấu hình, kèm thông báo nêu yêu cầu độ dài; số dư không đổi
  - And hệ thống từ chối điều chỉnh giảm làm số dư sau điều chỉnh nhỏ hơn 0, kèm thông báo nêu số dư hiện tại và mức giảm tối đa cho phép; số dư không đổi
  - And hệ thống từ chối mức điều chỉnh bằng 0, không phải số nguyên, hoặc vượt hạn mức mỗi lần điều chỉnh theo cấu hình, kèm thông báo nêu khoảng cho phép
  - And nếu admin xác nhận nhiều lần cho cùng một lần nhập, chỉ một lần điều chỉnh được ghi nhận và lịch sử thu chi chỉ có một bản ghi tương ứng
  - And hệ thống ghi lưu vết gồm tên người điều chỉnh, thời điểm theo giờ Việt Nam (UTC+7), số dư trước và sau, lý do; dòng lưu vết không sửa được và không xoá được
  - And nếu người truy cập không có quyền quản trị, hệ thống từ chối chức năng điều chỉnh kèm thông báo không đủ quyền

- [ ] **US-44**: Với tư cách admin, tôi muốn đặt lại nông trại của một nhân viên về trạng thái ban đầu để xử lý trường hợp dữ liệu hỏng.
  - **AC**:
  - Given admin đã đăng nhập với quyền quản trị và đang xem thông tin nông trại của một nhân viên
  - When admin chọn đặt lại nông trại và xác nhận qua hai bước xác nhận liên tiếp
  - Then nông trại của nhân viên đó trở về trạng thái khởi tạo gồm một vùng đất khởi đầu, Cây OCB ở vị trí trung tâm, số Hạt OCB khởi điểm, kho trống và không còn vật nuôi, cây trồng hay vật phẩm trang trí đã đặt
  - And trước bước xác nhận cuối, hệ thống liệt kê rõ phần được giữ lại (ngày vào làm, thâm niên, mốc Cây OCB, thành tựu và huy hiệu đã đạt) và phần bị mất (vật nuôi, cây trồng, trang trí, sản phẩm trong kho, số Hạt OCB hiện có, chuỗi check-in)
  - And nếu admin huỷ ở bất kỳ bước xác nhận nào, nông trại và số dư của nhân viên không thay đổi
  - And sau khi đặt lại, ngày vào làm, thâm niên, mốc Cây OCB, thành tựu và huy hiệu đã đạt được giữ nguyên đúng giá trị trước khi đặt lại
  - And hệ thống ghi lưu vết gồm tên người đặt lại, thời điểm theo giờ Việt Nam (UTC+7) và trạng thái nông trại trước khi đặt lại; dòng lưu vết không sửa được và không xoá được
  - And nhân viên đó thấy thông báo nông trại đã được đặt lại kèm thời điểm đặt lại ở lần truy cập OCB Farm tiếp theo
  - And nếu người truy cập không có quyền quản trị, hệ thống từ chối chức năng đặt lại kèm thông báo không đủ quyền

- [ ] **US-45**: Với tư cách admin, tôi muốn cấu hình thông số cân bằng game mà không cần đổi code để tự điều chỉnh khi thấy game quá dễ hoặc quá khó.
  - **AC**:
  - Given admin đã đăng nhập với quyền quản trị và mở trang cấu hình OCB Farm
  - When admin thay đổi một thông số sang giá trị nằm trong khoảng hợp lệ và lưu
  - Then giá trị mới được áp dụng cho mọi lượt chơi diễn ra sau thời điểm lưu mà không cần phát hành lại ứng dụng
  - And các phần thưởng, giao dịch, tiến trình sinh trưởng và thành tựu đã phát sinh trước thời điểm lưu không bị tính lại theo giá trị mới
  - And các nhóm thông số cấu hình được gồm: giá mua và giá bán từng loại, thời gian tạo sản phẩm, tốc độ giảm độ no, thời gian sinh trưởng cây, phần thưởng check-in và mốc chuỗi, số lượt giúp mỗi ngày, giới hạn số vật phẩm, giá mở rộng đất
  - And mỗi thông số hiển thị ngay trên trang cấu hình đơn vị đo và khoảng giá trị hợp lệ gồm giá trị nhỏ nhất và giá trị lớn nhất theo cấu hình
  - And hệ thống từ chối giá trị ngoài khoảng hợp lệ, giá trị để trống hoặc sai định dạng, kèm thông báo nêu rõ khoảng cho phép của thông số đó; cấu hình đang áp dụng giữ nguyên
  - And hệ thống ghi lưu vết gồm tên người thay đổi, thời điểm theo giờ Việt Nam (UTC+7), tên thông số, giá trị trước và sau; dòng lưu vết không sửa được và không xoá được
  - And nếu người truy cập không có quyền quản trị, hệ thống từ chối mở trang cấu hình kèm thông báo không đủ quyền

- [ ] **US-46**: Với tư cách admin, tôi muốn xem thống kê sử dụng để biết app có được dùng và điều gì đang hấp dẫn.
  - **AC**:
  - Given admin đã đăng nhập với quyền quản trị và mở trang thống kê OCB Farm
  - When trang được tải
  - Then admin thấy tổng số nông trại, số nhân viên hoạt động trong 7 ngày và 30 ngày gần nhất, số lượt check-in theo từng ngày trong khoảng thời gian đang xét, loài vật nuôi và loại cây phổ biến nhất, và phân bố thâm niên Cây OCB
  - And trang nêu rõ mọi số liệu được tính theo giờ Việt Nam (UTC+7) và nêu rõ định nghĩa nhân viên hoạt động là nhân viên có ít nhất một lần mở nông trại trong khoảng thời gian xét
  - And trang hiển thị thời điểm cập nhật số liệu gần nhất theo giờ Việt Nam (UTC+7)
  - And admin lọc được thống kê theo phòng ban, và sau khi lọc, mọi số liệu trên trang chỉ tính trên nhân viên thuộc phòng ban đã chọn
  - And nếu chưa có nông trại nào hoặc không có dữ liệu khớp bộ lọc, trang hiển thị trạng thái trống nêu rõ chưa có dữ liệu thay vì để ô số liệu trống hoặc hiển thị biểu đồ rỗng không giải thích
  - And thống kê không hiển thị dữ liệu riêng của từng nhân viên ngoài tên và phòng ban
  - And nếu người truy cập không có quyền quản trị, hệ thống từ chối mở trang thống kê kèm thông báo không đủ quyền

---

### Nice-to-have

- [ ] **US-47**: Với tư cách nhân viên, tôi muốn nhận nhiệm vụ hàng ngày (ví dụ thu hoạch 5 lần, giúp 3 đồng nghiệp) để có mục tiêu ngắn hạn mỗi ngày.
  - **AC**:
  - Given nhân viên mở nông trại sau mốc 00:00 giờ Việt Nam (UTC+7) của một ngày mới
  - When danh sách nhiệm vụ hàng ngày hiển thị
  - Then hệ thống phát tối đa 3 nhiệm vụ cho ngày đó, mỗi nhiệm vụ nêu rõ mục tiêu đếm được, tiến độ hiện tại và phần thưởng Hạt OCB theo cấu hình
  - And tiến độ nhiệm vụ chỉ tính các hành động phát sinh sau thời điểm nhiệm vụ được phát, các hành động trước đó không được tính
  - And khi tiến độ đạt mục tiêu, nhân viên nhận thưởng đúng một lần cho mỗi nhiệm vụ, sau đó nhiệm vụ chuyển sang trạng thái đã nhận thưởng và không nhận thêm được
  - And nếu nhân viên bấm nhận thưởng khi tiến độ chưa đạt mục tiêu, hệ thống từ chối kèm thông báo nêu phần còn thiếu
  - And đúng 00:00 giờ Việt Nam, danh sách nhiệm vụ được làm mới và phần thưởng chưa nhận của ngày trước bị mất, hệ thống nêu rõ điều này trên danh sách nhiệm vụ

- [ ] **US-48**: Với tư cách nhân viên, tôi muốn gửi lời chúc hoặc biểu cảm lên nông trại đồng nghiệp để tăng tương tác.
  - **AC**:
  - Given nhân viên đang ghé thăm nông trại đồng nghiệp
  - When nhân viên gửi một biểu cảm hoặc một lời chúc ngắn
  - Then hệ thống ghi nhận nội dung và chủ nông trại thấy nội dung đó kèm tên người gửi và thời điểm gửi ở lần truy cập tiếp theo
  - And mỗi nhân viên chỉ gửi được tối đa số lượt theo cấu hình cho mỗi nông trại trong một ngày; khi vượt hạn mức, hệ thống từ chối kèm thông báo nêu hạn mức và thời điểm được gửi lại
  - And nếu nội dung vượt độ dài tối đa theo cấu hình hoặc chứa từ thuộc danh sách từ bị chặn, hệ thống từ chối gửi kèm thông báo lý do và giữ lại nội dung nhân viên đã nhập để sửa
  - And chủ nông trại xoá được từng lời chúc hoặc xoá toàn bộ danh sách, nội dung đã xoá không hiển thị lại

- [ ] **US-49**: Với tư cách nhân viên, tôi muốn nông trại có vật nuôi hiếm mở khoá theo thâm niên để thâm niên cao có đặc quyền riêng.
  - **AC**:
  - Given nhân viên đạt mốc thâm niên yêu cầu của một hoặc nhiều vật nuôi hiếm hoặc trang trí đặc biệt theo cấu hình
  - When nhân viên mở cửa hàng
  - Then các vật phẩm đã mở khoá hiển thị ở trạng thái mua được kèm nhãn nêu rõ mở khoá nhờ thâm niên và mốc thâm niên tương ứng
  - And các vật phẩm chưa mở khoá vẫn hiển thị nhưng ở trạng thái khoá kèm mốc thâm niên cần đạt và không cho mua
  - And vật phẩm đã sở hữu vẫn thuộc về nhân viên và giữ nguyên trên nông trại ngay cả khi sau đó admin điều chỉnh giảm thâm niên của nhân viên
  - And sau khi thâm niên bị giảm, các vật phẩm cùng nhóm chưa mua trở lại trạng thái khoá cho tới khi nhân viên đạt lại mốc

- [ ] **US-50**: Với tư cách nhân viên, tôi muốn nông trại chung theo phòng ban để cả phòng cùng xây dựng một nông trại.
  - **AC**:
  - Given nhân viên thuộc một phòng ban
  - When nhân viên mở nông trại phòng ban
  - Then hệ thống hiển thị nông trại chung của phòng ban kèm danh sách đóng góp của từng thành viên gồm tên thành viên, loại đóng góp và số lượng
  - And khi nhân viên chọn góp sản phẩm trong kho hoặc Hạt OCB, hệ thống yêu cầu xác nhận và nêu rõ đóng góp là tự nguyện và không thể hoàn lại
  - And sau khi nhân viên xác nhận, phần đóng góp bị trừ khỏi kho hoặc số Hạt OCB cá nhân, được cộng vào nông trại chung và không thể thu hồi
  - And nếu nhân viên chưa thuộc phòng ban nào, hệ thống hiển thị thông báo giải thích lý do chưa dùng được tính năng thay vì hiển thị nông trại chung

- [ ] **US-51**: Với tư cách nhân viên, tôi muốn xem lại dòng thời gian phát triển Cây OCB của mình để nhìn lại hành trình gắn bó.
  - **AC**:
  - Given nhân viên có thâm niên từ 6 tháng trở lên và đang mở thông tin Cây OCB
  - When nhân viên chọn xem dòng thời gian
  - Then hệ thống hiển thị toàn bộ mốc phát triển đã đi qua theo thứ tự thời gian tăng dần, mỗi mốc kèm ngày đạt mốc
  - And mốc kế tiếp chưa đạt được hiển thị tách riêng kèm thời gian còn lại và không tính là mốc đã đi qua
  - And nếu thâm niên dưới 6 tháng, hệ thống hiển thị thông báo chưa đạt mốc nào kèm thời gian còn lại tới mốc đầu tiên
  - And khi ngày vào làm được sửa lại, dòng thời gian được tính lại theo ngày vào làm mới ở lần mở tiếp theo

---

## Business Rules

### Cây OCB
- **BR-1**: Mỗi nhân viên có đúng một Cây OCB, luôn ở vị trí trung tâm nông trại, không bán được, không xoá được, không di chuyển được.
- **BR-2**: Mốc phát triển Cây OCB được xác định bằng số kỳ 6 tháng đã hoàn thành kể từ ngày vào làm.
- **BR-3**: Số nhánh lớn trên Cây OCB bằng số năm thâm niên tròn trừ 2, tối thiểu là 0. Thâm niên dưới 3 năm thì không có nhánh lớn.
- **BR-4**: Trạng thái ra hoa và kết quả chỉ áp dụng cho Cây OCB từ 3 năm thâm niên trở lên và chỉ trong ngày trùng ngày và tháng vào làm.
- **BR-5**: Trường hợp ngày vào làm là ngày 29 tháng 2, ngày kỷ niệm trong các năm không nhuận được tính là ngày 28 tháng 2.
- **BR-6**: Quả trên Cây OCB trong ngày kỷ niệm chỉ hái được một lần cho mỗi năm kỷ niệm.
- **BR-7**: Chỉ quản trị viên được sửa ngày vào làm sau khi nhân viên đã xác nhận lần đầu.
- **BR-8**: Khi ngày vào làm thay đổi, mốc Cây OCB được tính lại ngay; nếu thâm niên giảm, cây hiển thị nhỏ lại tương ứng nhưng thành tựu đã đạt không bị thu hồi.

### Kinh tế
- **BR-9**: Số Hạt OCB không bao giờ âm. Mọi giao dịch làm số dư âm đều bị từ chối.
- **BR-10**: Giá bán lại vật nuôi, cây và trang trí bằng một phần giá mua, tỷ lệ này do quản trị viên cấu hình.
- **BR-11**: Hạt OCB chỉ có giá trị trong nội bộ ứng dụng, không quy đổi ra tiền thật hay quyền lợi nhân sự.
- **BR-12**: Mỗi thành tựu chỉ được trao thưởng một lần cho mỗi nhân viên.
- **BR-13**: Phần thưởng check-in chỉ nhận được một lần trong mỗi ngày, mốc ngày tính theo múi giờ Việt Nam.
- **BR-14**: Chuỗi ngày check-in chỉ tăng khi lần check-in trước là ngày liền trước; nếu bỏ một ngày trở lên thì chuỗi đặt lại về 1.

### Chăm sóc
- **BR-15**: Vật nuôi không bao giờ chết hay biến mất do thiếu chăm sóc; hậu quả tối đa là chuyển sang trạng thái buồn và dừng tạo sản phẩm.
- **BR-16**: Cây không bao giờ chết do thiếu nước; hậu quả tối đa là tạm dừng tiến trình sinh trưởng.
- **BR-17**: Sản phẩm tích lũy khi người chơi vắng mặt bị giới hạn ở mức trần cho mỗi vật nuôi và mỗi cây.
- **BR-18**: Cá chỉ được đặt trong vùng ao nước; các loài còn lại chỉ được đặt trên vùng đất đã mở.
- **BR-19**: Mỗi ô đất chỉ chứa một cây hoặc một vật phẩm tại một thời điểm.
- **BR-20**: Mỗi cây chỉ được bón phân một lần trong mỗi giai đoạn sinh trưởng.

### Tương tác
- **BR-21**: Ở chế độ ghé thăm, người ghé thăm chỉ thực hiện được hành động giúp đỡ; mọi hành động mua, bán, di chuyển và xoá đều bị chặn.
- **BR-22**: Số lượt giúp đồng nghiệp của một nhân viên bị giới hạn theo ngày, và mỗi nông trại chỉ được cùng một người giúp một lần trong ngày.
- **BR-23**: Bảng xếp hạng chỉ hiển thị tên, phòng ban và giá trị tiêu chí; không hiển thị thông tin cá nhân khác.
- **BR-24**: Tên nông trại bị giới hạn độ dài và phải qua kiểm tra danh sách từ ngữ bị cấm.

### Truy cập và hiệu năng
- **BR-25**: Ứng dụng thuộc nhóm cần phân quyền truy cập; chỉ nhân viên được cấp quyền mới vào được nông trại.
- **BR-26**: Chỉ quản trị viên truy cập được trang quản trị và trang cấu hình OCB Farm.
- **BR-27**: Mọi thao tác quản trị tác động lên dữ liệu nhân viên đều phải được lưu vết gồm người thực hiện, thời điểm, giá trị trước và sau.
- **BR-28**: Số lượng vật nuôi, cây và vật phẩm trang trí trên một nông trại bị giới hạn theo cấu hình để bảo đảm độ mượt.
- **BR-29**: Âm thanh ở trạng thái tắt theo mặc định cho người dùng mới.
- **BR-30**: Thời tiết tại một thời điểm là như nhau cho mọi nông trại.

---

## Giả định

- **GD-1**: Nhân viên đã có tài khoản và đăng nhập được vào IT Hub; OCB Farm không xử lý đăng nhập riêng.
- **GD-2**: Thông tin tên, phòng ban của nhân viên đã có sẵn trong hệ thống và dùng được cho danh sách nông trại, bảng xếp hạng.
- **GD-3**: Mô hình 3D được lấy từ nguồn miễn phí có giấy phép cho phép sử dụng nội bộ; việc chọn mô hình cụ thể sẽ do bước thiết kế quyết định.
- **GD-4**: Dữ liệu nông trại có khối lượng nhỏ nên dùng vùng lưu trữ linh hoạt dùng chung đã có, không tạo cấu trúc dữ liệu chuyên biệt phức tạp.
- **GD-5**: Ngày vào làm tự động chỉ khả dụng nếu nguồn dữ liệu nhân sự có trường này; nếu không có, nhân viên tự khai ở lần đầu.

## Ràng buộc

- **RB-1**: Phải chạy được trên laptop cấu hình phổ thông của văn phòng ở mức chất lượng Thấp mà vẫn giữ được trải nghiệm mượt.
- **RB-2**: Không dùng thanh toán thật, không quảng cáo, không thu thập thêm dữ liệu cá nhân ngoài ngày vào làm.
- **RB-3**: Giao diện ngoài khung 3D phải đồng nhất với phần còn lại của IT Hub về màu sắc, kiểu chữ và thành phần giao diện.
- **RB-4**: Toàn bộ nội dung hiển thị cho nhân viên bằng tiếng Việt.
- **RB-5**: Nội dung phải phù hợp môi trường công sở: không có hình ảnh giết mổ, không bạo lực, không nội dung gây áp lực tiêu cực.
- **RB-6**: Tổng dung lượng tài nguyên 3D cần tải lần đầu phải được kiểm soát để không gây thời gian chờ quá dài trên mạng nội bộ.

---

## Điểm cần xác nhận

- **XN-1**: Ngưỡng dung lượng tải lần đầu và ngưỡng thời gian tải chấp nhận được là bao nhiêu (hiện chưa có số cụ thể).
- **XN-2**: Nguồn dữ liệu nhân sự có chứa ngày vào làm hay không; nếu có thì lấy từ đâu.
- **XN-3**: Giá trị khởi điểm cụ thể của bộ thông số cân bằng game (giá mua bán, thời gian sinh trưởng, phần thưởng) sẽ được đề xuất ở bước thiết kế để anh chốt.
- **XN-4**: Danh sách dịp lễ cần hỗ trợ trong phiên bản đầu (Tết, Giáng sinh, và các dịp khác của OCB).
- **XN-5**: Năm thành lập OCB dùng làm mốc chặn dưới khi kiểm tra ngày vào làm.
- **XN-6**: Thời gian ân hạn hái quả ngày kỷ niệm nếu nhân viên không truy cập đúng ngày đó.
