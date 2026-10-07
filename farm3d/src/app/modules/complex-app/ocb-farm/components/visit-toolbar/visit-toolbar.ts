import type { FarmHelpAvailability, FarmStateJson, HelpActionType } from '../../models/ocb-farm.model';

/**
 * OCB Farm — hàm thuần cho thanh công cụ chế độ ghé thăm (task 14.1, US-8, US-27, BR-21).
 * Tách khỏi component để kiểm thử độc lập, không phụ thuộc Angular.
 */

/** Độ dài tối đa mặc định của lời chúc nếu chưa có cấu hình (khớp seed `greeting_max_len`). */
export const DEFAULT_GREETING_MAX_LEN = 200;

export type HelpBlockReason = 'quota_exceeded' | 'already_helped_today' | 'nothing_to_help';

/** Nông trại đang ghé thăm có ít nhất một cây thiếu nước hoặc vật nuôi đói (US-27). */
export function hasSomethingToHelp(state: FarmStateJson | null): boolean {
  if (!state) return false;
  const hasThirstyPlant = state.plants.some((p) => isPlantThirsty(p.watered_at));
  const hasHungryAnimal = state.animals.some((a) => a.fullness <= 0);
  return hasThirstyPlant || hasHungryAnimal;
}

/**
 * Suy đoán hiển thị "cây thiếu nước" phía client — chỉ dùng để quyết định bật/tắt nút,
 * server (`farm-grid.ts` / `farm-simulation.ts`) là nơi kiểm tra cuối cùng. Không có mốc
 * `water_interval` ở phía client nên coi mọi cây có `watered_at` là còn đủ nước; nút giúp
 * tưới vẫn bị vô hiệu đúng khi server báo `HELP_NOTHING_TO_DO`.
 */
function isPlantThirsty(_wateredAt: string): boolean {
  return false;
}

/** Lý do chặn hành động giúp — ưu tiên hết lượt trước, rồi đã giúp hôm nay, rồi không có gì để giúp. */
export function helpBlockReason(
  availability: FarmHelpAvailability | null,
  action: HelpActionType,
  hasFarm: boolean,
): HelpBlockReason | null {
  if (!availability || !hasFarm) return 'nothing_to_help';
  if (availability.remaining_quota <= 0) return 'quota_exceeded';
  if (availability.already_helped_today) return 'already_helped_today';
  const canAct = action === 'water' ? availability.can_water : availability.can_feed;
  if (!canAct) return 'nothing_to_help';
  return null;
}

export function helpBlockMessage(reason: HelpBlockReason | null, resetsAtLabel: string): string | null {
  switch (reason) {
    case null:
      return null;
    case 'quota_exceeded':
      return `Bạn đã dùng hết lượt giúp hôm nay. Lượt giúp làm mới vào ${resetsAtLabel}.`;
    case 'already_helped_today':
      return 'Bạn đã giúp nông trại này hôm nay rồi. Hãy ghé thăm lại vào ngày mai.';
    case 'nothing_to_help':
      return 'Hiện không có gì cần giúp ở nông trại này.';
  }
}

/** `dd/MM HH:mm` theo giờ Việt Nam (UTC+7) cho mốc làm mới lượt giúp. */
export function formatResetTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const d = new Date(ms + 7 * 60 * 60 * 1000);
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} ngày ${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}`;
}

export type GreetingBlockReason = 'too_long' | 'empty' | 'quota_exceeded';

/** Trùng danh sách từ ngữ bị cấm tối giản phía client — server là nơi kiểm tra cuối cùng. */
const CLIENT_FORBIDDEN_WORDS = ['đụ', 'địt', 'lồn', 'cặc'];

export function containsForbiddenWord(message: string): boolean {
  const lower = message.toLowerCase();
  return CLIENT_FORBIDDEN_WORDS.some((w) => lower.includes(w));
}

/**
 * Chặn sớm lời chúc chắc chắn bị server từ chối: rỗng, vượt độ dài, đã gửi hết quota
 * trong ngày. Server vẫn kiểm tra danh sách từ cấm đầy đủ và trả lỗi cụ thể (US-8).
 */
export function greetingBlockReason(
  message: string,
  maxLen: number,
  alreadySentToday: boolean,
): GreetingBlockReason | null {
  const trimmed = message.trim();
  if (alreadySentToday) return 'quota_exceeded';
  if (trimmed.length === 0) return 'empty';
  if (trimmed.length > maxLen) return 'too_long';
  return null;
}
