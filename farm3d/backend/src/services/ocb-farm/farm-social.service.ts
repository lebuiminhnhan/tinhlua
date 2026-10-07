/**
 * OCB Farm — tương tác xã hội: danh sách / ghé thăm nông trại đồng nghiệp,
 * giúp tưới cây / cho ăn, gửi lời chúc (task 7.1–7.3).
 *
 * Quy ước:
 * - Ngày nghiệp vụ (`help_date`, `greet_date`) tính theo lịch UTC+7, dạng
 *   `YYYY-MM-DD` ({@link vnDateString}).
 * - Lỗi nghiệp vụ ném {@link FarmConfigError} (mã `FarmErrorCode`) để route
 *   map thẳng sang 422, giống các nhóm API trước.
 * - Ghé thăm là CHỈ ĐỌC: tick trong bộ nhớ để hiển thị đúng trạng thái hiện
 *   tại, không ghi gì vào nông trại của chủ (BR-21). Hành động ghi duy nhất
 *   của người ghé thăm là giúp đỡ và gửi lời chúc.
 *
 * _Requirements: US-8, US-26, US-27, US-29, US-48, BR-21, BR-22, BR-23_
 */

import { PoolClient } from 'pg';
import { pool } from '../../config/database';
import { anniversaryOf, nowVN, startOfDayVN } from './farm-calendar';
import { applyAchievements } from './farm-command.service';
import { FarmConfigError, getFarmConfig } from './farm-config.service';
import { buildEnvironment, buildOwnerProfile, WEATHER_SEED } from './farm-me.service';
import { seniority, syncTreeWithSeniority } from './farm-seniority';
import { tick } from './farm-simulation';
import {
  appendFarmTransaction,
  persistFarmState,
  readFarmState,
  readFarmStateForUpdate,
} from './farm-state.repository';
import { containsForbiddenWord } from './commands/settings.commands';
import type {
  AchievementCode,
  FarmAnimal,
  FarmGreetingRequest,
  FarmGreetingResponse,
  FarmHelpAvailability,
  FarmHelpRequest,
  FarmHelpResponse,
  FarmListItem,
  FarmListPage,
  FarmPlant,
  FarmStateJson,
  FarmStateRow,
  FarmVisitResponse,
  GreetingKind,
  HelpActionType,
} from '../../types/ocb-farm.types';

// ============================================================================
// Hằng số và tiện ích thời gian
// ============================================================================

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const FULLNESS_MAX = 100;

const FARMS_DEFAULT_PAGE_SIZE = 20;
const FARMS_MAX_PAGE_SIZE = 50;
const SEARCH_MIN_CHARS = 2;

/**
 * Cửa sổ "gần như cùng thời điểm" (US-27): khi nông trại không còn gì để
 * giúp NHƯNG đã có người khác giúp cùng loại hành động trong khoảng này, lượt
 * giúp vẫn được ghi nhận và thưởng (hai người bấm cùng lúc đều được tính),
 * còn trạng thái nước / độ no không vượt trần vì đã ở mức tối đa.
 */
const HELP_CONCURRENT_WINDOW_MS = 30 * 1000;

