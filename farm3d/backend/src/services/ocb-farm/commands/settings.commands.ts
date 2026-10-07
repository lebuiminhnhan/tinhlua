/**
 * OCB Farm — nhóm lệnh đổi tên và cài đặt: `RENAME_FARM`, `UPDATE_SETTINGS`.
 *
 * Mọi handler ở đây THUẦN theo đúng chữ ký `FarmCommandHandler<C>` (xem
 * `types.ts`): không đọc/ghi DB — chỉ nhận `state` đã tick + `payload` +
 * `ctx` rồi trả `success()`/`fail()`. Khác với các nhóm lệnh khác, cả hai
 * lệnh ở đây KHÔNG chạm `state` (JSONB) mà chạm hai cột riêng của
 * `farm_states`:
 *
 * - `RENAME_FARM` → cột `farm_name`, trả qua `farmNameUpdate` (xem `types.ts`).
 * - `UPDATE_SETTINGS` → cột `settings`, trả qua `settingsUpdate`.
 *
 * `farm-command.service.ts` là nơi DUY NHẤT ghi hai cột này vào DB khi
 * handler trả về trường tương ứng — handler ở đây không tự ghi gì.
 *
 * ## Quyết định thiết kế
 *
 * - **Theo dõi hạn mức đổi tên (`rename_quota`)**: `FarmStateJson` không có
 *   bảng riêng cho lịch sử đổi tên, nên thêm trường tùy chọn
 *   `state.renames?: string[]` (mốc ISO của mỗi lần đổi tên thành công) —
 *   xem `ocb-farm.types.ts`. Chọn JSONB thay vì bảng DB mới vì: (1) không
 *   cần migration, (2) số lần đổi tên trong `rename_quota_days` ngày là nhỏ
 *   (mặc định 3 lần/7 ngày) nên mảng không phình to, (3) nhất quán với cách
 *   các bộ đếm khác (`FarmCounters`) đã sống trong `state`. `RENAME_FARM`
 *   lọc bỏ các mốc cũ hơn `rename_quota_days` ngày mỗi lần kiểm tra (không
 *   cần job dọn riêng) và trả `state` đã cập nhật mảng này kèm
 *   `farmNameUpdate` khi thành công.
 * - **Danh sách từ ngữ bị cấm**: chưa có danh sách nào trong codebase (đã
 *   rà soát, không tìm thấy). Thêm một hằng số nhỏ, tối giản ở đây —
 *   ⚠ cần OCB rà soát/mở rộng danh sách thật trước khi lên production, đây
 *   chỉ là placeholder minh họa đúng luồng kiểm tra (BR-24).
 *
 * _Requirements: US-30, US-32, US-33, US-35, US-36, BR-24_
 */

import {
  FARM_QUALITIES,
  FarmQuality,
  FarmSceneLock,
  FarmSettings,
  FarmStateJson,
} from '../../../types/ocb-farm.types';
import { FarmCommandHandler, fail, success } from './types';
import { DAY_PHASES } from '../../../types/ocb-farm.types';

// ============================================================================
// RENAME_FARM (US-35, BR-24)
// ============================================================================

/**
 * Danh sách từ ngữ bị cấm trong tên nông trại — placeholder tối giản.
 *
 * ⚠ Cần xác nhận: đây KHÔNG phải danh sách đầy đủ cho production. Không có
 * danh sách chính thức nào tồn tại trong codebase ở thời điểm viết handler
 * này; OCB nên rà soát và thay bằng danh sách đã được duyệt (có thể chuyển
 * sang bảng DB riêng nếu cần quản trị viên tự cập nhật mà không deploy lại).
 * So khớp không phân biệt hoa/thường, theo từng từ con (substring) trên
 * chuỗi đã hạ về chữ thường — xem {@link containsForbiddenWord}.
 */
const FORBIDDEN_FARM_NAME_WORDS: readonly string[] = ['đụ', 'địt', 'lồn', 'cặc', 'đéo', 'fuck', 'shit'];

export function containsForbiddenWord(name: string): boolean {
  const normalized = name.toLowerCase();
  return FORBIDDEN_FARM_NAME_WORDS.some((word) => normalized.includes(word));
}

/** Mốc đổi tên còn trong hạn mức hiện tại — bỏ các mốc cũ hơn `rename_quota_days` ngày. */
function recentRenames(renames: string[], now: Date, quotaDays: number): string[] {
  const windowMs = quotaDays * 24 * 60 * 60 * 1000;
  const cutoff = now.getTime() - windowMs;
  return renames.filter((iso) => new Date(iso).getTime() > cutoff);
}

