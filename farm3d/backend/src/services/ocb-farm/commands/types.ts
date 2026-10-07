/**
 * OCB Farm — kiểu dùng chung cho mọi command handler đăng ký vào
 * `command-registry.ts`. Tách riêng file này (không đặt trong
 * `command-registry.ts`) để các module lệnh (`animal.commands.ts`,
 * `plant.commands.ts`, ... — task 5.2-5.6) import kiểu mà không tạo phụ
 * thuộc vòng với chính registry.
 *
 * Thiết kế chữ ký `(state, payload, ctx) => CommandResult` (theo task 5.1)
 * để toàn bộ handler đều THUẦN theo nghĩa: không tự đọc/ghi DB, không tự
 * `throw` để báo lỗi nghiệp vụ — chỉ trả về một `CommandResult` discriminated
 * union mà `farm-command.service.ts` dùng để quyết định ghi gì vào DB. Điều
 * này giữ đúng tinh thần D2 (mô phỏng là hàm thuần) cho toàn bộ lớp lệnh,
 * không riêng gì `tick()`.
 *
 * _Requirements: US-21, US-29, US-40, BR-9, BR-12, BR-27_
 */

import {
  AppendFarmTransactionInput,
} from '../farm-state.repository';
import {
  AchievementCode,
  FarmCommandCode,
  FarmCommandPayloadMap,
  FarmErrorCode,
  FarmNotice,
  FarmSettings,
  FarmStateJson,
} from '../../../types/ocb-farm.types';

/**
 * Ngữ cảnh bất biến truyền vào mọi handler — mọi thứ handler cần để quyết
 * định kết quả NGOÀI `state` và `payload` của chính lệnh đó.
 *
 * `seeds` là số dư Hạt OCB TRƯỚC khi áp lệnh (đã tick) — handler trả
 * `seedsDelta` (dương/âm) trong `CommandResult`, KHÔNG tự tính số dư mới,
 * để `farm-command.service.ts` là nơi DUY NHẤT gọi `applyBalance()`
 * (farm-economy.ts) và quyết định có chặn số dư âm hay không (BR-9) —
 * handler không có cách nào vô tình bỏ qua bước kiểm tra này.
 */
export interface FarmCommandContext {
  userId: number;
  /** Số dư Hạt OCB hiện tại (đã tick), TRƯỚC khi áp lệnh. */
  seeds: number;
  /** Thông số cân bằng game đang áp dụng — khớp `FarmConfigResponse.values`. */
  config: Record<string, number>;
  /** Thời điểm server coi là "bây giờ" cho lệnh này — dùng cho mọi mốc thời gian handler cần ghi. */
  now: Date;
  /**
   * Thiết lập (`farm_states.settings`) hiện tại — NGOÀI `state`/cột JSONB
   * `state`, nên không nằm trong tham số `state` của handler. Chỉ
   * `UPDATE_SETTINGS` (settings.commands.ts, task 5.5) đọc trường này; mọi
   * handler khác bỏ qua. `farm-command.service.ts` lấy từ `FarmStateRow.settings`
   * đã đọc cùng dòng với `state` (`readFarmStateForUpdate`).
   */
  settings: FarmSettings;
  /**
   * Tên nông trại hiện tại (`farm_states.farm_name`) — NGOÀI `state`, tương
   * tự `settings`. Chỉ `RENAME_FARM` (settings.commands.ts, task 5.5) đọc
   * trường này để thông báo lỗi/giữ tên cũ khi bị từ chối.
   */
  farmName: string | null;
  /**
   * Ngày vào làm (`farm_states.join_date`), đã parse thành `Date` (00:00:00
   * UTC+7 của ngày đó) — NGOÀI `state`, tương tự `farmName`. `null` khi nông
   * trại chưa xác nhận ngày vào làm (về lý thuyết không nên xảy ra ở tầng
   * này vì `farm-access.middleware.ts`/luồng khởi tạo đã chặn trước, nhưng
   * giữ kiểu `| null` để không ép handler tin tưởng tuyệt đối). Chỉ
   * `PICK_ANNIVERSARY_FRUIT` (daily.commands.ts, task 5.6) đọc trường này để
   * tính thâm niên (`seniority()`) và ngày kỷ niệm (`anniversaryOf()`).
   */
  joinDate: Date | null;
  /**
   * Chuỗi check-in liên tiếp hiện tại (`farm_states.checkin_streak`) VÀ ngày
   * check-in gần nhất (`farm_states.last_checkin_date`, `YYYY-MM-DD` theo
   * giờ Việt Nam) — NGOÀI `state`, tương tự `farmName`/`settings`. Chỉ
   * `CLAIM_CHECKIN` (daily.commands.ts, task 5.6) đọc hai trường này.
   */
  checkinStreak: number;
  lastCheckinDate: string | null;
  /**
   * Hôm nay, dạng `YYYY-MM-DD` theo giờ Việt Nam — bằng
   * `startOfDayVN(ctx.now)` quy đổi sẵn, để handler không phải tự gọi lại
   * `farm-calendar.ts` (tránh lệ thuộc trực tiếp vào module đó từ tầng
   * handler THUẦN). Dùng bởi `CLAIM_CHECKIN` và `PICK_ANNIVERSARY_FRUIT`.
   */
  today: string;
  /**
   * Danh sách mã thành tựu đã mở khóa của nhân viên này (`farm_achievements`
   * đọc TRƯỚC khi dispatch, không phải sau khi đánh giá thành tựu của lượt
   * hiện tại — xem `farm-command.service.ts`) — NGOÀI `state`. Chỉ
   * `SELECT_BADGES` (daily.commands.ts, task 5.6) đọc trường này để validate
   * mỗi huy hiệu chọn hiển thị phải là huy hiệu đã đạt (US-29).
   */
  unlockedAchievementCodes: AchievementCode[];
}

