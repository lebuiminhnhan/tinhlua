import type { FarmListItem } from '../../models/ocb-farm.model';

/**
 * OCB Farm — hàm thuần cho danh sách ghé thăm (task 14.1, US-26).
 * Tách khỏi component để kiểm thử độc lập, không phụ thuộc Angular.
 */

/** Số ký tự tối thiểu để kích hoạt tìm theo tên (US-26). */
export const VISIT_SEARCH_MIN_CHARS = 2;
export const VISIT_PAGE_SIZE = 12;

/** Một phòng ban dùng cho bộ lọc, suy ra từ các trang kết quả đã tải (không có endpoint riêng). */
export interface VisitDepartmentOption {
  id: number;
  name: string;
}

/** `q` có đủ độ dài để tìm theo tên, hoặc rỗng (bỏ lọc tên) — khớp quy tắc server (US-26). */
export function isSearchableQuery(q: string): boolean {
  const trimmed = q.trim();
  return trimmed.length === 0 || trimmed.length >= VISIT_SEARCH_MIN_CHARS;
}

/** Gộp danh sách phòng ban xuất hiện trong các trang đã tải, sắp theo tên (không trùng id). */
export function collectDepartmentOptions(
  items: readonly FarmListItem[],
  existing: readonly VisitDepartmentOption[],
): VisitDepartmentOption[] {
  const byId = new Map(existing.map((d) => [d.id, d]));
  for (const item of items) {
    if (item.department_id !== null && !byId.has(item.department_id)) {
      byId.set(item.department_id, { id: item.department_id, name: item.department_name || `Phòng ${item.department_id}` });
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

/** Nhãn thâm niên ngắn từ số tháng — ví dụ 14 → "1 năm 2 tháng", 5 → "5 tháng". */
export function seniorityLabel(months: number): string {
  const m = Math.max(0, Math.floor(months));
  const years = Math.floor(m / 12);
  const rest = m % 12;
  if (years <= 0) return `${rest} tháng`;
  if (rest === 0) return `${years} năm`;
  return `${years} năm ${rest} tháng`;
}
