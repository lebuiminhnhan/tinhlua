/**
 * OCB Farm — service của endpoint lệnh duy nhất `POST /api/ocb-farm/commands`
 * (D1: server-authoritative; D3: khóa lạc quan bằng `version`).
 *
 * Đây là nơi DUY NHẤT áp dụng thay đổi trạng thái nông trại. Mọi hành động
 * của nhân viên (mua/bán/cho ăn/tưới/thu hoạch/check-in/...) đi qua đúng một
 * luồng transaction ở đây — các module lệnh (`commands/*.commands.ts`, task
 * 5.2-5.6) chỉ quyết định "lệnh này có hợp lệ không và thay đổi gì", không
 * tự chạm DB.
 *
 * Thứ tự thực hiện của {@link applyFarmCommand} (khớp task 5.1 và sequence
 * diagram "Luồng lệnh chuẩn" trong design.md):
 *
 * 1. `BEGIN` → `SELECT ... FOR UPDATE` (khóa dòng, tuần tự hóa các lệnh ghi
 *    đồng thời trên cùng một nông trại).
 * 2. Nếu đã có kết quả cache cho `(user_id, idempotency_key)` này — trả lại
 *    nguyên vẹn, KHÔNG áp lệnh lần hai (xem mục "Idempotency" dưới đây).
 * 3. `tick(state, last_tick_at → now)` — mô phỏng tiến trình trước khi áp
 *    lệnh, để không "ăn gian" thời gian đã trôi qua (D2).
 * 4. Kiểm tra `version` client gửi khớp `version` hiện tại của dòng — lệch
 *    thì `ROLLBACK` và trả 409 kèm state mới nhất (D3, US-40, US-22).
 * 5. Dispatch lệnh qua `COMMAND_REGISTRY` (`commands/command-registry.ts`).
 *    Handler trả lỗi → `ROLLBACK`, trả 422 kèm mã lỗi nghiệp vụ.
 * 6. Áp `seedsDelta` qua `applyBalance()` (farm-economy.ts) — chặn số dư âm
 *    (BR-9). Về lý thuyết các handler tự validate trước khi trả `seedsDelta`
 *    âm vượt số dư, nhưng đây là lớp bảo vệ cuối cùng ở tầng transaction,
 *    không tin tưởng tuyệt đối vào từng handler riêng lẻ.
 * 7. `UPDATE farm_states` (state mới, seeds mới, `version + 1`, `last_tick_at`).
 * 8. Ghi các dòng `farm_transactions` do handler yêu cầu (nếu có hiệu lực
 *    kinh tế), theo đúng thứ tự.
 * 9. Đánh giá thành tựu (`farm-achievement.ts`) trên `state` sau lệnh, ghi
 *    `farm_achievements` cho các mã vừa mở khóa, cộng thưởng Hạt OCB tương
 *    ứng vào `seeds` và ghi thêm dòng sổ `achievement_reward` cho mỗi mã.
 * 10. Lưu kết quả 200 vào `farm_command_results` (cache idempotency) rồi
 *     `COMMIT`.
 *
 * ## Idempotency (US-40)
 *
 * `idempotency_key` được bảo đảm "lặp lại không nhân đôi hiệu lực" bằng một
 * bảng cache riêng (`farm_command_results`, khóa chính
 * `(user_id, idempotency_key)`) — KHÔNG dựa vào `UNIQUE(user_id,
 * idempotency_key)` của `farm_transactions`, vì nhiều lệnh (`MOVE_ENTITY`,
 * `ROTATE_DECOR`, `UPDATE_SETTINGS`, ...) không ghi dòng sổ nào nhưng vẫn
 * cần idempotency. Chỉ response 200 (thành công) được cache — 409/422 KHÔNG
 * được cache, để client sửa request rồi gửi lại cùng khóa vẫn được xử lý
 * lại từ đầu (một lần `version` lệch hay payload sai không nên "đóng băng"
 * vĩnh viễn một khóa).
 *
 * _Requirements: US-21, US-29, US-40, BR-9, BR-12, BR-27_
 */

