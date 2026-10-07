/**
 * OCB Farm — các hàm thuần xử lý thời gian theo giờ Việt Nam (UTC+7).
 *
 * Toàn bộ mốc nghiệp vụ của OCB Farm (thâm niên, mốc Cây OCB, ngày kỷ niệm,
 * chuỗi check-in...) đều tính theo ranh giới ngày UTC+7, KHÔNG theo giờ máy chủ
 * hay giờ trình duyệt của nhân viên. Module này là nguồn chân lý duy nhất cho
 * các phép tính ngày/giờ — không truy cập DB, không có side effect nào khác.
 *
 * _Requirements: US-5, US-7, US-25, BR-5, BR-13_
 */

/** Múi giờ Việt Nam là UTC+7 cố định, không có giờ mùa hè. */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Trả về thời điểm hiện tại (instant), tương đương `new Date()`.
 *
 * Một `Date` trong JavaScript luôn là một mốc UTC tuyệt đối — hàm này tồn tại
 * để mọi nơi trong OCB Farm lấy "bây giờ" thông qua module này (dễ kiểm thử,
 * dễ thay thế bằng đồng hồ giả khi viết unit test) thay vì gọi `new Date()`
 * rải rác trong code nghiệp vụ.
 *
 * _Requirements: BR-5_
 */
export function nowVN(): Date {
  return new Date();
}

/**
 * Trả về mốc 00:00:00.000 giờ Việt Nam (UTC+7) của ngày chứa `date`.
 *
 * Cách tính: dịch thời điểm sang "giờ địa phương VN" bằng cách cộng offset,
 * cắt về đầu ngày UTC, rồi trừ lại offset để có đúng mốc UTC tương ứng với
 * 00:00:00 UTC+7. Không dùng `Date` cục bộ của máy chủ (`getHours()`,
 * `setHours()`...) vì máy chủ có thể chạy ở múi giờ khác UTC+7.
 *
 * _Requirements: US-5, US-7, BR-5_
 */
export function startOfDayVN(date: Date): Date {
  const shifted = new Date(date.getTime() + VN_OFFSET_MS);
  const startOfShiftedUtcDay = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate()
  );
  return new Date(startOfShiftedUtcDay - VN_OFFSET_MS);
}

/**
 * Cộng `months` tháng vào `date` (tính theo ngày-tháng-năm giờ Việt Nam),
 * kẹp ngày cuối tháng khi tháng đích không có ngày tương ứng.
 *
 * Ví dụ: 31/01 + 1 tháng → 28/02 (hoặc 29/02 năm nhuận), không tự động
 * "tràn" sang 02 hoặc 03/03 như hành vi mặc định của `Date.setMonth()`.
 *
 * `months` có thể âm (lùi về tháng trước) hoặc bằng 0 (trả lại ngày-tháng-năm
 * giữ nguyên, giờ về 00:00:00 UTC+7).
 *
 * _Requirements: US-5, BR-5_
 */
export function addMonthsClamped(date: Date, months: number): Date {
  const shifted = new Date(date.getTime() + VN_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();

  const targetMonthIndex = month + months;
  const lastDayOfTargetMonth = daysInUtcMonth(year, targetMonthIndex);
  const clampedDay = Math.min(day, lastDayOfTargetMonth);

  const resultUtcMs = Date.UTC(year, targetMonthIndex, clampedDay);
  return new Date(resultUtcMs - VN_OFFSET_MS);
}

/**
 * Trả về ngày kỷ niệm (cùng tháng/ngày với `joinDate`) trong năm `year`,
 * theo giờ Việt Nam. Nếu `joinDate` là 29/02 và `year` không nhuận, ngày
 * kỷ niệm là 28/02 của năm đó.
 *
 * Kết quả luôn là mốc 00:00:00.000 UTC+7 của ngày kỷ niệm.
 *
 * _Requirements: US-7, BR-13_
 */
export function anniversaryOf(joinDate: Date, year: number): Date {
  const shifted = new Date(joinDate.getTime() + VN_OFFSET_MS);
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();

  const lastDayOfTargetMonth = daysInUtcMonth(year, month);
  const clampedDay = Math.min(day, lastDayOfTargetMonth);

  const resultUtcMs = Date.UTC(year, month, clampedDay);
  return new Date(resultUtcMs - VN_OFFSET_MS);
}

/**
 * Số ngày của tháng `monthIndex` (0-based, có thể ngoài [0, 11] — JS tự
 * chuẩn hoá năm/tháng) trong năm `year`, dùng `Date.UTC` nội bộ nên không
 * lệ thuộc múi giờ hệ thống.
 */
function daysInUtcMonth(year: number, monthIndex: number): number {
  // Ngày 0 của tháng kế tiếp = ngày cuối cùng của tháng monthIndex.
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}