/** Ngày lịch theo giờ Việt Nam (`YYYY-MM-DD`) của thời điểm `ts`. */
function vnDateString(ts: Date): string {
  return new Date(ts.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** 00:00 UTC+7 của ngày kế tiếp (ISO) — mốc làm mới hạn mức trong ngày. */
function nextResetIso(now: Date): string {
  return new Date(startOfDayVN(now).getTime() + DAY_MS).toISOString();
}

/** Ngày vào làm `YYYY-MM-DD` → `Date` theo cùng quy ước của `farm-me.service.ts`. */
function joinDateToDate(joinDate: string): Date {
  return new Date(joinDate + 'T00:00:00.000Z');
}

interface AnniversaryInfo {
  isToday: boolean;
  /** Số năm đồng hành nếu hôm nay là ngày kỷ niệm, ngược lại `null`. */
  years: number | null;
}

/** Hôm nay (UTC+7) có phải ngày kỷ niệm vào làm (tròn ≥ 1 năm) không (US-8). */
function anniversaryInfo(joinDate: string | null, now: Date): AnniversaryInfo {
  if (!joinDate) return { isToday: false, years: null };
  const joinObj = joinDateToDate(joinDate);
  const yearVN = new Date(now.getTime() + VN_OFFSET_MS).getUTCFullYear();
  const years = yearVN - joinObj.getUTCFullYear();
  if (years < 1) return { isToday: false, years: null };
  const isToday = anniversaryOf(joinObj, yearVN).getTime() === startOfDayVN(now).getTime();
  return { isToday, years: isToday ? years : null };
}

function seniorityMonths(joinDate: string | null, now: Date): number {
  if (!joinDate) return 0;
  return seniority(joinDateToDate(joinDate), now).totalMonths;
}

function parsePositiveInt(raw: string | undefined, fallback: number, field: string): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new FarmConfigError('INVALID_PAYLOAD', 'Giá trị "' + field + '" phải là số nguyên dương.', {
      field,
      value: raw,
    });
  }
  return value;
}

/** Thoát ký tự đại diện của `LIKE`/`ILIKE` (`\`, `%`, `_`) để khớp đúng chuỗi người dùng nhập. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => '\\' + ch);
}

// ============================================================================
// Trạng thái cây / vật nuôi cần giúp
// ============================================================================

/** Cây đang thiếu nước tại `now` — cùng ngữ nghĩa `isPlantWatered` của `plant.commands.ts`. */
function isPlantThirsty(plant: FarmPlant, now: Date, values: Record<string, number>): boolean {
  const intervalMs = (values['water_interval'] ?? 8) * 60 * 60 * 1000;
  return now.getTime() >= new Date(plant.watered_at).getTime() + intervalMs;
}

/** Vật nuôi đang đói — cùng ngữ nghĩa `FEED_ALL` của `animal.commands.ts`. */
function isAnimalHungry(animal: FarmAnimal): boolean {
  return animal.fullness < FULLNESS_MAX;
}

/**
 * Lọc dữ liệu riêng tư trước khi trả cho người ghé thăm (US-26, US-29, BR-23):
 * bỏ kho sản phẩm (tài sản), bộ đếm tiến trình thành tựu và lịch sử đổi tên.
 * Giữ bố cục nông trại (vùng đất, vật nuôi, cây, trang trí, Cây OCB) và huy
 * hiệu được chọn hiển thị.
 */
function toVisitorState(state: FarmStateJson): FarmStateJson {
  const { renames: _renames, ...rest } = state;
  return {
    ...rest,
    storage: {},
    counters: { harvest_count: 0, water_count: 0, help_given: 0, species_owned: [] },
  };
}

// ============================================================================
// Hạn mức giúp đỡ
// ============================================================================

type Queryable = Pick<PoolClient, 'query'>;

interface HelpUsage {
  usedToday: number;
  alreadyHelpedOwner: boolean;
}

async function readHelpUsage(
  db: Queryable,
  helperUserId: number,
  ownerUserId: number,
  today: string,
): Promise<HelpUsage> {
  const result = await db.query<{ used: string; helped_owner: boolean }>(
    `SELECT COUNT(*) AS used,
            COALESCE(BOOL_OR(owner_user_id = $2), false) AS helped_owner
     FROM farm_helps
     WHERE helper_user_id = $1 AND help_date = $3`,
    [helperUserId, ownerUserId, today],
  );
  const row = result.rows[0];
  return { usedToday: Number(row?.used ?? 0), alreadyHelpedOwner: row?.helped_owner ?? false };
}