/**
 * Một dòng sổ thu chi mà handler muốn ghi — thiếu `userId`/`balanceAfter`
 * (do `farm-command.service.ts` tính sau khi áp `seedsDelta` của TOÀN BỘ
 * handler, không chỉ dòng này) so với {@link AppendFarmTransactionInput}.
 */
export type FarmLedgerLine = Omit<AppendFarmTransactionInput, 'userId' | 'balanceAfter'>;

/** Kết quả thành công của một command handler. */
export interface FarmCommandHandlerSuccess {
  ok: true;
  /** `state` đã áp dụng thay đổi của lệnh (trên nền `state` đã tick). */
  state: FarmStateJson;
  /**
   * Thay đổi số dư Hạt OCB do lệnh này gây ra (dương = thu, âm = chi) —
   * mặc định 0 khi không truyền (lệnh không có hiệu lực kinh tế trực tiếp,
   * ví dụ `MOVE_ENTITY`). `farm-command.service.ts` áp dụng giá trị này qua
   * `applyBalance()` và chặn số dư âm (BR-9) — handler không tự kiểm tra.
   */
  seedsDelta?: number;
  /** Dòng sổ thu chi cần ghi, theo đúng thứ tự — rỗng khi lệnh không có hiệu lực kinh tế. */
  ledgerLines?: FarmLedgerLine[];
  /** Thông báo không chặn để trả kèm response (ví dụ `FEED_ALL_PARTIAL`). */
  notices?: FarmNotice[];
  /**
   * Tên nông trại mới cần ghi vào cột `farm_states.farm_name` — NGOÀI
   * `state`/`seeds` (cột riêng, không nằm trong JSONB `state`). Chỉ
   * `RENAME_FARM` (settings.commands.ts, task 5.5) trả trường này;
   * `undefined` nghĩa là KHÔNG cập nhật cột này (giữ tên hiện tại), đúng
   * ngữ nghĩa "từ chối thì giữ tên cũ" (US-35).
   */
  farmNameUpdate?: string;
  /**
   * Thiết lập mới cần ghi vào cột `farm_states.settings` — NGOÀI `state`,
   * tương tự `farmNameUpdate`. Chỉ `UPDATE_SETTINGS` trả trường này;
   * `undefined` nghĩa là KHÔNG cập nhật cột này.
   */
  settingsUpdate?: FarmSettings;
  /**
   * Chỉ `CLAIM_CHECKIN` (daily.commands.ts, task 5.6) trả trường này khi
   * check-in hợp lệ (chưa nhận trong ngày) — mô tả CẢ hai việc
   * `farm-command.service.ts` phải làm NGOÀI `state`/`seedsDelta`:
   *
   * 1. Cập nhật hai cột `farm_states.checkin_streak` / `last_checkin_date`
   *    (tương tự `farmNameUpdate`/`settingsUpdate` — handler không tự ghi).
   * 2. `INSERT` một dòng vào bảng `farm_checkins` — đây là lớp bảo vệ THẬT
   *    chống nhận thưởng lần hai trong ngày (BR-6, BR-13), nhờ
   *    `UNIQUE(user_id, checkin_date)`: nếu hai request đồng thời cùng vượt
   *    qua bước kiểm tra "đã check-in hôm nay chưa" trong state đã tick (vì
   *    đọc cùng `last_checkin_date` trước khi cả hai transaction `UPDATE`),
   *    đúng một trong hai sẽ thắng cuộc đua `INSERT`, request còn lại nhận
   *    xung đột khóa duy nhất và PHẢI bị `farm-command.service.ts` coi là
   *    thất bại toàn bộ (rollback, trả `CHECKIN_ALREADY_CLAIMED`) — xem chi
   *    tiết race-handling ở `farm-command.service.ts`.
   *
   * `undefined` nghĩa là KHÔNG áp dụng (ví dụ handler từ chối vì đã check-in
   * trong ngày — trường hợp đó trả `fail()`, không trả `success()` với
   * trường này).
   */
  checkinUpdate?: {
    /** Chuỗi check-in mới sau lượt này — ghi vào `farm_states.checkin_streak`. */
    streak: number;
    /** `YYYY-MM-DD` theo giờ Việt Nam — ghi vào `farm_states.last_checkin_date`. */
    lastCheckinDate: string;
    /** Dữ liệu để `INSERT INTO farm_checkins` — khớp đúng các cột NOT NULL của bảng. */
    tableInsert: {
      checkinDate: string;
      reward: number;
      streakBonus: number;
      streakAfter: number;
    };
  };
  /**
   * Chỉ `PICK_ANNIVERSARY_FRUIT` (daily.commands.ts, task 5.6) trả trường
   * này khi hái quả hợp lệ — mô tả việc `farm-command.service.ts` phải
   * `INSERT` vào bảng `farm_anniversary_claims`, cùng cơ chế race-handling
   * như `checkinUpdate.tableInsert` (idempotent bằng
   * `UNIQUE(user_id, anniversary_year)`, BR-6, BR-12): hai request đồng thời
   * trong ngày kỷ niệm/thời gian ân hạn chỉ đúng một thắng cuộc đua `INSERT`,
   * request còn lại phải bị coi là thất bại toàn bộ (rollback, trả
   * `ANNIVERSARY_ALREADY_CLAIMED`).
   *
   * Khác với check-in, lệnh này KHÔNG chạm cột nào khác của `farm_states`
   * ngoài `seeds` (đã có qua `seedsDelta` chung) — không cần một trường cập
   * nhật cột riêng nào ở đây.
   */
  anniversaryClaimInsert?: {
    anniversaryYear: number;
    seniorityYears: number;
    fruitPicked: number;
    rewardTotal: number;
  };
}

