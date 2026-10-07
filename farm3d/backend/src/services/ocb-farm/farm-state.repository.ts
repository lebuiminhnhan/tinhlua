/**
 * OCB Farm — repository truy cập bảng `farm_states` và `farm_transactions`.
 *
 * Module này CHỈ chứa truy vấn DB thuần — không có quy tắc nghiệp vụ nào
 * (ví dụ "tick bao lâu", "được phép mua hay không") sống ở đây. Các quy tắc
 * đó thuộc về `farm-me.service.ts` (task 4.2, đọc trạng thái cho `GET /me`)
 * và `farm-command.service.ts` (task 5.x, áp lệnh thay đổi trạng thái).
 *
 * Quy ước khóa lạc quan (D3): `readFarmStateForUpdate` phải được gọi trong
 * một transaction đã `BEGIN` (dùng chung `client` với caller) để `FOR UPDATE`
 * có hiệu lực khóa dòng cho tới khi caller `COMMIT`/`ROLLBACK`.
 *
 * _Requirements: US-4, US-21, US-23, US-25, US-30, US-31, US-33, US-40, US-42,
 * US-44, US-45_
 */

import { PoolClient } from 'pg';
import { pool } from '../../config/database';
import { ensurePlotLayout } from './farm-plot-layout';
import type {
  FarmLedgerKind,
  FarmSettings,
  FarmStateJson,
  FarmStateRow,
  JoinDateSource,
} from '../../types/ocb-farm.types';

// ============================================================================
// Ánh xạ dòng DB → FarmStateRow
// ============================================================================