import { PoolClient } from 'pg';
import { pool } from '../../config/database';
import { nowVN, startOfDayVN } from './farm-calendar';
import { evaluate } from './farm-achievement';
import { ACHIEVEMENT_CATALOG } from './farm-achievement';
import { applyBalance } from './farm-economy';
import { getFarmConfig } from './farm-config.service';
import { tick } from './farm-simulation';
import {
  appendFarmTransaction,
  readFarmStateForUpdate,
} from './farm-state.repository';
import { dispatchCommand, FarmCommandContext } from './commands';
import type {
  AchievementCode,
  FarmAchievementUnlocked,
  FarmCommandCode,
  FarmCommandRequest,
  FarmCommandSuccessResponse,
  FarmErrorCode,
  FarmLedgerEntry,
  FarmStateJson,
} from '../../types/ocb-farm.types';

// ============================================================================
// Kiểu kết quả — discriminated union khớp 200 / 409 / 422
// ============================================================================

export interface FarmCommandOkResult {
  httpStatus: 200;
  body: FarmCommandSuccessResponse;
}

export interface FarmCommandConflictResult {
  httpStatus: 409;
  body: {
    code: 'VERSION_CONFLICT';
    message: string;
    state: FarmStateJson;
    version: number;
    balance: number;
  };
}