function buildHelpAvailability(
  usage: HelpUsage,
  quota: number,
  state: FarmStateJson | null,
  now: Date,
  values: Record<string, number>,
): FarmHelpAvailability {
  const remaining = Math.max(0, quota - usage.usedToday);
  const blocked = state === null || usage.alreadyHelpedOwner || remaining === 0;
  return {
    remaining_quota: remaining,
    already_helped_today: usage.alreadyHelpedOwner,
    can_water: !blocked && state!.plants.some((p) => isPlantThirsty(p, now, values)),
    can_feed: !blocked && state!.animals.some((a) => isAnimalHungry(a)),
    resets_at: nextResetIso(now),
  };
}

// ============================================================================
// 7.1 — GET /farms
// ============================================================================

export interface FarmListQuery {
  q?: string;
  department_id?: string;
  page?: string;
  page_size?: string;
}

interface FarmListRow {
  user_id: number;
  full_name: string | null;
  department_id: number | null;
  department_name: string | null;
  farm_name: string | null;
  join_date: string | null;
  badges_shown: AchievementCode[] | null;
  has_farm: boolean;
}

/**
 * Danh sách đồng nghiệp để ghé thăm (US-26): tìm theo tên (≥ 2 ký tự, khớp
 * một phần, không phân biệt hoa/thường), lọc phòng ban, phân trang. Người gọi
 * không bao giờ xuất hiện trong danh sách. Đồng nghiệp chưa có nông trại vẫn
 * xuất hiện với `has_farm: false` (xếp sau) để UI hiển thị thông báo riêng.
 */
export async function listFarms(callerUserId: number, query: FarmListQuery): Promise<FarmListPage> {
  const page = parsePositiveInt(query.page, 1, 'page');
  const pageSize = Math.min(
    parsePositiveInt(query.page_size, FARMS_DEFAULT_PAGE_SIZE, 'page_size'),
    FARMS_MAX_PAGE_SIZE,
  );
  const offset = (page - 1) * pageSize;

  const conditions: string[] = ['u.id <> $1'];
  const values: unknown[] = [callerUserId];
  let idx = 2;

  const q = query.q?.trim() ?? '';
  if (q !== '') {
    if ([...q].length < SEARCH_MIN_CHARS) {
      throw new FarmConfigError(
        'INVALID_PAYLOAD',
        'Vui lòng nhập tối thiểu ' + SEARCH_MIN_CHARS + ' ký tự của tên để tìm kiếm.',
        { field: 'q', min_length: SEARCH_MIN_CHARS },
      );
    }
    conditions.push('(u.full_name ILIKE $' + idx + ' OR u.username ILIKE $' + idx + ')');
    values.push('%' + escapeLike(q) + '%');
    idx++;
  }

  if (query.department_id !== undefined && query.department_id !== '') {
    const departmentId = Number(query.department_id);
    if (!Number.isInteger(departmentId)) {
      throw new FarmConfigError('INVALID_PAYLOAD', 'Giá trị "department_id" phải là số nguyên.', {
        field: 'department_id',
        value: query.department_id,
      });
    }
    conditions.push('u.department_id = $' + idx);
    values.push(departmentId);
    idx++;
  }

  const whereClause = 'WHERE ' + conditions.join(' AND ');

  const listSql =
    'SELECT u.id AS user_id, COALESCE(u.full_name, u.username) AS full_name, ' +
    'u.department_id, d.name AS department_name, fs.farm_name, ' +
    "to_char(fs.join_date, 'YYYY-MM-DD') AS join_date, " +
    "fs.state->'badges_shown' AS badges_shown, (fs.user_id IS NOT NULL) AS has_farm " +
    'FROM users u ' +
    'LEFT JOIN departments d ON d.id = u.department_id ' +
    'LEFT JOIN farm_states fs ON fs.user_id = u.id ' +
    whereClause +
    ' ORDER BY (fs.user_id IS NOT NULL) DESC, COALESCE(u.full_name, u.username) ASC, u.id ASC' +
    ' LIMIT $' + idx + ' OFFSET $' + (idx + 1);
  const countSql = 'SELECT COUNT(*) AS total FROM users u ' + whereClause;

  const [listResult, countResult] = await Promise.all([
    pool.query<FarmListRow>(listSql, [...values, pageSize, offset]),
    pool.query<{ total: string }>(countSql, values),
  ]);

  const now = nowVN();
  const items: FarmListItem[] = listResult.rows.map((row) => ({
    user_id: row.user_id,
    full_name: row.full_name ?? '',
    department_id: row.department_id,
    department_name: row.department_name,
    farm_name: row.farm_name ?? '',
    seniority_months: seniorityMonths(row.join_date, now),
    badges_shown: Array.isArray(row.badges_shown) ? row.badges_shown : [],
    is_anniversary_today: row.has_farm && anniversaryInfo(row.join_date, now).isToday,
    has_farm: row.has_farm,
  }));

  const total = Number(countResult.rows[0]?.total ?? 0);
  return { items, page, page_size: pageSize, total, has_more: offset + items.length < total };
}

