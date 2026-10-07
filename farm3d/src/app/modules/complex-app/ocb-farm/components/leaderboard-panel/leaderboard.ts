import type { FarmLeaderboardRow, LeaderboardMetric } from '../../models/ocb-farm.model';

/**
 * OCB Farm — hàm thuần cho bảng xếp hạng (task 14.3, US-28, BR-23).
 * Tách khỏi component để kiểm thử độc lập, không phụ thuộc Angular.
 */

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Thứ tự hiển thị 3 tab tiêu chí — mặc định mở là `seniority` (US-28). */
export const LEADERBOARD_METRIC_TABS: readonly { metric: LeaderboardMetric; label: string; icon: string }[] = [
  { metric: 'seniority', label: 'Thâm niên Cây OCB', icon: 'bi bi-tree-fill' },
  { metric: 'assets', label: 'Tổng tài sản', icon: 'bi bi-piggy-bank-fill' },
  { metric: 'streak', label: 'Chuỗi check-in', icon: 'bi bi-calendar-check-fill' },
];

export const LEADERBOARD_DEFAULT_METRIC: LeaderboardMetric = 'seniority';

/** Số nguyên định dạng kiểu Việt Nam (dấu chấm phân cách nghìn). */
export function formatSeedsValue(value: number): string {
  return Math.round(value).toLocaleString('vi-VN');
}

/** `value` của tiêu chí `seniority` là tổng số tháng (US-28) → "X năm Y tháng". */
export function formatSeniorityMonths(totalMonths: number): string {
  const m = Math.max(0, Math.floor(totalMonths));
  if (m === 0) return 'Chưa đủ 1 tháng';
  const years = Math.floor(m / 12);
  const months = m % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} năm`);
  if (months > 0) parts.push(`${months} tháng`);
  return parts.join(' ');
}

/** Nhãn giá trị theo đúng đơn vị của từng tiêu chí (US-28). */
export function formatLeaderboardValue(metric: LeaderboardMetric, value: number): string {
  switch (metric) {
    case 'seniority':
      return formatSeniorityMonths(value);
    case 'assets':
      return `${formatSeedsValue(value)} Hạt OCB`;
    case 'streak':
      return `${formatSeedsValue(value)} ngày`;
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** `HH:mm dd/MM/yyyy` theo giờ Việt Nam (UTC+7); chuỗi không hợp lệ → giữ nguyên. */
export function formatRefreshedAt(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const d = new Date(ms + VN_OFFSET_MS);
  return (
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} ` +
    `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
  );
}

/**
 * `true` khi dòng của chính nhân viên (`me`) đã có mặt trong top hiển thị — khi đó
 * không cần hiển thị dòng ghim riêng, chỉ cần đánh dấu khác biệt ngay trong danh sách
 * (US-28: "vị trí và giá trị của bản thân luôn được hiển thị và đánh dấu khác biệt").
 */
export function isSelfInRows(rows: readonly FarmLeaderboardRow[], me: FarmLeaderboardRow | null): boolean {
  if (!me) return false;
  return rows.some((r) => r.user_id === me.user_id);
}
