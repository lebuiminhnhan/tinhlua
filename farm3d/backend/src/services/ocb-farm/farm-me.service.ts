/**
 * OCB Farm — logic nghiệp vụ của `GET /api/ocb-farm/me`.
 *
 * Đây là nơi lắp ráp toàn bộ dữ liệu cần cho màn hình nông trại: tick trạng
 * thái tới hiện tại (D2), thâm niên/mốc Cây OCB (`farm-seniority.ts`), môi
 * trường (`farm-environment.ts`), trạng thái check-in (`farm-checkin.ts`),
 * bảng tổng kết offline, giới hạn vật phẩm và hồ sơ chủ nông trại.
 *
 * Route Express thực tế (`backend/src/routes/ocb-farm.routes.ts`) được viết
 * ở task 4.4 — file này CHỈ export hàm service, không có `express.Router`
 * nào ở đây, theo đúng khuôn mẫu route mỏng / service chứa logic (xem
 * `backend/src/services/device/device.service.ts`, `fund.service.ts`).
 *
 * _Requirements: US-4, US-21, US-23, US-25, US-30, US-31, US-33, US-40, US-42,
 * US-44, US-45_
 */

import { pool } from '../../config/database';
import { nowVN, startOfDayVN } from './farm-calendar';
import { milestoneReward, nextStreak } from './farm-checkin';
import { getFarmConfig } from './farm-config.service';
import { dayPhaseAt, seasonThemeAt, weatherAt } from './farm-environment';
import {
  branchCount,
  daysToNextMilestone,
  milestoneIndex,
  seniority,
  syncTreeWithSeniority,
  type FarmSeniorityConfig,
} from './farm-seniority';
import { tick, type FarmOfflineSimulationSummary } from './farm-simulation';
import { persistFarmState, readFarmStateForUpdate, touchFarmLastSeen } from './farm-state.repository';
import { countInboxNew } from './farm-inbox.service';
import type {
  FarmCheckinStatus,
  FarmEnvironment,
  FarmLimits,
  FarmMeResponse,
  FarmNotice,
  FarmOfflineSummary,
  FarmOwnerProfile,
  FarmSeniority,
  FarmStateJson,
  StorageKey,
} from '../../types/ocb-farm.types';

/**
 * ⚠ Cần xác nhận: seed thời tiết dùng chung cho toàn bộ nông trại — theo
 * đúng tinh thần BR-30 ("mọi nông trại thấy thời tiết giống nhau tại cùng
 * thời điểm"), `weatherAt`/`tick` chỉ cần MỘT seed cố định áp dụng toàn hệ
 * thống, không phải theo từng nhân viên. `farm-environment.ts` (task 2.5)
 * không export hằng số seed mặc định nào, nên tạm định nghĩa ở đây bằng 0
 * (khớp giá trị mặc định của tham số `weatherSeed` trong `tick()` và
 * `weatherAt()`/`rainWindowsBetween()`). Nếu về sau cần seed khác nhau giữa
 * môi trường dev/staging/prod, giá trị này nên chuyển thành một khóa trong
 * `farm_config` và đọc qua `getFarmConfigValue()` — không hardcode ở nhiều
 * nơi như hiện tại.
 */
export const WEATHER_SEED = 0;

// ============================================================================
// Kiểu response khi nông trại chưa được khởi tạo
// ============================================================================

/**
 * Response tối giản khi nhân viên chưa gọi `POST /me/init` (task 4.3) —
 * `initialized: false` là tín hiệu cho frontend mở `onboarding-wizard`
 * (US-1, US-2, US-3). Các trường còn lại của `FarmMeResponse` không có ý
 * nghĩa khi chưa khởi tạo nên không được điền ở đây; route handler (task
 * 4.4) chỉ cần kiểm tra `initialized` trước khi đọc các trường khác.
 */
export interface FarmMeUninitializedResponse {
  initialized: false;
  user_id: number;
  server_time: string;
}

export type FarmMeResult = FarmMeResponse | FarmMeUninitializedResponse;

// ============================================================================
// Hàm chính — `GET /me`
// ============================================================================

