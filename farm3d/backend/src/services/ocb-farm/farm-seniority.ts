/**
 * OCB Farm — các hàm thuần tính thâm niên, mốc phát triển và số nhánh của
 * Cây OCB theo ngày vào làm của nhân viên.
 *
 * Toàn bộ hàm trong module này chỉ phụ thuộc vào `joinDate`, `now` và một
 * cấu hình truyền vào — không truy cập DB, không có side effect nào khác.
 * Mọi phép tính ngày/giờ đi qua `farm-calendar.ts` để đảm bảo tính theo giờ
 * Việt Nam (UTC+7) một cách nhất quán.
 *
 * _Requirements: US-5, US-6, US-51, BR-2, BR-3, BR-8_
 */

import { addMonthsClamped, startOfDayVN } from './farm-calendar';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Số năm thâm niên tối thiểu để Cây OCB bắt đầu mọc nhánh lớn — khớp khóa
 * cấu hình `anniversary_min_years` (US-6: "3 năm có 1 nhánh, 7 năm có 5 nhánh"
 * → `branches = years - (MIN_YEARS_FOR_BRANCHES - 1)`).
 */
const MIN_YEARS_FOR_BRANCHES = 3;

/**
 * Cấu hình giới hạn của Cây OCB — khớp khóa cấu hình `tree_max_milestone`
 * và `tree_max_branches` ở `20261001_010_seed_farm_config.sql` (nhóm `cay_ocb`).
 */
export interface FarmSeniorityConfig {
  /** Số mốc phát triển tối đa (mỗi mốc là một kỳ 6 tháng) — khóa `tree_max_milestone`. */
  treeMaxMilestone: number;
  /** Số nhánh lớn tối đa — khóa `tree_max_branches`. */
  treeMaxBranches: number;
}

/** Giá trị mặc định — trùng giá trị khởi điểm trong seed cấu hình game. */
export const DEFAULT_SENIORITY_CONFIG: FarmSeniorityConfig = {
  treeMaxMilestone: 40,
  treeMaxBranches: 30,
};

/** Thâm niên theo năm/tháng tròn (đã hoàn thành trọn vẹn), giữa hai thời điểm. */
export interface Seniority {
  /** Số năm tròn đã hoàn thành. */
  years: number;
  /** Số tháng tròn còn dư sau khi trừ `years` năm (0..11). */
  months: number;
  /** Tổng số tháng tròn đã hoàn thành — `years * 12 + months`. */
  totalMonths: number;
}

/**
 * Tính thâm niên (năm/tháng tròn, đã hoàn thành trọn vẹn) từ `joinDate` đến
 * `now`, theo giờ Việt Nam (UTC+7).
 *
 * "Tròn" nghĩa là chỉ tính đến kỳ hạn gần nhất đã đi qua: ví dụ vào làm
 * 15/03/2020, tại 14/06/2023 thâm niên là 3 năm 2 tháng (chưa đủ 3 tháng vì
 * chưa tới ngày 15/06). Việc kẹp ngày cuối tháng (vào làm ngày 31) và quy
 * tắc 29/02 → 28/02 do `addMonthsClamped` xử lý.
 *
 * Nếu `now` sớm hơn `joinDate` (dữ liệu bất thường, ví dụ admin sửa ngày vào
 * làm thành một ngày ở tương lai), trả về thâm niên 0 năm 0 tháng thay vì số
 * âm — không có "thâm niên âm" trong nghiệp vụ.
 *
 * _Requirements: US-5, BR-2_
 */
export function seniority(joinDate: Date, now: Date): Seniority {
  if (now.getTime() <= joinDate.getTime()) {
    return { years: 0, months: 0, totalMonths: 0 };
  }

  const totalMonths = countCompletedMonths(joinDate, now);
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;

  return { years, months, totalMonths };
}

/**
 * Số tháng tròn đã hoàn thành trọn vẹn từ `joinDate` đến `now`, bằng cách dò
 * nhị phân trên `addMonthsClamped` — tránh phép chia ngày theo lịch dương
 * (số ngày/tháng không đều) và tự động thừa hưởng quy tắc kẹp cuối tháng.
 */
function countCompletedMonths(joinDate: Date, now: Date): number {
  // Chặn trên an toàn: không thâm niên nào trong nghiệp vụ vượt quá mức này
  // (giới hạn kỹ thuật của dò nhị phân, không phải một quy tắc nghiệp vụ).
  const UPPER_BOUND_MONTHS = 12 * 200;

  let low = 0;
  let high = UPPER_BOUND_MONTHS;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (addMonthsClamped(joinDate, mid).getTime() <= now.getTime()) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return low;
}

/**
 * Số kỳ 6 tháng đã hoàn thành trọn vẹn kể từ `joinDate` đến `now`, kẹp ở
 * mức tối đa `config.treeMaxMilestone`.
 *
 * Mốc mới có hiệu lực từ đúng 00:00:00 UTC+7 của ngày tròn kỳ 6 tháng (do
 * `addMonthsClamped` luôn trả về mốc 00:00:00 UTC+7), tức ngày tròn mốc đã
 * thuộc về mốc mới — khớp AC "ngày tròn mốc đã thuộc mốc mới" của US-5.
 *
 * _Requirements: US-5, BR-2, BR-3_
 */
export function milestoneIndex(
  joinDate: Date,
  now: Date,
  config: FarmSeniorityConfig = DEFAULT_SENIORITY_CONFIG
): number {
  const { totalMonths } = seniority(joinDate, now);
  const completedHalfYears = Math.floor(totalMonths / 6);
  return Math.min(completedHalfYears, config.treeMaxMilestone);
}