const renameFarm: FarmCommandHandler<'RENAME_FARM'> = (state, payload, ctx) => {
  const trimmed = (payload.farm_name ?? '').trim();
  const maxLen = ctx.config['farm_name_max_len'] ?? 40;
  const quota = ctx.config['rename_quota'] ?? 3;
  const quotaDays = ctx.config['rename_quota_days'] ?? 7;

  if (trimmed.length === 0) {
    return fail('FARM_NAME_REQUIRED', 'Vui lòng nhập tên nông trại.');
  }
  if (trimmed.length > maxLen) {
    return fail('FARM_NAME_TOO_LONG', `Tên nông trại tối đa ${maxLen} ký tự.`, { max_len: maxLen });
  }
  if (containsForbiddenWord(trimmed)) {
    return fail('FARM_NAME_FORBIDDEN_WORD', 'Tên nông trại chứa nội dung không được phép.');
  }

  const existingRenames = recentRenames(state.renames ?? [], ctx.now, quotaDays);
  if (existingRenames.length >= quota) {
    const oldestRelevant = existingRenames
      .slice()
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0];
    const nextAllowedAt = oldestRelevant
      ? new Date(new Date(oldestRelevant).getTime() + quotaDays * 24 * 60 * 60 * 1000).toISOString()
      : ctx.now.toISOString();

    return fail(
      'RENAME_QUOTA_EXCEEDED',
      `Đã đổi tên quá ${quota} lần trong ${quotaDays} ngày gần nhất, vui lòng thử lại sau.`,
      { quota, quota_days: quotaDays, next_allowed_at: nextAllowedAt },
    );
  }

  const nextState: FarmStateJson = {
    ...state,
    renames: [...existingRenames, ctx.now.toISOString()],
  };

  return success(nextState, { farmNameUpdate: trimmed });
};

// ============================================================================
// UPDATE_SETTINGS (US-30, US-32, US-33, US-36)
// ============================================================================

const VALID_QUALITIES: ReadonlySet<FarmQuality> = new Set(FARM_QUALITIES);
const VALID_SCENE_LOCKS: ReadonlySet<FarmSceneLock> = new Set<FarmSceneLock>([...DAY_PHASES, null]);

/** Validate từng khóa có mặt trong payload — trả mã lỗi của khóa đầu tiên sai, hoặc `null` khi hợp lệ. */
function validateSettingsPayload(
  payload: Partial<FarmSettings>,
): { field: string; value: unknown } | null {
  if ('quality' in payload && payload.quality !== undefined && !VALID_QUALITIES.has(payload.quality)) {
    return { field: 'quality', value: payload.quality };
  }
  if ('quality_manual' in payload && payload.quality_manual !== undefined && typeof payload.quality_manual !== 'boolean') {
    return { field: 'quality_manual', value: payload.quality_manual };
  }
  if ('bgm' in payload && payload.bgm !== undefined && typeof payload.bgm !== 'boolean') {
    return { field: 'bgm', value: payload.bgm };
  }
  if ('sfx' in payload && payload.sfx !== undefined && typeof payload.sfx !== 'boolean') {
    return { field: 'sfx', value: payload.sfx };
  }
  if (
    'scene_lock' in payload &&
    payload.scene_lock !== undefined &&
    !VALID_SCENE_LOCKS.has(payload.scene_lock)
  ) {
    return { field: 'scene_lock', value: payload.scene_lock };
  }
  return null;
}

const updateSettings: FarmCommandHandler<'UPDATE_SETTINGS'> = (state, payload, ctx) => {
  const invalidField = validateSettingsPayload(payload);
  if (invalidField) {
    return fail(
      'SETTINGS_INVALID_VALUE',
      `Giá trị cài đặt "${invalidField.field}" không hợp lệ.`,
      invalidField,
    );
  }

  const mergedSettings: FarmSettings = {
    ...ctx.settings,
    ...payload,
  };

  // `state` không đổi — cài đặt là cột riêng (`farm_states.settings`), chỉ
  // ghi qua `settingsUpdate` (US-30, US-32, US-36: lưu theo nhân viên, không
  // theo thiết bị, mọi lượt tải nông trại khác đọc đúng giá trị này).
  return success(state, { settingsUpdate: mergedSettings });
};

// ============================================================================
// Đăng ký — export để `command-registry.ts` spread vào `COMMAND_REGISTRY`
// ============================================================================

export const SETTINGS_COMMAND_HANDLERS = {
  RENAME_FARM: renameFarm,
  UPDATE_SETTINGS: updateSettings,
};
