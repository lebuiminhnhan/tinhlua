import type { AchievementCode, FarmAchievementView } from '../../models/ocb-farm.model';

/**
 * OCB Farm — hàm thuần cho bảng thành tựu (task 14.4, US-29, BR-12).
 * Tách khỏi component để kiểm thử độc lập, không phụ thuộc Angular.
 */

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Giới hạn mặc định số huy hiệu hiển thị đồng thời khi `farm_config` chưa có giá trị. */
export const DEFAULT_BADGES_SHOWN_MAX = 3;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** `dd/MM/yyyy` theo giờ Việt Nam (UTC+7) — dùng cho ngày đạt thành tựu. */
export function formatAchievementDate(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const d = new Date(ms + VN_OFFSET_MS);
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/** Tỉ lệ tiến trình 0..1, kẹp biên — `target <= 0` coi như đã đầy để tránh chia 0. */
export function achievementProgressRatio(progress: number, target: number): number {
  if (target <= 0) return 1;
  const ratio = progress / target;
  if (!Number.isFinite(ratio)) return 0;
  return Math.min(1, Math.max(0, ratio));
}

/** Phần trăm làm tròn, dùng cho `aria-valuenow` / nhãn tiến trình. */
export function achievementProgressPercent(progress: number, target: number): number {
  return Math.round(achievementProgressRatio(progress, target) * 100);
}

/** Sắp xếp hiển thị: đã đạt trước (mới nhất trước), chưa đạt sau (tiến trình cao trước). */
export function sortAchievements(items: readonly FarmAchievementView[]): FarmAchievementView[] {
  return [...items].sort((a, b) => {
    if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
    if (a.unlocked && b.unlocked) {
      const at = Date.parse(a.unlocked_at ?? '') || 0;
      const bt = Date.parse(b.unlocked_at ?? '') || 0;
      return bt - at;
    }
    return achievementProgressRatio(b.progress, b.target) - achievementProgressRatio(a.progress, a.target);
  });
}

/** Giới hạn số huy hiệu hiển thị đồng thời theo cấu hình `badges_shown_max` (BR-12). */
export function resolveBadgesShownMax(configured: number | undefined | null): number {
  if (configured === undefined || configured === null || !Number.isFinite(configured)) {
    return DEFAULT_BADGES_SHOWN_MAX;
  }
  const n = Math.floor(configured);
  return n < 1 ? DEFAULT_BADGES_SHOWN_MAX : n;
}

/**
 * Bật/tắt một mã trong danh sách huy hiệu đang chọn, có chặn vượt giới hạn (BR-12).
 * Trả về danh sách mới và cờ `blocked` khi lựa chọn bị từ chối vì đã đạt giới hạn.
 */
export function toggleBadgeSelection(
  current: readonly AchievementCode[],
  code: AchievementCode,
  max: number,
): { next: AchievementCode[]; blocked: boolean } {
  const isSelected = current.includes(code);
  if (isSelected) {
    return { next: current.filter((c) => c !== code), blocked: false };
  }
  if (current.length >= max) {
    return { next: [...current], blocked: true };
  }
  return { next: [...current, code], blocked: false };
}