export interface FarmCommandBusinessErrorResult {
  httpStatus: 422;
  body: {
    code: FarmErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type FarmCommandResult =
  | FarmCommandOkResult
  | FarmCommandConflictResult
  | FarmCommandBusinessErrorResult;

// ============================================================================
// Validate khung request — trước khi mở transaction (BR-27, không để lại thao tác dở dang)
// ============================================================================

function invalidCommand(message: string, details?: Record<string, unknown>): FarmCommandBusinessErrorResult {
  return { httpStatus: 422, body: { code: 'INVALID_COMMAND', message, details } };
}

function invalidPayload(message: string, details?: Record<string, unknown>): FarmCommandBusinessErrorResult {
  return { httpStatus: 422, body: { code: 'INVALID_PAYLOAD', message, details } };
}

/**
 * Kiểm tra khung request có đủ hình dạng tối thiểu để tiếp tục xử lý —
 * KHÔNG kiểm tra nghiệp vụ (đó là việc của handler). Trả `null` khi hợp lệ.
 */
function validateEnvelope(req: unknown): FarmCommandBusinessErrorResult | null {
  if (typeof req !== 'object' || req === null) {
    return invalidPayload('Nội dung yêu cầu không hợp lệ.');
  }

  const envelope = req as Partial<FarmCommandRequest>;

  if (typeof envelope.command !== 'string') {
    return invalidCommand('Thiếu hoặc sai định dạng trường "command".');
  }
  if (typeof envelope.version !== 'number' || !Number.isInteger(envelope.version) || envelope.version < 0) {
    return invalidPayload('Thiếu hoặc sai định dạng trường "version".');
  }
  if (typeof envelope.idempotency_key !== 'string' || envelope.idempotency_key.trim() === '') {
    return invalidPayload('Thiếu hoặc sai định dạng trường "idempotency_key".');
  }
  if (typeof envelope.payload !== 'object' || envelope.payload === null) {
    return invalidPayload('Thiếu hoặc sai định dạng trường "payload".');
  }

  return null;
}

// ============================================================================
// Idempotency — đọc/ghi cache `farm_command_results`
// ============================================================================

interface CachedCommandResultRow {
  response: FarmCommandSuccessResponse;
}

/** Đọc kết quả 200 đã lưu cho `(userId, idempotencyKey)`, nếu có — trong cùng transaction. */
async function readCachedResult(
  client: PoolClient,
  userId: number,
  idempotencyKey: string,
): Promise<FarmCommandSuccessResponse | null> {
  const result = await client.query<CachedCommandResultRow>(
    'SELECT response FROM farm_command_results WHERE user_id = $1 AND idempotency_key = $2',
    [userId, idempotencyKey],
  );
  return result.rows[0]?.response ?? null;
}

/** Lưu kết quả 200 vào cache — PHẢI gọi trong cùng transaction đã ghi `farm_states`. */
async function cacheResult(
  client: PoolClient,
  userId: number,
  idempotencyKey: string,
  command: FarmCommandCode,
  response: FarmCommandSuccessResponse,
): Promise<void> {
  await client.query(
    `INSERT INTO farm_command_results (user_id, idempotency_key, command, response)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, idempotency_key) DO NOTHING`,
    [userId, idempotencyKey, command, JSON.stringify(response)],
  );
}

// ============================================================================
// Check-in / kỷ niệm — đọc trước dispatch, ghi bảng chuyên dụng sau dispatch
// (US-7, US-25, US-29, BR-6, BR-12, BR-13, task 5.6)
// ============================================================================

/**
 * Đọc danh sách mã thành tựu đã mở khóa của `userId` — dùng để lấp
 * `ctx.unlockedAchievementCodes` TRƯỚC khi dispatch, cho `SELECT_BADGES`
 * validate huy hiệu được chọn phải là huy hiệu đã đạt. Đây là một truy vấn
 * riêng với truy vấn tương tự trong {@link applyAchievements} (đọc SAU
 * dispatch, để tính mã nào MỚI mở khóa) — tách riêng vì mục đích khác nhau,
 * dù cùng đọc một bảng.
 */
async function readUnlockedAchievementCodes(
  client: PoolClient,
  userId: number,
): Promise<AchievementCode[]> {
  const result = await client.query<{ achievement_code: AchievementCode }>(
    'SELECT achievement_code FROM farm_achievements WHERE user_id = $1',
    [userId],
  );
  return result.rows.map((r) => r.achievement_code);
}

/**
 * Ghi một dòng vào `farm_checkins` (`UNIQUE(user_id, checkin_date)`) — lớp
 * bảo vệ THẬT chống nhận thưởng check-in lần hai trong ngày (BR-6, BR-13).
 *
 * Trả `true` khi ghi thành công (request này thắng cuộc đua), `false` khi
 * vi phạm unique constraint (mã lỗi Postgres `23505`) — nghĩa là một request
 * khác đã ghi `(user_id, checkin_date)` này trước, trong khoảng thời gian
 * giữa lúc `farm-command.service.ts` đọc `last_checkin_date` (bước đọc dòng
 * `FOR UPDATE`) và lúc `INSERT` này chạy. Về lý thuyết `FOR UPDATE` đã tuần
 * tự hóa các lệnh ghi trên CÙNG MỘT nông trại, nên race thật sự chỉ có thể
 * xảy ra nếu hai transaction khác nhau cùng vượt qua bước đọc trước khi một
 * trong hai `COMMIT` — giữ `INSERT` + kiểm tra xung đột ở đây như một lớp
 * bảo vệ độc lập, không tin tưởng tuyệt đối vào khóa dòng.
 */
async function insertCheckinRow(
  client: PoolClient,
  userId: number,
  input: { checkinDate: string; reward: number; streakBonus: number; streakAfter: number },
): Promise<boolean> {
  try {
    await client.query(
      `INSERT INTO farm_checkins (user_id, checkin_date, reward, streak_bonus, streak_after)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, input.checkinDate, input.reward, input.streakBonus, input.streakAfter],
    );
    return true;
  } catch (err) {
    const pgError = err as { code?: string };
    if (pgError.code === '23505') {
      return false;
    }
    throw err;
  }
}

/**
 * Ghi một dòng vào `farm_anniversary_claims`
 * (`UNIQUE(user_id, anniversary_year)`) — lớp bảo vệ THẬT chống hái quả kỷ
 * niệm lần hai trong cùng một năm kỷ niệm (BR-6, BR-12). Cùng cơ chế
 * race-handling như {@link insertCheckinRow}.
 */
async function insertAnniversaryClaimRow(
  client: PoolClient,
  userId: number,
  input: { anniversaryYear: number; seniorityYears: number; fruitPicked: number; rewardTotal: number },
): Promise<boolean> {
  try {
    await client.query(
      `INSERT INTO farm_anniversary_claims
         (user_id, anniversary_year, seniority_years, fruit_picked, reward_total)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, input.anniversaryYear, input.seniorityYears, input.fruitPicked, input.rewardTotal],
    );
    return true;
  } catch (err) {
    const pgError = err as { code?: string };
    if (pgError.code === '23505') {
      return false;
    }
    throw err;
  }
}

// ============================================================================
// Thành tựu — đánh giá + ghi `farm_achievements` + thưởng (US-29, BR-12)
// ============================================================================

export interface AchievementApplyResult {
  unlocked: FarmAchievementUnlocked[];
  /** Tổng Hạt OCB thưởng từ các thành tựu vừa mở khóa trong lượt này. */
  totalReward: number;
}

/**
 * Đọc danh sách mã thành tựu đã có của `userId`, đánh giá mã nào vừa đạt
 * trên `state` sau lệnh, ghi `farm_achievements` cho các mã mới (idempotent
 * bằng `UNIQUE(user_id, achievement_code)` — một request lặp lại do đua
 * điều kiện giữa hai lệnh gần nhau sẽ chỉ ghi được một lần, lần sau no-op
 * nhờ `ON CONFLICT DO NOTHING`).
 */
export async function applyAchievements(
  client: PoolClient,
  userId: number,
  state: FarmStateJson,
  checkinStreak: number,
  config: Record<string, number>,
  now: Date,
): Promise<AchievementApplyResult> {
  const existingResult = await client.query<{ achievement_code: string }>(
    'SELECT achievement_code FROM farm_achievements WHERE user_id = $1',
    [userId],
  );
  const alreadyUnlocked = existingResult.rows.map((r) => r.achievement_code);

  const counters = { ...state.counters, checkin_streak: checkinStreak };
  const newlyUnlockedCodes = evaluate(state, counters, config, alreadyUnlocked);

  const unlocked: FarmAchievementUnlocked[] = [];
  let totalReward = 0;

  for (const code of newlyUnlockedCodes) {
    const entry = ACHIEVEMENT_CATALOG[code];

    const insertResult = await client.query<{ unlocked_at: Date }>(
      `INSERT INTO farm_achievements (user_id, achievement_code, unlocked_at, progress)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, achievement_code) DO NOTHING
       RETURNING unlocked_at`,
      [userId, code, now.toISOString(), JSON.stringify(counters)],
    );

    // Không có dòng trả về nghĩa là một lệnh khác (đua điều kiện bất thường
    // trong cùng millisecond) đã ghi mã này trước — bỏ qua, không thưởng
    // trùng (BR-12).
    const unlockedRow = insertResult.rows[0];
    if (!unlockedRow) continue;

    unlocked.push({
      code,
      name: entry.name,
      reward: entry.reward,
      unlocked_at: unlockedRow.unlocked_at.toISOString(),
    });
    totalReward += entry.reward;
  }

  return { unlocked, totalReward };
}

// ============================================================================
// Hàm chính — `POST /commands`
// ============================================================================

/**
 * Áp một lệnh nông trại cho `userId`, theo đúng luồng transaction mô tả ở
 * đầu file. Không bao giờ throw cho lỗi nghiệp vụ/xung đột phiên bản — các
 * trường hợp đó trả về qua `FarmCommandResult` để route handler (task 5.7)
 * map thẳng sang HTTP status tương ứng; lỗi hạ tầng (DB mất kết nối, ...)
 * vẫn được throw lại để route xử lý như 500.
 *
 * _Requirements: US-21, US-29, US-40, BR-9, BR-12, BR-27_
 */
export async function applyFarmCommand(
  userId: number,
  request: unknown,
): Promise<FarmCommandResult> {
  const envelopeError = validateEnvelope(request);
  if (envelopeError) {
    return envelopeError;
  }

  const req = request as FarmCommandRequest;
  const now = nowVN();

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Bước 1 — khóa dòng.
    const row = await readFarmStateForUpdate(client, userId);
    if (row === null) {
      await client.query('ROLLBACK');
      return {
        httpStatus: 422,
        body: { code: 'FARM_NOT_INITIALIZED', message: 'Nông trại chưa được khởi tạo.' },
      };
    }

    // Bước 2 — idempotency: đã xử lý khóa này trước đây thì trả lại nguyên vẹn.
    const cached = await readCachedResult(client, userId, req.idempotency_key);
    if (cached) {
      await client.query('ROLLBACK');
      return { httpStatus: 200, body: cached };
    }

    const config = await getFarmConfig();

    // Bước 3 — tick trước khi áp lệnh (D2, D1).
    const tickResult = tick(row.state, new Date(row.last_tick_at), now, config.values);
    const tickedState = tickResult.state;

    // Bước 4 — khóa lạc quan: version client gửi phải khớp version hiện tại
    // CỦA DÒNG DB (không đổi bởi tick, vì tick không tăng version).
    if (req.version !== row.version) {
      await client.query('ROLLBACK');
      return {
        httpStatus: 409,
        body: {
          code: 'VERSION_CONFLICT',
          message: 'Dữ liệu nông trại đã thay đổi ở nơi khác, vui lòng tải lại.',
          state: tickedState,
          version: row.version,
          balance: row.seeds,
        },
      };
    }

    // Bước 5 — dispatch lệnh qua registry (commands/5.2-5.6).
    //
    // `today`/`unlockedAchievementCodes` phục vụ riêng `CLAIM_CHECKIN`/
    // `PICK_ANNIVERSARY_FRUIT`/`SELECT_BADGES` (task 5.6) — đọc TRƯỚC dispatch
    // giống hệt cách `settings`/`farmName` đã được đọc cùng dòng
    // `readFarmStateForUpdate` cho task 5.5. `unlockedAchievementCodes` cần
    // một truy vấn riêng (không nằm trong `FarmStateRow`) nên đọc ở đây.
    const today = startOfDayVN(now).toISOString().slice(0, 10);
    const unlockedAchievementCodes = await readUnlockedAchievementCodes(client, userId);

    const ctx: FarmCommandContext = {
      userId,
      seeds: row.seeds,
      config: config.values,
      now,
      settings: row.settings,
      farmName: row.farm_name,
      joinDate: row.join_date ? new Date(`${row.join_date}T00:00:00.000Z`) : null,
      checkinStreak: row.checkin_streak,
      lastCheckinDate: row.last_checkin_date,
      today,
      unlockedAchievementCodes,
    };
    const handlerResult = dispatchCommand(req.command, tickedState, req.payload, ctx);

    if (!handlerResult.ok) {
      await client.query('ROLLBACK');
      return {
        httpStatus: 422,
        body: { code: handlerResult.code, message: handlerResult.message, details: handlerResult.details },
      };
    }

    // Bước 5b — ghi bảng idempotency chuyên dụng cho `CLAIM_CHECKIN`/
    // `PICK_ANNIVERSARY_FRUIT` (task 5.6) NGAY SAU khi handler báo thành
    // công, TRƯỚC khi áp số dư/ghi `farm_states` — nếu `INSERT` xung đột
    // (một request khác đã thắng cuộc đua ghi đúng `(user_id, checkin_date)`
    // hoặc `(user_id, anniversary_year)` này), toàn bộ lệnh PHẢI thất bại như
    // thể đã nhận thưởng rồi: rollback, KHÔNG để lại hiệu lực kinh tế/trạng
    // thái một phần nào của lệnh này (không cộng Hạt OCB, không đổi
    // `checkin_streak`, không ghi `state`).
    if (handlerResult.checkinUpdate) {
      const inserted = await insertCheckinRow(
        client,
        userId,
        handlerResult.checkinUpdate.tableInsert,
      );
      if (!inserted) {
        await client.query('ROLLBACK');
        return {
          httpStatus: 422,
          body: {
            code: 'CHECKIN_ALREADY_CLAIMED',
            message: 'Bạn đã nhận thưởng check-in hôm nay rồi, vui lòng quay lại vào ngày mai.',
          },
        };
      }
    }

    if (handlerResult.anniversaryClaimInsert) {
      const inserted = await insertAnniversaryClaimRow(
        client,
        userId,
        handlerResult.anniversaryClaimInsert,
      );
      if (!inserted) {
        await client.query('ROLLBACK');
        return {
          httpStatus: 422,
          body: {
            code: 'ANNIVERSARY_ALREADY_CLAIMED',
            message: 'Phần thưởng kỷ niệm năm nay đã được nhận.',
          },
        };
      }
    }

    // Bước 6 — áp thay đổi số dư, chặn số dư âm (BR-9) — lớp bảo vệ cuối ở
    // tầng transaction, không tin tưởng tuyệt đối vào từng handler riêng lẻ.
    const seedsDelta = handlerResult.seedsDelta ?? 0;
    const balanceResult = applyBalance(row.seeds, seedsDelta);
    if (!balanceResult.ok) {
      await client.query('ROLLBACK');
      return {
        httpStatus: 422,
        body: {
          code: 'INSUFFICIENT_SEEDS',
          message: 'Số Hạt OCB không đủ để thực hiện giao dịch này.',
          details: { current_balance: row.seeds, requested_delta: seedsDelta },
        },
      };
    }

    const stateAfterCommand = handlerResult.state;

    // Bước 9 (đánh giá thành tựu TRƯỚC khi ghi final để cộng thưởng vào
    // cùng một lần UPDATE `farm_states.seeds`) — chạy trên state SAU lệnh.
    // Dùng chuỗi check-in MỚI (sau `CLAIM_CHECKIN` của lượt này, nếu có) để
    // đánh giá thành tựu `STREAK_*` — nếu dùng `row.checkin_streak` (chuỗi
    // TRƯỚC lệnh), mốc chuỗi vừa đạt ở đúng lượt check-in này sẽ bị trễ một
    // lượt (chỉ được ghi nhận ở lần gọi lệnh KẾ TIẾP).
    const checkinStreakForAchievements = handlerResult.checkinUpdate?.streak ?? row.checkin_streak;

    const achievementResult = await applyAchievements(
      client,
      userId,
      stateAfterCommand,
      checkinStreakForAchievements,
      config.values,
      now,
    );

    const finalBalance = balanceResult.value + achievementResult.totalReward;

    // Bước 7 — ghi state/seeds/version+1/last_tick_at, kèm `farm_name`/
    // `settings` khi handler trả `farmNameUpdate`/`settingsUpdate` (US-30,
    // US-32, US-35, US-36, task 5.5) — hai cột này NẰM NGOÀI `state` (JSONB)
    // nên không đi qua `stateAfterCommand`, và chỉ được cập nhật khi handler
    // thực sự trả về giá trị mới (`undefined` nghĩa là giữ nguyên cột hiện
    // tại, đúng ngữ nghĩa "từ chối thì giữ tên/cài đặt cũ"). Dùng
    // `COALESCE($x, cột)` thay vì tách thành nhiều câu `UPDATE` riêng để
    // vẫn chỉ có đúng MỘT câu lệnh ghi `farm_states` trong transaction này.
    await client.query(
      `UPDATE farm_states
       SET state = $1,
           seeds = $2,
           version = version + 1,
           last_tick_at = $3,
           farm_name = COALESCE($5, farm_name),
           settings = COALESCE($6, settings),
           checkin_streak = COALESCE($7, checkin_streak),
           last_checkin_date = COALESCE($8, last_checkin_date),
           updated_at = NOW()
       WHERE user_id = $4`,
      [
        JSON.stringify(stateAfterCommand),
        finalBalance,
        now.toISOString(),
        userId,
        handlerResult.farmNameUpdate ?? null,
        handlerResult.settingsUpdate ? JSON.stringify(handlerResult.settingsUpdate) : null,
        handlerResult.checkinUpdate ? handlerResult.checkinUpdate.streak : null,
        handlerResult.checkinUpdate ? handlerResult.checkinUpdate.lastCheckinDate : null,
      ],
    );

    // Bước 8 — ghi sổ thu chi do handler yêu cầu, theo đúng thứ tự.
    //
    // `handlerResult.ledgerLines` mô tả các dòng sổ TƯƠNG ỨNG với chính
    // `seedsDelta` đã áp ở bước 6 (ví dụ một dòng `sell_product` với
    // `amount` bằng đúng `seedsDelta`) — số dư hiển thị trên từng dòng phải
    // phản ánh đúng tiến trình số dư thực tế tại thời điểm giao dịch đó xảy
    // ra, nên bắt đầu từ `row.seeds` (số dư trước lệnh) và cộng dần đúng
    // theo `amount` của từng dòng, kết thúc đúng tại `balanceResult.value`
    // (số dư sau lệnh, trước thưởng thành tựu). Thành tựu luôn được đánh
    // giá/ghi SAU khi lệnh đã áp xong nên dòng sổ của thành tựu (bước 9b)
    // tiếp tục cộng dồn từ đây một cách tự nhiên.
    const ledgerDelta: FarmLedgerEntry[] = [];
    let runningBalance = row.seeds;

    for (const line of handlerResult.ledgerLines ?? []) {
      runningBalance += line.amount;
      const insertedId = await appendFarmTransaction(client, {
        ...line,
        userId,
        balanceAfter: runningBalance,
      });
      if (insertedId !== null) {
        ledgerDelta.push({
          id: insertedId,
          occurred_at: now.toISOString(),
          kind: line.kind,
          amount: line.amount,
          balance_after: runningBalance,
          ref_type: line.refType ?? null,
          ref_id: line.refId ?? null,
          note: line.note ?? null,
          actor_user_id: line.actorUserId ?? null,
        });
      }
    }

    // Bước 9b — ghi dòng sổ cho mỗi thành tựu vừa mở khóa.
    for (const achievement of achievementResult.unlocked) {
      runningBalance += achievement.reward;
      const insertedId = await appendFarmTransaction(client, {
        userId,
        kind: 'achievement_reward',
        amount: achievement.reward,
        balanceAfter: runningBalance,
        refType: 'achievement',
        refId: achievement.code,
        note: `Thành tựu: ${achievement.name}`,
      });
      if (insertedId !== null) {
        ledgerDelta.push({
          id: insertedId,
          occurred_at: achievement.unlocked_at,
          kind: 'achievement_reward',
          amount: achievement.reward,
          balance_after: runningBalance,
          ref_type: 'achievement',
          ref_id: achievement.code,
          note: `Thành tựu: ${achievement.name}`,
          actor_user_id: null,
        });
      }
    }

    const successBody: FarmCommandSuccessResponse = {
      state: stateAfterCommand,
      version: row.version + 1,
      balance: finalBalance,
      ledger_delta: ledgerDelta,
      achievements_unlocked: achievementResult.unlocked,
      notices: handlerResult.notices ?? [],
    };

    // Bước 10 — cache idempotency rồi COMMIT.
    await cacheResult(client, userId, req.idempotency_key, req.command, successBody);
    await client.query('COMMIT');

    return { httpStatus: 200, body: successBody };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
