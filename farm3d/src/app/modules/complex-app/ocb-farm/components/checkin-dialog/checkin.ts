/**
 * OCB Farm — hàm thuần cho hộp thưởng check-in (US-25).
 */

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Mốc làm mới dạng "00:00 ngày 16/06/2025 (giờ Việt Nam)". `null` nếu ISO không hợp lệ. */
export function formatCheckinReset(resetsAtIso: string | null | undefined): string | null {
  if (!resetsAtIso) return null;
  const t = Date.parse(resetsAtIso);
  if (!Number.isFinite(t)) return null;
  const vn = new Date(t + VN_OFFSET_MS);
  const dd = String(vn.getUTCDate()).padStart(2, '0');
  const mm = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const hh = String(vn.getUTCHours()).padStart(2, '0');
  const mi = String(vn.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mi} ngày ${dd}/${mm}/${vn.getUTCFullYear()} (giờ Việt Nam)`;
}

/** Chuỗi sau lượt check-in kế tiếp — dùng để hiển thị trước khi nhận (tham khảo, server quyết định). */
export function previewNextStreak(
  streak: number,
  lastCheckinDate: string | null,
  todayIso: string,
): number {
  if (!lastCheckinDate) return 1;
  const last = Date.parse(`${lastCheckinDate}T00:00:00Z`);
  const today = Date.parse(`${todayIso}T00:00:00Z`);
  if (!Number.isFinite(last) || !Number.isFinite(today)) return 1;
  const diffDays = Math.round((today - last) / 86_400_000);
  return diffDays === 1 ? Math.max(0, streak) + 1 : 1;
}