// ============================================================================
// 7.1 — GET /farms/:userId
// ============================================================================

async function assertUserExists(db: Queryable, userId: number): Promise<void> {
  const result = await db.query<{ id: number }>('SELECT id FROM users WHERE id = $1', [userId]);
  if (result.rows.length === 0) {
    throw new FarmConfigError('TARGET_FARM_NOT_FOUND', 'Không tìm thấy đồng nghiệp này.', {
      user_id: userId,
    });
  }
}

/**
 * Nông trại đồng nghiệp ở chế độ chỉ xem (US-26). Tick trong bộ nhớ, KHÔNG
 * ghi lại — việc ghé thăm không thay đổi nông trại của chủ (BR-21). Khi đồng
 * nghiệp chưa có nông trại: `has_farm: false`, `state: null`, mọi hành động
 * giúp không khả dụng.
 */
export async function getFarmVisit(callerUserId: number, ownerUserId: number): Promise<FarmVisitResponse> {
  if (callerUserId === ownerUserId) {
    throw new FarmConfigError(
      'INVALID_PAYLOAD',
      'Đây là nông trại của bạn — hãy mở nông trại của mình thay vì chế độ ghé thăm.',
    );
  }
  await assertUserExists(pool, ownerUserId);

  const now = nowVN();
  const config = await getFarmConfig();
  const values = config.values;
  const quota = values['help_quota_per_day'] ?? 10;
  const environment = buildEnvironment(now, values);
  const usage = await readHelpUsage(pool, callerUserId, ownerUserId, vnDateString(now));

  const row = await readFarmState(ownerUserId);
  if (row === null) {
    const owner = await buildOwnerProfile(ownerUserId, '', null, [], now, values);
    return {
      owner,
      has_farm: false,
      state: null,
      environment,
      is_anniversary_today: false,
      anniversary_years: null,
      help: buildHelpAvailability(usage, quota, null, now, values),
    };
  }

  // Cây OCB của chủ nông trại hiển thị đúng thâm niên kể cả khi chủ chưa mở `/me` gần đây.
  const ticked = syncTreeWithSeniority(
    tick(row.state, new Date(row.last_tick_at), now, values, WEATHER_SEED).state,
    row.join_date,
    now,
    {
      treeMaxMilestone: values['tree_max_milestone'] ?? 40,
      treeMaxBranches: values['tree_max_branches'] ?? 30,
    },
  );
  const owner = await buildOwnerProfile(
    ownerUserId,
    row.farm_name ?? '',
    row.join_date,
    ticked.badges_shown,
    now,
    values,
  );
  const anniversary = anniversaryInfo(row.join_date, now);

  return {
    owner,
    has_farm: true,
    state: toVisitorState(ticked),
    environment,
    is_anniversary_today: anniversary.isToday,
    anniversary_years: anniversary.years,
    help: buildHelpAvailability(usage, quota, ticked, now, values),
  };
}

// ============================================================================
// 7.2 — POST /farms/:userId/help
// ============================================================================

const HELP_ACTION_TYPES: readonly HelpActionType[] = ['water', 'feed'];

