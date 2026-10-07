/**
 * OCB Farm — hàm thuần cho bảng thông tin Cây OCB (US-4..US-7, US-51).
 *
 * Mọi ngày là chuỗi `YYYY-MM-DD` theo giờ Việt Nam (UTC+7), nên so sánh chuỗi tương
 * đương so sánh ngày. Quy tắc khớp backend (`farm-seniority.ts`, `daily.commands.ts`):
 * - Ngày tròn mốc = ngày vào làm + 6·m tháng, kẹp về ngày cuối tháng đích (31 → 30/28…).
 * - Ngày tròn mốc thuộc mốc mới (từ 00:00 UTC+7 của ngày đó).
 * - Ngày kỷ niệm năm Y = ngày/tháng vào làm trong năm Y; 29/02 ở năm không nhuận → 28/02.
 * - Quả kỷ niệm hái được đúng ngày kỷ niệm hoặc trong `graceDays` ngày sau đó.
 */

import { ocbTreeBranchInfo, type OcbTreeBranchInfo } from '../../scene/geometry/ocb-tree.geometry';
import { formatSeniority, parseIsoDate, seniorityBetween } from '../onboarding-wizard/join-date';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Mặc định khớp seed `farm_config` khi không đọc được cấu hình. */
export const DEFAULT_TREE_MAX_MILESTONE = 40;
export const DEFAULT_ANNIVERSARY_MIN_YEARS = 3;
export const DEFAULT_ANNIVERSARY_GRACE_DAYS = 0;

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function toIso(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function isoToUtcMs(iso: string): number | null {
  const p = parseIsoDate(iso);
  return p ? Date.UTC(p.y, p.m - 1, p.d) : null;
}

/** Cộng `months` tháng vào ngày `iso`, kẹp ngày về cuối tháng đích; `null` nếu sai định dạng. */
export function addMonthsClampedIso(iso: string, months: number): string | null {
  const p = parseIsoDate(iso);
  if (!p) return null;
  const index = p.y * 12 + (p.m - 1) + Math.floor(months);
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return toIso(y, m, Math.min(p.d, daysInMonth(y, m)));
}

/** Số ngày lịch từ `fromIso` tới `toIso` (âm nếu `toIso` sớm hơn). */
export function daysBetweenIso(fromIso: string, toIsoDate: string): number {
  const a = isoToUtcMs(fromIso);
  const b = isoToUtcMs(toIsoDate);
  if (a === null || b === null) return 0;
  return Math.round((b - a) / MS_PER_DAY);
}

/** Nhãn mốc: 0 → "Dưới 6 tháng", 1 → "6 tháng", 2 → "1 năm", 3 → "1 năm 6 tháng"… */
export function milestoneLabel(milestone: number): string {
  const m = Math.max(0, Math.floor(milestone));
  if (m === 0) return 'Dưới 6 tháng';
  return formatSeniority({ years: Math.floor(m / 2), months: (m % 2) * 6 });
}

// ---------------------------------------------------------------------------
// Dòng thời gian (US-51)
// ---------------------------------------------------------------------------

export interface TreeTimelineEntry {
  milestone: number;
  label: string;
  /** Ngày đạt mốc (`YYYY-MM-DD`, UTC+7). */
  reachedOn: string;
}

export interface TreeNextMilestone extends TreeTimelineEntry {
  /** Số ngày còn lại tính từ hôm nay (≥ 1 — ngày tròn mốc đã thuộc mốc mới). */
  daysRemaining: number;
}

export interface TreeTimeline {
  /** Mốc hiện tại (số kỳ 6 tháng đã hoàn thành, có trần). */
  current: number;
  /** Các mốc đã đi qua (≥ 1), tăng dần theo thời gian. */
  passed: TreeTimelineEntry[];
  /** Mốc kế tiếp chưa đạt — `null` khi đã ở mốc tối đa. */
  next: TreeNextMilestone | null;
  atMax: boolean;
}

export function treeTimeline(
  joinIso: string | null,
  todayIso: string,
  maxMilestone: number = DEFAULT_TREE_MAX_MILESTONE,
): TreeTimeline | null {
  if (!joinIso || !parseIsoDate(joinIso) || !parseIsoDate(todayIso)) return null;
  const max = Number.isFinite(maxMilestone) && maxMilestone >= 0 ? Math.floor(maxMilestone) : DEFAULT_TREE_MAX_MILESTONE;

  const passed: TreeTimelineEntry[] = [];
  let current = 0;
  for (let m = 1; m <= max; m++) {
    const reachedOn = addMonthsClampedIso(joinIso, m * 6);
    if (!reachedOn || reachedOn > todayIso) break;
    passed.push({ milestone: m, label: milestoneLabel(m), reachedOn });
    current = m;
  }

  if (current >= max) return { current, passed, next: null, atMax: true };

  const nextMilestone = current + 1;
  const nextOn = addMonthsClampedIso(joinIso, nextMilestone * 6) ?? todayIso;
  return {
    current,
    passed,
    next: {
      milestone: nextMilestone,
      label: milestoneLabel(nextMilestone),
      reachedOn: nextOn,
      daysRemaining: Math.max(0, daysBetweenIso(todayIso, nextOn)),
    },
    atMax: false,
  };
}

// ---------------------------------------------------------------------------
// Ngày kỷ niệm (US-7)
// ---------------------------------------------------------------------------

/** Ngày kỷ niệm trong năm `year` — 29/02 ở năm không nhuận thành 28/02. */
export function anniversaryOf(joinIso: string, year: number): string | null {
  const p = parseIsoDate(joinIso);
  if (!p) return null;
  return toIso(year, p.m, Math.min(p.d, daysInMonth(year, p.m)));
}

export interface AnniversaryStatus {
  /** Hôm nay đúng ngày kỷ niệm (00:00:00 → 23:59:59 UTC+7). */
  isToday: boolean;
  /** Năm dương lịch của ngày kỷ niệm đang áp dụng — gửi kèm `PICK_ANNIVERSARY_FRUIT`. */
  year: number;
  /** Ngày kỷ niệm đang áp dụng (`YYYY-MM-DD`). */
  date: string;
  /** Số năm đồng hành tính tới ngày kỷ niệm đang áp dụng. */
  years: number;
  /** Số ngày đã qua kể từ ngày kỷ niệm đang áp dụng (0 = hôm nay). */
  daysSince: number;
  /** Đủ thâm niên tối thiểu để cây ra hoa kết quả. */
  eligible: boolean;
  /** Còn hái quả được: đủ thâm niên và (đúng ngày hoặc còn trong thời gian ân hạn). */
  claimable: boolean;
  /** Số ngày ân hạn còn lại sau hôm nay (chỉ có nghĩa khi `claimable`). */
  graceDaysLeft: number;
}

export function anniversaryStatus(
  joinIso: string | null,
  todayIso: string,
  minYears: number = DEFAULT_ANNIVERSARY_MIN_YEARS,
  graceDays: number = DEFAULT_ANNIVERSARY_GRACE_DAYS,
): AnniversaryStatus | null {
  const join = joinIso ? parseIsoDate(joinIso) : null;
  const today = parseIsoDate(todayIso);
  if (!join || !today || !joinIso || todayIso <= joinIso) return null;

  const thisYear = anniversaryOf(joinIso, today.y);
  if (!thisYear) return null;
  const year = thisYear > todayIso ? today.y - 1 : today.y;
  const date = year === today.y ? thisYear : anniversaryOf(joinIso, year);
  if (!date || date <= joinIso) return null; // chưa có ngày kỷ niệm nào

  const daysSince = daysBetweenIso(date, todayIso);
  const years = seniorityBetween(joinIso, date).years;
  const grace = Number.isFinite(graceDays) && graceDays > 0 ? Math.floor(graceDays) : 0;
  const eligible = years >= minYears;
  const inWindow = daysSince >= 0 && daysSince <= grace;
  return {
    isToday: daysSince === 0,
    year,
    date,
    years,
    daysSince,
    eligible,
    claimable: eligible && inWindow,
    graceDaysLeft: inWindow ? grace - daysSince : 0,
  };
}

/** Cây ra hoa kết quả suốt ngày kỷ niệm khi đủ thâm niên tối thiểu (US-7). */
export function isTreeBlooming(
  joinIso: string | null,
  todayIso: string,
  minYears: number = DEFAULT_ANNIVERSARY_MIN_YEARS,
): boolean {
  const s = anniversaryStatus(joinIso, todayIso, minYears, 0);
  return !!s && s.isToday && s.eligible;
}

// ---------------------------------------------------------------------------
// Nhánh (US-6)
// ---------------------------------------------------------------------------

/** Năm vào làm từ `YYYY-MM-DD`; `null` khi chưa có / sai định dạng. */
export function joinYearOf(joinIso: string | null): number | null {
  const p = joinIso ? parseIsoDate(joinIso) : null;
  return p ? p.y : null;
}

/** Danh sách nhánh lớn kèm năm dương lịch tượng trưng và năm gắn bó thứ mấy. */
export function treeBranches(branches: number, joinIso: string | null): OcbTreeBranchInfo[] {
  const n = Number.isFinite(branches) ? Math.max(0, Math.floor(branches)) : 0;
  const joinYear = joinYearOf(joinIso);
  return Array.from({ length: n }, (_, i) => ocbTreeBranchInfo(i, joinYear));
}