/** Kết quả thất bại của một command handler — ánh xạ thẳng sang HTTP 422. */
export interface FarmCommandHandlerFailure {
  ok: false;
  code: FarmErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export type FarmCommandHandlerResult = FarmCommandHandlerSuccess | FarmCommandHandlerFailure;

/** Chữ ký chung của mọi command handler — `C` neo kiểu `payload` đúng theo `FarmCommandPayloadMap`. */
export type FarmCommandHandler<C extends FarmCommandCode> = (
  state: FarmStateJson,
  payload: FarmCommandPayloadMap[C],
  ctx: FarmCommandContext,
) => FarmCommandHandlerResult;

/** Tiện ích dựng kết quả thất bại — tránh lặp `{ ok: false, ... }` ở mọi handler. */
export function fail(
  code: FarmErrorCode,
  message: string,
  details?: Record<string, unknown>,
): FarmCommandHandlerFailure {
  return { ok: false, code, message, details };
}

/** Tiện ích dựng kết quả thành công — tránh lặp `{ ok: true, ... }` ở mọi handler. */
export function success(
  state: FarmStateJson,
  extra?: Omit<FarmCommandHandlerSuccess, 'ok' | 'state'>,
): FarmCommandHandlerSuccess {
  return { ok: true, state, ...extra };
}
