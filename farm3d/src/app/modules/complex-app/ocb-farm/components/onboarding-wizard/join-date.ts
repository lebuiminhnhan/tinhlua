/**
 * OCB Farm — hàm thuần cho bước nhập ngày vào làm (US-2, US-3).
 *
 * Mọi ngày được biểu diễn dạng chuỗi `YYYY-MM-DD` (ngày lịch theo giờ Việt Nam),
 * nên so sánh chuỗi tương đương so sánh ngày. Cách tính thâm niên khớp
 * `seniority()` ở backend (`farm-seniority.ts`): tháng tròn, kẹp ngày cuối tháng.
 */

/** Năm thành lập OCB mặc định khi không đọc được cấu hình `ocb_founded_year`. */
export const DEFAULT_OCB_FOUNDED_YEAR = 1996;

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface JoinDateRange {
  min: string;
  max: string;
}

export type JoinDateValidation =
  | { ok: true }
  | { ok: false; reason: 'required' | 'invalid' | 'out_of_range' };

export interface SeniorityYm {
  years: number;
  months: number;
}

/** Ngày hôm nay theo giờ Việt Nam (UTC+7), dạng `YYYY-MM-DD`. */
export function todayVnIso(nowMs: number = Date.now()): string {
  return new Date(nowMs + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Khoảng hợp lệ: 01/01 năm thành lập .. hôm nay (UTC+7). */
export function joinDateRange(foundedYear: number, nowMs: number = Date.now()): JoinDateRange {
  const year = Number.isInteger(foundedYear) && foundedYear > 0 ? foundedYear : DEFAULT_OCB_FOUNDED_YEAR;
  return { min: `${String(year).padStart(4, '0')}-01-01`, max: todayVnIso(nowMs) };
}

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Tách `YYYY-MM-DD` thành số; `null` nếu sai định dạng hoặc không phải ngày có thật. */
export function parseIsoDate(value: string): { y: number; m: number; d: number } | null {
  const match = ISO_DATE_RE.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

export function validateJoinDate(value: string, range: JoinDateRange): JoinDateValidation {
  const trimmed = value.trim();
  if (trimmed === '') return { ok: false, reason: 'required' };
  if (!parseIsoDate(trimmed)) return { ok: false, reason: 'invalid' };
  if (trimmed < range.min || trimmed > range.max) return { ok: false, reason: 'out_of_range' };
  return { ok: true };
}

/** Thâm niên theo năm + tháng tròn từ `joinIso` tới `todayIso` (không âm). */
export function seniorityBetween(joinIso: string, todayIso: string): SeniorityYm {
  const join = parseIsoDate(joinIso);
  const today = parseIsoDate(todayIso);
  if (!join || !today || todayIso <= joinIso) return { years: 0, months: 0 };

  let total = (today.y - join.y) * 12 + (today.m - join.m);
  // Ngày "kỷ niệm tháng" trong tháng hiện tại, kẹp về ngày cuối tháng (31/01 → 28/02).
  const anniversaryDay = Math.min(join.d, daysInMonth(today.y, today.m));
  if (today.d < anniversaryDay) total -= 1;
  total = Math.max(0, total);
  return { years: Math.floor(total / 12), months: total % 12 };
}

/** `YYYY-MM-DD` → `dd/MM/yyyy`; giữ nguyên chuỗi nếu sai định dạng. */
export function formatViDate(iso: string): string {
  const p = parseIsoDate(iso);
  if (!p) return iso;
  return `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y}`;
}

export function formatSeniority(s: SeniorityYm): string {
  if (s.years === 0 && s.months === 0) return 'Chưa đủ 1 tháng';
  const parts: string[] = [];
  if (s.years > 0) parts.push(`${s.years} năm`);
  if (s.months > 0) parts.push(`${s.months} tháng`);
  return parts.join(' ');
}