/**
 * Trả trạng thái nông trại của nhân viên `userId` sau khi server tick tới
 * thời điểm hiện tại (D1: server-authoritative; D2: tick là hàm thuần).
 *
 * Khi nhân viên chưa có nông trại, trả {@link FarmMeUninitializedResponse}
 * với `initialized: false` — KHÔNG tạo nông trại ở đây (đó là việc của
 * `POST /me/init`, task 4.3).
 *
 * Khi đã khởi tạo: mở một transaction, khóa dòng `farm_states` bằng
 * `FOR UPDATE`, tick trạng thái từ `last_tick_at` tới hiện tại, rồi ghi lại
 * `state`/`last_tick_at` (KHÔNG tăng `version` — xem giải thích ở
 * {@link import('./farm-state.repository').PersistFarmStateInput.incrementVersion}
 * — vì đây là một lượt tick nền do việc đọc `/me` kích hoạt, không phải một
 * lệnh nghiệp vụ từ `POST /commands`).
 *
 * _Requirements: US-4, US-21, US-23, US-25, US-30, US-31, US-33, US-40, US-42,
 * US-44, US-45_
 */
export async function getMeSnapshot(userId: number): Promise<FarmMeResult> {
  const now = nowVN();

  const client = await pool.connect();
  let tickedState: FarmStateJson;
  let offlineSimSummary: FarmOfflineSimulationSummary;
  let seeds: number;
  let version: number;
  let farmName: string;
  let joinDate: string | null;
  let joinDateSource: FarmMeResponse['join_date_source'];
  let joinDateAdminLocked: boolean;
  let checkinStreak: number;
  let lastCheckinDate: string | null;
  let lastSeenAtBeforeThisVisit: string | null;

  try {
    await client.query('BEGIN');

    const row = await readFarmStateForUpdate(client, userId);
    if (row === null) {
      await client.query('ROLLBACK');
      return { initialized: false, user_id: userId, server_time: now.toISOString() };
    }

    const config = await getFarmConfig();

    const tickResult = tick(row.state, new Date(row.last_tick_at), now, config.values, WEATHER_SEED);
    // Cây OCB lớn theo thâm niên: đồng bộ mốc + số nhánh với ngày vào làm mỗi lượt
    // `/me` (trước đây chỉ tính lại khi quản trị sửa ngày → kẹt ở mốc 0, 0 nhánh).
    tickedState = syncTreeWithSeniority(tickResult.state, row.join_date, now, seniorityConfigFrom(config.values));
    offlineSimSummary = tickResult.summary;

    // Cập nhật state/last_tick_at — KHÔNG tăng version (chỉ là tick nền, không
    // phải một lệnh nghiệp vụ). `total_assets_cached` chưa được tính ở task
    // này vì `farm-economy.ts` (task 2.7) chưa hoàn thành — để nguyên như cũ,
    // xem TODO trong `farm-state.repository.ts`.
    await persistFarmState(client, {
      userId,
      state: tickedState,
      seeds: row.seeds,
      incrementVersion: false,
      lastTickAt: now,
    });

    await client.query('COMMIT');

    seeds = row.seeds;
    version = row.version;
    farmName = row.farm_name ?? '';
    joinDate = row.join_date;
    joinDateSource = row.join_date_source;
    joinDateAdminLocked = row.join_date_admin_locked;
    checkinStreak = row.checkin_streak;
    lastCheckinDate = row.last_checkin_date;
    lastSeenAtBeforeThisVisit = row.last_seen_at;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Phản ánh sự hiện diện của nhân viên — không cần nằm trong transaction
  // chính vì không ảnh hưởng tới bất biến nghiệp vụ nào (xem repository).
  await touchFarmLastSeen(userId);

  const config = await getFarmConfig();

  const owner = await buildOwnerProfile(userId, farmName, joinDate, tickedState.badges_shown, now, config.values);
  const environment = buildEnvironment(now, config.values);
  const checkin = buildCheckinStatus(checkinStreak, lastCheckinDate, now, config.values);
  const offlineSummary = buildOfflineSummary(offlineSimSummary, now);
  const limits = buildLimits(tickedState, config.values);
  const adminNotices = await buildAdminAuditNotices(userId, lastSeenAtBeforeThisVisit);

  return {
    owner,
    initialized: true,
    join_date: joinDate,
    join_date_source: joinDateSource,
    join_date_admin_locked: joinDateAdminLocked,
    balance: seeds,
    version,
    state: tickedState,
    settings: await readSettings(userId),
    seniority: owner.seniority,
    limits,
    checkin,
    environment,
    offline_summary: offlineSummary,
    // Số mục chưa xem trong hộp thư (người đã giúp + lời chúc, task 7.3).
    inbox_new_count: await countInboxNew(userId),
    notices: adminNotices,
    last_tick_at: now.toISOString(),
    server_time: now.toISOString(),
  };
}

// ============================================================================
// `GET /config` — không cần logic mới
// ============================================================================

/**
 * `GET /config` không cần logic riêng: `getFarmConfig()` (task 4.1,
 * `farm-config.service.ts`) đã trả đúng hình dạng `FarmConfigResponse` mà
 * client cần để hiển thị giá và thời gian (US-45). Hàm này chỉ là một lối
 * gọi tường minh từ `farm-me.service.ts` để route handler (task 4.4) không
 * phải import trực tiếp `farm-config.service.ts` — giữ mọi logic của `/me`
 * và `/config` gom trong cùng một service theo gợi ý của task, tránh việc
 * route phải biết tới hai service khác nhau cho hai endpoint liền kề.
 */
export { getFarmConfig as getConfigSnapshot };

// ============================================================================
// Helpers — lắp ráp từng phần của `FarmMeResponse`
// ============================================================================

/** Thiết lập mặc định khi `farm_states.settings` là `{}` (chưa từng ghi qua `UPDATE_SETTINGS`, task 5.5). */
const DEFAULT_FARM_SETTINGS: FarmMeResponse['settings'] = {
  quality: 'medium',
  quality_manual: false,
  bgm: false,
  sfx: false,
  scene_lock: null,
};

async function readSettings(userId: number): Promise<FarmMeResponse['settings']> {
  const result = await pool.query<{ settings: FarmMeResponse['settings'] }>(
    'SELECT settings FROM farm_states WHERE user_id = $1',
    [userId],
  );
  return result.rows[0]?.settings ?? DEFAULT_FARM_SETTINGS;
}

function seniorityConfigFrom(values: Record<string, number>): FarmSeniorityConfig {
  return {
    treeMaxMilestone: values['tree_max_milestone'] ?? 40,
    treeMaxBranches: values['tree_max_branches'] ?? 30,
  };
}

function buildSeniority(joinDate: string | null, now: Date, values: Record<string, number>): FarmSeniority {
  if (joinDate === null) {
    return {
      join_date: null,
      years: 0,
      months: 0,
      total_months: 0,
      milestone: 0,
      branches: 0,
      days_to_next_milestone: null,
      at_max_milestone: false,
    };
  }

  const joinDateObj = new Date(`${joinDate}T00:00:00.000Z`);
  const config = seniorityConfigFrom(values);
  const s = seniority(joinDateObj, now);
  const milestone = milestoneIndex(joinDateObj, now, config);
  const branches = branchCount(joinDateObj, now, config);
  const daysToNext = daysToNextMilestone(joinDateObj, now, config);

  return {
    join_date: joinDate,
    years: s.years,
    months: s.months,
    total_months: s.totalMonths,
    milestone,
    branches,
    days_to_next_milestone: daysToNext,
    at_max_milestone: daysToNext === null,
  };
}

interface OwnerRow {
  full_name: string | null;
  username: string;
  department_id: number | null;
  department_name: string | null;
}

export async function buildOwnerProfile(
  userId: number,
  farmName: string,
  joinDate: string | null,
  badgesShown: FarmOwnerProfile['badges_shown'],
  now: Date,
  configValues: Record<string, number>,
): Promise<FarmOwnerProfile> {
  const result = await pool.query<OwnerRow>(
    `SELECT u.full_name, u.username, u.department_id, d.name AS department_name
     FROM users u
     LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.id = $1`,
    [userId],
  );

  const row = result.rows[0];

  return {
    user_id: userId,
    full_name: row?.full_name || row?.username || '',
    department_id: row?.department_id ?? null,
    department_name: row?.department_name ?? null,
    farm_name: farmName,
    seniority: buildSeniority(joinDate, now, configValues),
    badges_shown: badgesShown,
  };
}

/**
 * Tính ranh giới chu kỳ thời tiết hiện tại theo cùng công thức lượng tử hoá
 * dùng trong `weatherAt` (`farm-environment.ts`, task 2.5) — module đó CHƯA
 * export `weatherCycleStart`/`weatherCycleEnd` (hai hàm private hiện có).
 *
 * Quyết định: KHÔNG sửa `farm-environment.ts` ở task này (module thuộc phạm
 * vi task 2.5, đã hoàn thành) — thay vào đó tính lại đúng công thức lượng tử
 * hoá ở đây (`floor(ts / cycleMs) * cycleMs`), dùng `weather_cycle` (phút)
 * từ cấu hình đang áp dụng. Vì đây chỉ là phép tính ranh giới thời gian
 * thuần (không có logic ngẫu nhiên/băm nào), việc lặp lại công thức không
 * tạo rủi ro lệch kết quả với `weatherAt`. Nếu về sau `farm-environment.ts`
 * export hai hàm private này, nên xoá phần tính lại ở đây và gọi trực tiếp.
 */
function weatherCycleBoundaries(now: Date, cycleMinutes: number): { start: Date; end: Date } {
  const cycleMs = Math.max(1, cycleMinutes) * 60 * 1000;
  const start = Math.floor(now.getTime() / cycleMs) * cycleMs;
  return { start: new Date(start), end: new Date(start + cycleMs) };
}

export function buildEnvironment(now: Date, values: Record<string, number>): FarmEnvironment {
  const dayPhaseConfig = {
    morningStart: values['day_phase_morning_start'] ?? 5,
    noonStart: values['day_phase_noon_start'] ?? 11,
    afternoonStart: values['day_phase_afternoon_start'] ?? 14,
    nightStart: values['day_phase_night_start'] ?? 18,
  };
  const weatherConfig = { cycleMinutes: values['weather_cycle'] ?? 60 };

  const dayPhase = dayPhaseAt(now, dayPhaseConfig);
  const weather = weatherAt(now, WEATHER_SEED, weatherConfig);
  const season = seasonThemeAt(now);
  const { start, end } = weatherCycleBoundaries(now, weatherConfig.cycleMinutes);

  return {
    day_phase: dayPhase,
    weather,
    season_theme: season?.theme ?? null,
    season_theme_name: season?.name ?? null,
    weather_cycle_started_at: start.toISOString(),
    weather_cycle_ends_at: end.toISOString(),
    server_time: now.toISOString(),
  };
}

function buildCheckinStatus(
  streak: number,
  lastCheckinDate: string | null,
  now: Date,
  values: Record<string, number>,
): FarmCheckinStatus {
  const todayVN = startOfDayVN(now).toISOString().slice(0, 10);
  const claimedToday = lastCheckinDate === todayVN;

  const streakForNextClaim = claimedToday ? streak : nextStreak(lastCheckinDate, todayVN, streak);
  const nextStreakBonus = claimedToday ? 0 : milestoneReward(streakForNextClaim, values);

  const nextDayStart = new Date(startOfDayVN(now).getTime() + 24 * 60 * 60 * 1000);

  return {
    claimed_today: claimedToday,
    streak,
    last_checkin_date: lastCheckinDate,
    next_reward: claimedToday ? 0 : values['checkin_reward'] ?? 0,
    next_streak_bonus: nextStreakBonus,
    resets_at: nextDayStart.toISOString(),
  };
}

/**
 * Chuyển {@link FarmOfflineSimulationSummary} (đầu ra thô của `tick()`) sang
 * {@link FarmOfflineSummary} (hình dạng công khai qua API) — hai kiểu khác
 * nhau ở cách biểu diễn "đã đạt trần": summary thô liệt kê từng đối tượng đã
 * đạt trần (`capped_entities: { entity_kind, entity_id, storage_key }[]`),
 * còn hình dạng công khai gắn cờ `capped` theo TỪNG LOẠI SẢN PHẨM (`items[].capped`)
 * và liệt kê id các đối tượng đã đạt trần riêng (`capped_entity_ids`).
 *
 * Trả `null` khi `away_ms === 0` — chưa có thời gian nào trôi qua để tổng
 * kết (ví dụ vừa khởi tạo xong, hoặc client gọi lại `/me` liên tục trong
 * cùng một giây) — khớp AC "trần tối thiểu 1" của US-23 chỉ áp dụng khi
 * thực sự có khoảng vắng mặt.
 *
 * _Requirements: US-23_
 */
function buildOfflineSummary(
  summary: FarmOfflineSimulationSummary,
  tickedTo: Date,
): FarmOfflineSummary | null {
  if (summary.away_ms <= 0) return null;

  const cappedKeysByStorageKey = new Set<StorageKey>(
    summary.capped_entities.map((e) => e.storage_key),
  );

  const from = new Date(tickedTo.getTime() - summary.away_ms);

  return {
    from: from.toISOString(),
    to: tickedTo.toISOString(),
    away_ms: summary.away_ms,
    items: summary.items.map((item) => ({
      key: item.key,
      quantity: item.quantity,
      capped: cappedKeysByStorageKey.has(item.key),
    })),
    capped_entity_ids: summary.capped_entities.map((e) => e.entity_id),
    rain_cycles: summary.rain_cycles,
  };
}

interface AdminAuditNoticeRow {
  action: string;
  before_value: Record<string, unknown> | null;
  after_value: Record<string, unknown> | null;
  occurred_at: Date;
}

/**
 * Dựng thông báo "chưa xem" cho nhân viên dựa trên các dòng `farm_admin_audit`
 * nhắm vào `userId` xảy ra SAU `lastSeenAt` (mốc hiện diện trước lần `GET /me`
 * này — đọc TRƯỚC khi `touchFarmLastSeen` cập nhật nó, nên "sau `lastSeenAt`"
 * đúng nghĩa "từ lần truy cập trước tới nay").
 *
 * Xử lý 3 hành động quản trị tác động trực tiếp tới nhân viên:
 * - `update_join_date` (task 8.1, US-42) → `JOIN_DATE_ADJUSTED_BY_ADMIN`.
 * - `adjust_seeds` (task 8.2, US-43) → `SEEDS_ADJUSTED_BY_ADMIN`.
 * - `reset_farm` (task 8.2, US-44) → `FARM_RESET_BY_ADMIN`.
 * Cả ba mã đều đã có trong `FARM_NOTICE_CODES`. Hành động không khớp danh
 * sách này (ví dụ `update_config`, không nhắm vào một nhân viên cụ thể) bị
 * lọc bỏ ở câu `WHERE action IN (...)`.
 *
 * `lastSeenAt === null` (nhân viên chưa từng mở `/me` — không nên xảy ra ở
 * đây vì `readFarmStateForUpdate` đã trả về một dòng tồn tại, nhưng phòng
 * thủ cho dữ liệu cũ) coi như "chưa từng xem", nên mọi dòng audit nhắm vào
 * nhân viên này đều được tính là thông báo mới.
 *
 * _Requirements: US-42, US-43, US-44, BR-26, BR-27_
 */
async function buildAdminAuditNotices(userId: number, lastSeenAt: string | null): Promise<FarmNotice[]> {
  const result = await pool.query<AdminAuditNoticeRow>(
    `SELECT action, before_value, after_value, occurred_at
     FROM farm_admin_audit
     WHERE target_user_id = $1
       AND action IN ('update_join_date', 'adjust_seeds', 'reset_farm')
       AND ($2::timestamptz IS NULL OR occurred_at > $2::timestamptz)
     ORDER BY occurred_at ASC`,
    [userId, lastSeenAt],
  );

  return result.rows.map((row): FarmNotice => buildAdminAuditNotice(row));
}

function buildAdminAuditNotice(row: AdminAuditNoticeRow): FarmNotice {
  const occurredAtIso = row.occurred_at.toISOString();

  switch (row.action) {
    case 'adjust_seeds': {
      const amount = (row.after_value?.['amount'] as number | undefined) ?? 0;
      const balanceAfter = (row.after_value?.['balance_after'] as number | undefined) ?? null;
      const reason = (row.before_value?.['reason'] as string | undefined) ?? '';
      const direction = amount >= 0 ? 'cộng thêm' : 'trừ';
      return {
        code: 'SEEDS_ADJUSTED_BY_ADMIN',
        level: 'info',
        message:
          `Quản trị viên đã ${direction} ${Math.abs(amount)} Hạt OCB vào nông trại của bạn. ` +
          `Lý do: ${reason}`,
        data: { amount, balance_after: balanceAfter, reason, occurred_at: occurredAtIso },
      };
    }
    case 'reset_farm': {
      return {
        code: 'FARM_RESET_BY_ADMIN',
        level: 'warning',
        message:
          'Quản trị viên đã đặt lại nông trại của bạn về trạng thái khởi tạo. ' +
          'Ngày vào làm, thâm niên, mốc Cây OCB, thành tựu và huy hiệu được giữ nguyên.',
        data: { occurred_at: occurredAtIso },
      };
    }
    case 'update_join_date':
    default: {
      const newJoinDate = (row.after_value?.['join_date'] as string | undefined) ?? '';
      const previousJoinDate = (row.before_value?.['join_date'] as string | null | undefined) ?? null;
      return {
        code: 'JOIN_DATE_ADJUSTED_BY_ADMIN',
        level: 'info',
        message:
          `Quản trị viên đã cập nhật ngày vào làm của bạn thành ${newJoinDate}. ` +
          'Thâm niên và mốc Cây OCB đã được tính lại.',
        data: {
          previous_join_date: previousJoinDate,
          new_join_date: newJoinDate,
          occurred_at: occurredAtIso,
        },
      };
    }
  }
}

function buildLimits(state: FarmStateJson, values: Record<string, number>): FarmLimits {
  const storageTotal = Object.values(state.storage).reduce(
    (sum, quantity) => sum + (quantity ?? 0),
    0,
  );

  return {
    animals: { current: state.animals.length, max: values['max_animals'] ?? 30 },
    plants: { current: state.plants.length, max: values['max_plants'] ?? 40 },
    decors: { current: state.decors.length, max: values['max_decors'] ?? 60 },
    storage: { current: storageTotal, max: values['storage_cap'] ?? 500 },
    badges_shown: { current: state.badges_shown.length, max: values['badges_shown_max'] ?? 3 },
  };
}