interface HelpApplyResult {
  state: FarmStateJson;
  affectedIds: string[];
}

/**
 * Áp hành động giúp lên state đã tick của chủ nông trại — đưa cây về đủ nước
 * hoặc độ no về đúng mức tối đa (không bao giờ vượt trần, US-27).
 */
function applyHelpToState(
  state: FarmStateJson,
  actionType: HelpActionType,
  targetId: string | undefined,
  now: Date,
  values: Record<string, number>,
): HelpApplyResult {
  const nowIso = now.toISOString();

  if (actionType === 'water') {
    if (targetId !== undefined && !state.plants.some((p) => p.id === targetId)) {
      throw new FarmConfigError('PLANT_NOT_FOUND', 'Không tìm thấy cây cần giúp tưới.', { target_id: targetId });
    }
    const ids = new Set(
      state.plants
        .filter((p) => (targetId === undefined || p.id === targetId) && isPlantThirsty(p, now, values))
        .map((p) => p.id),
    );
    return {
      state: { ...state, plants: state.plants.map((p) => (ids.has(p.id) ? { ...p, watered_at: nowIso } : p)) },
      affectedIds: [...ids],
    };
  }

  if (targetId !== undefined && !state.animals.some((a) => a.id === targetId)) {
    throw new FarmConfigError('ANIMAL_NOT_FOUND', 'Không tìm thấy vật nuôi cần giúp cho ăn.', { target_id: targetId });
  }
  const ids = new Set(
    state.animals
      .filter((a) => (targetId === undefined || a.id === targetId) && isAnimalHungry(a))
      .map((a) => a.id),
  );
  return {
    state: {
      ...state,
      // Cùng hiệu ứng với `FEED_ANIMAL` của chủ nông trại (animal.commands.ts).
      animals: state.animals.map((a) =>
        ids.has(a.id) ? { ...a, fullness: FULLNESS_MAX, fed_at: nowIso, cycle_started_at: nowIso } : a,
      ),
    },
    affectedIds: [...ids],
  };
}

async function readDisplayNames(db: Queryable, userIds: number[]): Promise<Map<number, string>> {
  const result = await db.query<{ id: number; name: string | null }>(
    'SELECT id, COALESCE(full_name, username) AS name FROM users WHERE id = ANY($1::int[])',
    [userIds],
  );
  return new Map(result.rows.map((r) => [r.id, r.name ?? '']));
}

function helpActionLabel(actionType: HelpActionType): string {
  return actionType === 'water' ? 'tưới cây' : 'cho vật nuôi ăn';
}

/**
 * Giúp đồng nghiệp tưới cây / cho ăn (US-27, BR-22). Toàn bộ trong MỘT
 * transaction: thất bại ở bất kỳ bước nào → ROLLBACK, không trừ lượt, không
 * cộng Hạt OCB cho bên nào, không đổi nông trại.
 *
 * Đồng thời:
 * - Khóa `FOR UPDATE` cả hai dòng `farm_states` theo thứ tự `user_id` tăng
 *   dần (tránh deadlock khi A giúp B và B giúp A cùng lúc). Khóa dòng của
 *   người giúp tuần tự hóa việc đếm hạn mức; khóa dòng của chủ tuần tự hóa
 *   việc sửa nước / độ no nên không bao giờ vượt trần.
 * - `UNIQUE(helper_user_id, owner_user_id, help_date)` là lớp chặn cuối cho
 *   "mỗi nông trại chỉ được cùng một người giúp một lần mỗi ngày".
 *
 * Chủ nông trại: state được tick tới `now` rồi áp hành động, `version + 1`.
 * Người giúp: chỉ đổi `counters.help_given` và số dư — KHÔNG tăng `version`
 * (bố cục nông trại của họ không đổi, tránh 409 giả khi họ quay về).
 */