/**
 * Số nhánh lớn của Cây OCB = số năm tròn đã hoàn thành trừ
 * (`MIN_YEARS_FOR_BRANCHES` − 1), tối thiểu 0, kẹp ở mức tối đa
 * `config.treeMaxBranches`.
 *
 * Ví dụ với `MIN_YEARS_FOR_BRANCHES = 3`: 3 năm → 1 nhánh, 7 năm → 5 nhánh,
 * dưới 3 năm → 0 nhánh.
 *
 * _Requirements: US-6, BR-3_
 */
export function branchCount(
  joinDate: Date,
  now: Date,
  config: FarmSeniorityConfig = DEFAULT_SENIORITY_CONFIG
): number {
  const { years } = seniority(joinDate, now);
  const rawBranches = years - (MIN_YEARS_FOR_BRANCHES - 1);
  const clampedToZero = Math.max(0, rawBranches);
  return Math.min(clampedToZero, config.treeMaxBranches);
}

/**
 * Số ngày còn lại (số nguyên, làm tròn lên) tới mốc phát triển kế tiếp của
 * Cây OCB, tính từ 00:00:00 UTC+7 của ngày chứa `now` tới ngày tròn mốc kế
 * tiếp.
 *
 * Trả về `null` khi thâm niên đã đạt mốc tối đa theo cấu hình — không còn
 * mốc kế tiếp để tính (khớp AC "hiển thị nhãn đã đạt mốc cao nhất thay cho
 * số ngày còn lại" của US-5). Dùng `daysToNextMilestone(...) === null` để
 * phân biệt "đã đạt mốc tối đa" với "còn 0 ngày" (ngày tròn mốc chính là
 * hôm nay — trường hợp này trả về 0, không phải `null`).
 *
 * _Requirements: US-5, BR-2_
 */
export function daysToNextMilestone(
  joinDate: Date,
  now: Date,
  config: FarmSeniorityConfig = DEFAULT_SENIORITY_CONFIG
): number | null {
  const currentMilestone = milestoneIndex(joinDate, now, config);
  if (currentMilestone >= config.treeMaxMilestone) {
    return null;
  }

  const nextMilestoneDate = addMonthsClamped(joinDate, (currentMilestone + 1) * 6);
  const todayStart = startOfDayVN(now);
  const diffMs = nextMilestoneDate.getTime() - todayStart.getTime();

  return Math.max(0, Math.ceil(diffMs / MS_PER_DAY));
}

/** Một mốc trên dòng thời gian Cây OCB — dùng để dựng UI dòng thời gian (US-51). */
export interface MilestoneTimelineEntry {
  /** Số kỳ 6 tháng đã hoàn thành tại mốc này (0, 1, 2, ...). */
  milestone: number;
  /** Ngày tròn mốc, theo giờ Việt Nam (mốc 00:00:00 UTC+7). */
  reachedOn: Date;
  /** `true` khi `now` đã ở đúng ngày tròn mốc hoặc muộn hơn. */
  reached: boolean;
}

/**
 * Trả về dòng thời gian đầy đủ các mốc phát triển của Cây OCB, từ mốc 0 (dưới
 * 6 tháng, ngày tròn mốc chính là `joinDate`) tới mốc tối đa theo cấu hình,
 * kèm ngày đạt mốc và cờ đã đạt hay chưa — phục vụ hiển thị dòng thời gian
 * trong `ocb-tree-panel` (US-51).
 *
 * _Requirements: US-51, BR-2_
 */
export function milestoneTimeline(
  joinDate: Date,
  now: Date,
  config: FarmSeniorityConfig = DEFAULT_SENIORITY_CONFIG
): MilestoneTimelineEntry[] {
  const currentMilestone = milestoneIndex(joinDate, now, config);
  const entries: MilestoneTimelineEntry[] = [];

  for (let m = 0; m <= config.treeMaxMilestone; m++) {
    const reachedOn = addMonthsClamped(joinDate, m * 6);
    entries.push({
      milestone: m,
      reachedOn,
      reached: m <= currentMilestone,
    });
  }

  return entries;
}

/**
 * Đồng bộ `state.tree` (mốc + số nhánh) theo ngày vào làm tại `now`.
 *
 * `state.tree` là bản lưu dùng để vẽ Cây OCB và xét thành tựu `TREE_*`; nó phải
 * khớp thâm niên thật. Trước đây chỉ được tính lại khi quản trị sửa ngày vào làm,
 * nên nông trại mới luôn đứng ở mốc 0 / 0 nhánh dù thâm niên nhiều năm. Gọi hàm
 * này khi khởi tạo nông trại và mỗi lượt `GET /me` (cùng lượt tick nền).
 *
 * Trả lại CHÍNH `state` khi không có gì thay đổi (để caller khỏi ghi vô ích).
 * `joinDate === null` → giữ nguyên.
 *
 * _Requirements: US-5, US-6, BR-2, BR-3_
 */
export function syncTreeWithSeniority<T extends { tree: { milestone: number; branches: number; last_evaluated_at: string } }>(
  state: T,
  joinDate: string | Date | null,
  now: Date,
  config: FarmSeniorityConfig = DEFAULT_SENIORITY_CONFIG,
): T {
  if (joinDate === null || joinDate === undefined) return state;
  const joinDateObj = typeof joinDate === 'string' ? new Date(`${joinDate.slice(0, 10)}T00:00:00.000Z`) : joinDate;
  if (Number.isNaN(joinDateObj.getTime())) return state;
  const milestone = milestoneIndex(joinDateObj, now, config);
  const branches = branchCount(joinDateObj, now, config);
  if (state.tree?.milestone === milestone && state.tree?.branches === branches) return state;
  return { ...state, tree: { milestone, branches, last_evaluated_at: now.toISOString() } };
}