/** Hình dạng thô của một dòng `farm_states` như driver `pg` trả về. */
interface RawFarmStateRow {
  user_id: number;
  farm_name: string | null;
  join_date: Date | null;
  join_date_source: JoinDateSource | null;
  join_date_admin_locked: boolean;
  seeds: string; // BIGINT trả về dạng string qua driver `pg`
  checkin_streak: number;
  last_checkin_date: Date | null;
  total_assets_cached: string; // BIGINT
  state: FarmStateJson;
  settings: FarmSettings;
  version: number;
  last_tick_at: Date;
  last_seen_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Chuyển `DATE` của Postgres thành `YYYY-MM-DD`.
 *
 * Driver `pg` parse cột `DATE` (không có giờ) thành `Date` theo GIỜ ĐỊA PHƯƠNG của tiến
 * trình Node (ví dụ DB lưu `2026-10-06` → `pg` tạo `new Date(2026, 9, 6)` ở local time),
 * KHÔNG phải một instant UTC. Server OCB Farm luôn chạy ở giờ Việt Nam (múi giờ máy chủ
 * đặt `Asia/Bangkok`/UTC+7 — xem ghi chú đầu `farm-calendar.ts`), nên `getFullYear()` /
 * `getMonth()` / `getDate()` (ĐỌC THEO LOCAL) cho đúng ngày đã lưu trong DB.
 *
 * TRƯỚC bản sửa này, hàm dùng `value.toISOString().slice(0, 10)` — `toISOString()` luôn
 * quy đổi sang UTC, lùi lại 7 giờ so với local (UTC+7) → với mọi ngày, kết quả bị LÙI MẤT
 * ĐÚNG 1 NGÀY (`2026-10-06` đọc ra thành `"2026-10-05"`). Hậu quả: `GET /me` báo
 * `last_checkin_date` sai 1 ngày trong quá khứ → hiển thị "chưa check-in hôm nay"
 * (`claimed_today: false`) trong khi DB đã lưu đúng ngày hôm nay, nhưng khi nhân viên
 * bấm nhận thưởng thì `CLAIM_CHECKIN` (dùng `ctx.lastCheckinDate` đọc qua CHÍNH hàm này)
 * lại thấy đúng là đã check-in rồi → trả lỗi `CHECKIN_ALREADY_CLAIMED`, khiến hộp thưởng
 * check-in cứ hiện lại dù nhân viên đã nhận thưởng thành công trước đó.
 */
function dateOnlyToIsoDateString(value: Date | null): string | null {
  if (value === null) return null;
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function rowToFarmStateRow(row: RawFarmStateRow): FarmStateRow {
  return {
    user_id: row.user_id,
    farm_name: row.farm_name,
    join_date: dateOnlyToIsoDateString(row.join_date),
    join_date_source: row.join_date_source,
    join_date_admin_locked: row.join_date_admin_locked,
    seeds: Number(row.seeds),
    checkin_streak: row.checkin_streak,
    last_checkin_date: dateOnlyToIsoDateString(row.last_checkin_date),
    total_assets_cached: Number(row.total_assets_cached),
    // Bổ sung các vùng mở rộng đang khoá cho nông trại cũ (US-24) — xem `farm-plot-layout.ts`.
    state: ensurePlotLayout(row.state),
    settings: row.settings,
    version: row.version,
    last_tick_at: row.last_tick_at.toISOString(),
    last_seen_at: row.last_seen_at === null ? null : row.last_seen_at.toISOString(),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

const FARM_STATE_COLUMNS =
  'user_id, farm_name, join_date, join_date_source, join_date_admin_locked, ' +
  'seeds, checkin_streak, last_checkin_date, total_assets_cached, state, settings, ' +
  'version, last_tick_at, last_seen_at, created_at, updated_at';

// ============================================================================
// 1. Đọc (không khóa) — dùng cho kiểm tra tồn tại nhẹ, không nằm trong transaction ghi
// ============================================================================

/**
 * Đọc dòng `farm_states` của một nhân viên, KHÔNG khóa dòng (`SELECT` thường).
 *
 * Dùng cho các ngữ cảnh chỉ-đọc không cần nhất quán tuyệt đối với các lệnh
 * ghi đang chạy đồng thời (ví dụ kiểm tra nhanh "đã có nông trại chưa" trước
 * khi quyết định có mở transaction ghi hay không). KHÔNG dùng kết quả này để
 * áp lệnh thay đổi trạng thái — với ngữ cảnh đó phải dùng
 * {@link readFarmStateForUpdate} trong một transaction.
 *
 * Trả `null` khi nhân viên chưa có nông trại (`initialized: false`).
 *
 * _Requirements: US-4, US-40_
 */
export async function readFarmState(userId: number): Promise<FarmStateRow | null> {
  const result = await pool.query<RawFarmStateRow>(
    `SELECT ${FARM_STATE_COLUMNS} FROM farm_states WHERE user_id = $1`,
    [userId],
  );

  const row = result.rows[0];
  return row ? rowToFarmStateRow(row) : null;
}

// ============================================================================
// 2. Đọc + khóa trong transaction (D3 — khóa lạc quan qua `version`, và khóa
//    bi quan `FOR UPDATE` trong lúc transaction đang mở để tuần tự hóa các
//    lệnh ghi đồng thời trên cùng một nông trại)
// ============================================================================

/**
 * Đọc dòng `farm_states` của một nhân viên VÀ khóa dòng bằng `FOR UPDATE`,
 * trong một transaction đã `BEGIN` bởi caller (`client`).
 *
 * Caller (ví dụ `farm-me.service.ts` ở task này, `farm-command.service.ts`
 * ở task 5.x) chịu trách nhiệm `BEGIN` trước khi gọi, và `COMMIT`/`ROLLBACK`
 * + giải phóng `client` sau khi dùng xong — theo đúng khuôn mẫu khóa dòng
 * đã dùng ở `backend/src/services/budget/legacy.service.ts`
 * (`pool.connect()` → `BEGIN` → `SELECT ... FOR UPDATE` → ... →
 * `COMMIT`/`ROLLBACK` → `client.release()` trong `finally`).
 *
 * Trả `null` khi nhân viên chưa có nông trại — caller tự quyết định hành vi
 * (ví dụ `GET /me` trả `initialized: false`, còn `POST /me/init` ở task 4.3
 * coi đây là điều kiện để `INSERT` dòng mới).
 *
 * _Requirements: US-40, US-42, US-44_
 */
export async function readFarmStateForUpdate(
  client: PoolClient,
  userId: number,
): Promise<FarmStateRow | null> {
  const result = await client.query<RawFarmStateRow>(
    `SELECT ${FARM_STATE_COLUMNS} FROM farm_states WHERE user_id = $1 FOR UPDATE`,
    [userId],
  );

  const row = result.rows[0];
  return row ? rowToFarmStateRow(row) : null;
}

// ============================================================================
// 2.1 Tạo dòng mới — khởi tạo nông trại (task 4.3)
// ============================================================================

/** Đầu vào để tạo dòng `farm_states` đầu tiên cho một nhân viên. */
export interface InsertInitialFarmStateInput {
  userId: number;
  farmName: string;
  /** `YYYY-MM-DD` theo giờ Việt Nam. */
  joinDate: string;
  joinDateSource: JoinDateSource;
  seeds: number;
  state: FarmStateJson;
  settings: FarmSettings;
  lastTickAt: Date;
}

/**
 * Tạo dòng `farm_states` đầu tiên cho một nhân viên, idempotent ở TẦNG DB
 * bằng `INSERT ... ON CONFLICT (user_id) DO NOTHING RETURNING *`.
 *
 * `user_id` là PRIMARY KEY của `farm_states` (xem
 * `20261001_001_create_farm_states.sql`), nên đây là lớp bảo vệ THỨ HAI
 * (độc lập với việc caller có tự kiểm tra tồn tại trước khi gọi hay không)
 * chống việc hai request `POST /me/init` đồng thời (hai thẻ/hai thiết bị,
 * US-1) tạo ra hai nông trại cho cùng một nhân viên — đúng một trong hai
 * `INSERT` sẽ thắng cuộc đua ở mức transaction của Postgres, request còn lại
 * nhận `ON CONFLICT DO NOTHING` và không có dòng nào trong `RETURNING`.
 *
 * Trả dòng vừa tạo (đã ép kiểu) khi INSERT thành công, hoặc `null` khi đã
 * tồn tại một dòng cho `userId` từ trước (không có gì được tạo/thay đổi) —
 * caller ({@link import('./farm-init.service').initFarm}) dùng `null` như
 * tín hiệu "đây là lần gọi thứ hai, đọc lại dòng đã có và trả về như thành
 * công" (KHÔNG coi là lỗi).
 *
 * PHẢI gọi trong một transaction đã `BEGIN` bởi caller, để caller tự quyết
 * định `COMMIT` (khi tạo mới, sau khi ghi thêm `farm_transactions`) hoặc
 * `ROLLBACK` (khi đã tồn tại, không có gì để ghi thêm).
 *
 * _Requirements: US-1, BR-7_
 */
export async function insertInitialFarmState(
  client: PoolClient,
  input: InsertInitialFarmStateInput,
): Promise<FarmStateRow | null> {
  const { userId, farmName, joinDate, joinDateSource, seeds, state, settings, lastTickAt } = input;

  const result = await client.query<RawFarmStateRow>(
    `INSERT INTO farm_states
       (user_id, farm_name, join_date, join_date_source, seeds, state, settings, version, last_tick_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8)
     ON CONFLICT (user_id) DO NOTHING
     RETURNING ${FARM_STATE_COLUMNS}`,
    [userId, farmName, joinDate, joinDateSource, seeds, JSON.stringify(state), JSON.stringify(settings), lastTickAt.toISOString()],
  );

  const row = result.rows[0];
  return row ? rowToFarmStateRow(row) : null;
}

// ============================================================================
// 3. Ghi — cập nhật trạng thái sau tick/lệnh
// ============================================================================

/** Đầu vào để cập nhật `farm_states` sau khi tick hoặc áp một lệnh. */
export interface PersistFarmStateInput {
  userId: number;
  state: FarmStateJson;
  seeds: number;
  /**
   * `true` khi lệnh gọi này áp một lệnh nghiệp vụ thay đổi trạng thái (tăng
   * `version` đúng 1) — `false` khi chỉ là "tick-only" (ví dụ `GET /me` tick
   * tiến trình tới hiện tại mà không áp lệnh nào) nên KHÔNG tăng `version`.
   *
   * Quy ước này khớp thiết kế D3 (khóa lạc quan): `version` chỉ đổi khi có
   * một lệnh ghi thực sự từ `farm-command.service.ts` (task 5.x), để client
   * giữ đúng `version` đang có và không bị 409 giả do một lượt tick nền.
   */
  incrementVersion: boolean;
  /** Mốc tick tới — luôn cập nhật để lượt tick kế tiếp tính đúng từ đây. */
  lastTickAt: Date;
  /**
   * Tổng giá trị tài sản đã tính lại — `undefined` nghĩa là KHÔNG cập nhật
   * cột này (giữ giá trị cũ). Tại task 4.2, `farm-economy.ts` (tính tổng tài
   * sản, US-28) chưa được viết (task 2.7 — chưa hoàn thành), nên
   * `farm-me.service.ts` gọi hàm này không truyền `totalAssetsCached`, để
   * cột `total_assets_cached` giữ nguyên như một TODO cho tới khi module đó
   * có sẵn.
   */
  totalAssetsCached?: number;
}

/**
 * Cập nhật `state`, `seeds`, `version` (nếu `incrementVersion`), `last_tick_at`
 * và (tuỳ chọn) `total_assets_cached` của một nông trại đã tồn tại.
 *
 * PHẢI gọi trong cùng transaction đã `readFarmStateForUpdate` (dùng chung
 * `client`) để khóa dòng vẫn còn hiệu lực khi ghi — nếu không, một lệnh ghi
 * khác có thể chen giữa lúc đọc và lúc ghi.
 *
 * _Requirements: US-23, US-40_
 */
export async function persistFarmState(
  client: PoolClient,
  input: PersistFarmStateInput,
): Promise<void> {
  const { userId, state, seeds, incrementVersion, lastTickAt, totalAssetsCached } = input;

  if (totalAssetsCached === undefined) {
    await client.query(
      `UPDATE farm_states
       SET state = $1,
           seeds = $2,
           version = version + $3,
           last_tick_at = $4,
           updated_at = NOW()
       WHERE user_id = $5`,
      [JSON.stringify(state), seeds, incrementVersion ? 1 : 0, lastTickAt.toISOString(), userId],
    );
    return;
  }

  await client.query(
    `UPDATE farm_states
     SET state = $1,
         seeds = $2,
         version = version + $3,
         last_tick_at = $4,
         total_assets_cached = $5,
         updated_at = NOW()
     WHERE user_id = $6`,
    [
      JSON.stringify(state),
      seeds,
      incrementVersion ? 1 : 0,
      lastTickAt.toISOString(),
      totalAssetsCached,
      userId,
    ],
  );
}

// ============================================================================
// 4. Ghi sổ thu chi — append-only (BR-27)
// ============================================================================

/** Đầu vào để ghi một dòng `farm_transactions`. */
export interface AppendFarmTransactionInput {
  userId: number;
  kind: FarmLedgerKind;
  /** Dương = thu, âm = chi. */
  amount: number;
  /** Số dư sau giao dịch — phải khớp `seeds` vừa ghi ở `persistFarmState` trong cùng transaction. */
  balanceAfter: number;
  refType?: string;
  refId?: string;
  note?: string;
  /** Khác `userId` khi là admin điều chỉnh hoặc đồng nghiệp giúp — `undefined` nghĩa là chính chủ. */
  actorUserId?: number;
  /** Khóa chống lặp khi client thử lại lệnh — `undefined` nghĩa là không áp dụng idempotency cho dòng này. */
  idempotencyKey?: string;
}

/**
 * Ghi một dòng `farm_transactions` — bảng APPEND-ONLY (BR-27): không có hàm
 * update/delete tương ứng trong repository này, và migration
 * `20261001_002_create_farm_transactions.sql` không có route UPDATE/DELETE.
 *
 * Idempotency: `farm_transactions` có `UNIQUE(user_id, idempotency_key)`
 * (loại trừ `idempotency_key IS NULL`). Khi `idempotencyKey` được truyền và
 * đã tồn tại một dòng trùng khóa cho đúng `userId`, vi phạm unique constraint
 * (mã lỗi Postgres `23505`) được coi là "đã ghi rồi, request lặp lại" — hàm
 * trả về `null` một cách êm ái (no-op) thay vì ném lỗi, để caller
 * (`farm-command.service.ts`, task 5.x) không phải tự bắt lỗi DB thô. Mọi vi
 * phạm ràng buộc khác (ví dụ `balance_after < 0` — không nên xảy ra nếu
 * caller đã kiểm tra bất biến trước khi gọi) được ném lại nguyên vẹn.
 *
 * Trả về `id` của dòng vừa ghi, hoặc `null` khi là no-op do trùng
 * `idempotency_key`.
 *
 * _Requirements: US-21, US-40, BR-27_
 */
export async function appendFarmTransaction(
  client: PoolClient,
  input: AppendFarmTransactionInput,
): Promise<number | null> {
  const { userId, kind, amount, balanceAfter, refType, refId, note, actorUserId, idempotencyKey } =
    input;

  try {
    const result = await client.query<{ id: number }>(
      `INSERT INTO farm_transactions
         (user_id, kind, amount, balance_after, ref_type, ref_id, note, actor_user_id, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        userId,
        kind,
        amount,
        balanceAfter,
        refType ?? null,
        refId ?? null,
        note ?? null,
        actorUserId ?? null,
        idempotencyKey ?? null,
      ],
    );
    return result.rows[0]?.id ?? null;
  } catch (err) {
    const pgError = err as { code?: string };
    if (pgError.code === '23505' && idempotencyKey) {
      // Trùng (user_id, idempotency_key) — request lặp lại, coi là no-op.
      return null;
    }
    throw err;
  }
}

// ============================================================================
// 5. Cập nhật `last_seen_at` — phản ánh sự hiện diện của nhân viên
// ============================================================================

/**
 * Cập nhật `last_seen_at = NOW()` cho một nông trại — gọi mỗi khi `GET /me`
 * được truy cập, vì đây là tín hiệu nhân viên vừa hiện diện trong nông trại.
 *
 * Không cần chạy trong transaction của lượt tick: đây là cột chỉ mang tính
 * thông tin (không ảnh hưởng tới bất kỳ bất biến nghiệp vụ nào), nên gọi rời
 * ngoài transaction chính vẫn an toàn và không cần khóa dòng.
 *
 * _Requirements: US-40_
 */
export async function touchFarmLastSeen(userId: number): Promise<void> {
  await pool.query('UPDATE farm_states SET last_seen_at = NOW() WHERE user_id = $1', [userId]);
}