export async function helpFarm(
  callerUserId: number,
  ownerUserId: number,
  body: unknown,
): Promise<FarmHelpResponse> {
  const req = (typeof body === 'object' && body !== null ? body : {}) as Partial<FarmHelpRequest>;
  const actionType = req.action_type;
  if (actionType === undefined || !HELP_ACTION_TYPES.includes(actionType)) {
    throw new FarmConfigError('INVALID_PAYLOAD', 'Trường "action_type" phải là "water" hoặc "feed".', {
      field: 'action_type',
    });
  }
  if (req.target_id !== undefined && (typeof req.target_id !== 'string' || req.target_id === '')) {
    throw new FarmConfigError('INVALID_PAYLOAD', 'Trường "target_id" không hợp lệ.', { field: 'target_id' });
  }
  if (callerUserId === ownerUserId) {
    throw new FarmConfigError('HELP_SELF_NOT_ALLOWED', 'Bạn không thể tự giúp nông trại của chính mình.');
  }

  const now = nowVN();
  const today = vnDateString(now);
  const config = await getFarmConfig();
  const values = config.values;
  const quota = values['help_quota_per_day'] ?? 10;
  const reward = values['help_reward_each'] ?? 0;
  const resetsAt = nextResetIso(now);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Khóa theo thứ tự user_id tăng dần.
    const rows = new Map<number, FarmStateRow | null>();
    for (const id of [callerUserId, ownerUserId].sort((a, b) => a - b)) {
      rows.set(id, await readFarmStateForUpdate(client, id));
    }
    const ownerRow = rows.get(ownerUserId) ?? null;
    const helperRow = rows.get(callerUserId) ?? null;

    if (ownerRow === null) {
      throw new FarmConfigError('TARGET_FARM_NOT_FOUND', 'Đồng nghiệp này chưa có nông trại.', {
        user_id: ownerUserId,
      });
    }
    if (helperRow === null) {
      throw new FarmConfigError(
        'FARM_NOT_INITIALIZED',
        'Bạn cần khởi tạo nông trại của mình trước khi giúp đồng nghiệp.',
      );
    }

    const usage = await readHelpUsage(client, callerUserId, ownerUserId, today);
    if (usage.usedToday >= quota) {
      throw new FarmConfigError(
        'HELP_QUOTA_EXCEEDED',
        'Bạn đã dùng hết ' + quota + ' lượt giúp hôm nay. Lượt giúp được làm mới lúc 00:00 (giờ Việt Nam).',
        { quota, remaining_quota: 0, resets_at: resetsAt },
      );
    }
    if (usage.alreadyHelpedOwner) {
      throw new FarmConfigError(
        'HELP_ALREADY_HELPED_TODAY',
        'Bạn đã giúp nông trại này hôm nay. Hãy quay lại vào ngày mai.',
        { resets_at: resetsAt },
      );
    }

    // Tick nông trại của chủ tới hiện tại trước khi sửa (D2).
    const ticked = tick(ownerRow.state, new Date(ownerRow.last_tick_at), now, values, WEATHER_SEED).state;
    const applied = applyHelpToState(ticked, actionType, req.target_id, now, values);

    if (applied.affectedIds.length === 0) {
      // Không còn gì để giúp — vẫn chấp nhận nếu một đồng nghiệp khác vừa giúp
      // cùng loại hành động gần như cùng lúc (US-27: cả hai đều được ghi nhận).
      const concurrent = await client.query(
        `SELECT 1 FROM farm_helps
         WHERE owner_user_id = $1 AND action_type = $2 AND created_at >= $3
         LIMIT 1`,
        [ownerUserId, actionType, new Date(now.getTime() - HELP_CONCURRENT_WINDOW_MS).toISOString()],
      );
      if (concurrent.rows.length === 0) {
        throw new FarmConfigError(
          'HELP_NOTHING_TO_DO',
          actionType === 'water'
            ? 'Nông trại này hiện không có cây nào thiếu nước.'
            : 'Nông trại này hiện không có vật nuôi nào đang đói.',
        );
      }
    }

    // Ghi lượt giúp — UNIQUE chặn lượt thứ hai trong ngày.
    let helpId: number;
    try {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO farm_helps (helper_user_id, owner_user_id, help_date, action_type, reward)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [callerUserId, ownerUserId, today, actionType, reward],
      );
      helpId = Number(inserted.rows[0].id);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new FarmConfigError(
          'HELP_ALREADY_HELPED_TODAY',
          'Bạn đã giúp nông trại này hôm nay. Hãy quay lại vào ngày mai.',
          { resets_at: resetsAt },
        );
      }
      throw err;
    }

    const names = await readDisplayNames(client, [callerUserId, ownerUserId]);
    const helperName = names.get(callerUserId) ?? '';
    const ownerName = names.get(ownerUserId) ?? '';

    // Chủ nông trại: state mới + thưởng, version + 1.
    const ownerBalance = ownerRow.seeds + reward;
    await persistFarmState(client, {
      userId: ownerUserId,
      state: applied.state,
      seeds: ownerBalance,
      incrementVersion: true,
      lastTickAt: now,
    });
    if (reward > 0) {
      await appendFarmTransaction(client, {
        userId: ownerUserId,
        kind: 'help_received',
        amount: reward,
        balanceAfter: ownerBalance,
        refType: 'farm_help',
        refId: String(helpId),
        note: helperName + ' đã giúp ' + helpActionLabel(actionType),
        actorUserId: callerUserId,
      });
    }

    // Người giúp: bộ đếm giúp đỡ + thưởng + thành tựu giúp đỡ (US-29).
    const helperState: FarmStateJson = {
      ...helperRow.state,
      counters: {
        ...helperRow.state.counters,
        help_given: (helperRow.state.counters?.help_given ?? 0) + 1,
      },
    };
    const achievements = await applyAchievements(
      client,
      callerUserId,
      helperState,
      helperRow.checkin_streak,
      values,
      now,
    );
    let helperBalance = helperRow.seeds + reward;
    if (reward > 0) {
      await appendFarmTransaction(client, {
        userId: callerUserId,
        kind: 'help_reward',
        amount: reward,
        balanceAfter: helperBalance,
        refType: 'farm_help',
        refId: String(helpId),
        note: 'Giúp ' + helpActionLabel(actionType) + ' cho nông trại của ' + ownerName,
      });
    }
    for (const achievement of achievements.unlocked) {
      helperBalance += achievement.reward;
      await appendFarmTransaction(client, {
        userId: callerUserId,
        kind: 'achievement_reward',
        amount: achievement.reward,
        balanceAfter: helperBalance,
        refType: 'achievement',
        refId: achievement.code,
        note: 'Thành tựu: ' + achievement.name,
      });
    }
    await client.query(
      'UPDATE farm_states SET state = $1, seeds = $2, updated_at = NOW() WHERE user_id = $3',
      [JSON.stringify(helperState), helperBalance, callerUserId],
    );

    await client.query('COMMIT');

    return {
      action_type: actionType,
      affected_ids: applied.affectedIds,
      helper_reward: reward,
      owner_reward: reward,
      balance: helperBalance,
      help: {
        remaining_quota: Math.max(0, quota - usage.usedToday - 1),
        already_helped_today: true,
        can_water: false,
        can_feed: false,
        resets_at: resetsAt,
      },
      achievements_unlocked: achievements.unlocked,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ============================================================================
// 7.3 — POST /farms/:userId/greeting
// ============================================================================

const GREETING_KINDS: readonly GreetingKind[] = ['text', 'emoji'];

/**
 * Gửi lời chúc / biểu cảm lên nông trại đồng nghiệp (US-8, US-48).
 *
 * - Độ dài ≤ `greeting_max_len` (sau trim, đếm theo ký tự Unicode), không chứa
 *   từ bị cấm (dùng chung danh sách với tên nông trại).
 * - Hạn mức mỗi người gửi / mỗi nông trại / mỗi ngày (UTC+7) theo
 *   `greeting_quota_per_day`; riêng ngày kỷ niệm vào làm của chủ là 1 lời
 *   chúc / người. Lời chúc đã bị chủ xoá mềm vẫn được đếm.
 * - `pg_advisory_xact_lock` theo cặp (người gửi, chủ) tuần tự hóa việc đếm
 *   hạn mức khi người gửi bấm gửi nhiều lần liên tiếp.
 */
export async function sendGreeting(
  callerUserId: number,
  ownerUserId: number,
  body: unknown,
): Promise<FarmGreetingResponse> {
  const req = (typeof body === 'object' && body !== null ? body : {}) as Partial<FarmGreetingRequest>;
  const kind = req.kind ?? 'text';
  if (!GREETING_KINDS.includes(kind)) {
    throw new FarmConfigError('INVALID_PAYLOAD', 'Trường "kind" phải là "text" hoặc "emoji".', { field: 'kind' });
  }
  if (typeof req.message !== 'string' || req.message.trim() === '') {
    throw new FarmConfigError('INVALID_PAYLOAD', 'Nội dung lời chúc không được để trống.', { field: 'message' });
  }
  if (callerUserId === ownerUserId) {
    throw new FarmConfigError('GREETING_SELF_NOT_ALLOWED', 'Bạn không thể gửi lời chúc cho nông trại của chính mình.');
  }

  const message = req.message.trim();
  const config = await getFarmConfig();
  const values = config.values;
  const maxLen = values['greeting_max_len'] ?? 200;
  const length = [...message].length;
  if (length > maxLen) {
    throw new FarmConfigError('GREETING_TOO_LONG', 'Lời chúc tối đa ' + maxLen + ' ký tự.', {
      max_len: maxLen,
      length,
    });
  }
  if (containsForbiddenWord(message)) {
    throw new FarmConfigError('GREETING_FORBIDDEN_WORD', 'Lời chúc chứa nội dung không được phép, vui lòng sửa lại.');
  }

  const now = nowVN();
  const today = vnDateString(now);
  const resetsAt = nextResetIso(now);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      'ocb_farm_greeting:' + callerUserId + ':' + ownerUserId,
    ]);

    const ownerResult = await client.query<{ join_date: string | null }>(
      "SELECT to_char(join_date, 'YYYY-MM-DD') AS join_date FROM farm_states WHERE user_id = $1",
      [ownerUserId],
    );
    if (ownerResult.rows.length === 0) {
      throw new FarmConfigError('TARGET_FARM_NOT_FOUND', 'Đồng nghiệp này chưa có nông trại.', {
        user_id: ownerUserId,
      });
    }

    const anniversary = anniversaryInfo(ownerResult.rows[0].join_date, now);
    const limit = anniversary.isToday ? 1 : values['greeting_quota_per_day'] ?? 3;

    const countResult = await client.query<{ sent: string }>(
      `SELECT COUNT(*) AS sent FROM farm_greetings
       WHERE sender_user_id = $1 AND owner_user_id = $2 AND greet_date = $3`,
      [callerUserId, ownerUserId, today],
    );
    const sent = Number(countResult.rows[0]?.sent ?? 0);
    if (sent >= limit) {
      throw new FarmConfigError(
        'GREETING_QUOTA_EXCEEDED',
        anniversary.isToday
          ? 'Bạn đã gửi lời chúc kỷ niệm năm nay cho đồng nghiệp này.'
          : 'Bạn chỉ gửi được tối đa ' + limit +
              ' lời chúc cho mỗi nông trại mỗi ngày. Bạn có thể gửi lại sau 00:00 (giờ Việt Nam).',
        { quota: limit, anniversary: anniversary.isToday, retry_at: resetsAt },
      );
    }

    const inserted = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO farm_greetings (sender_user_id, owner_user_id, greet_date, kind, message)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [callerUserId, ownerUserId, today, kind, message],
    );

    await client.query('COMMIT');

    return {
      id: Number(inserted.rows[0].id),
      created_at: inserted.rows[0].created_at.toISOString(),
      remaining_quota: Math.max(0, limit - sent - 1),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
