/**
 * OCB Farm — bảng xếp hạng (task 7.4, US-28, BR-23).
 *
 * Ba tiêu chí:
 * - `seniority`: thâm niên Cây OCB theo số tháng tròn (tính tại thời điểm gọi).
 * - `assets`: `farm_states.total_assets_cached` — tổng tài sản (Hạt OCB + giá
 *   bán sản phẩm trong kho + giá mua vật nuôi / cây / vùng đất đã mở), làm mới
 *   theo chu kỳ `leaderboard_refresh` (phút). Mốc làm mới lưu ở
 *   `farm_leaderboard_refresh` và trả về qua `refreshed_at`.
 * - `streak`: chuỗi check-in HIỆN TẠI — chuỗi đã đứt (lần check-in gần nhất
 *   trước hôm qua) tính là 0.
 *
 * Sắp xếp giảm dần theo giá trị; bằng nhau thì thâm niên dài hơn (ngày vào làm
 * sớm hơn) đứng trước, rồi theo thứ tự chữ cái tên. Chỉ nhân viên đã có nông
 * trại mới xuất hiện. Mỗi dòng chỉ gồm tên, phòng ban và giá trị (BR-23).
 *
 * _Requirements: US-28, BR-23_
 */

import { pool } from '../../config/database';
import { nowVN, startOfDayVN } from './farm-calendar';
import { FarmConfigError, getFarmConfig } from './farm-config.service';
import { totalAssets, type FarmPriceTable } from './farm-economy';
import { seniority } from './farm-seniority';
import {
  ANIMAL_PRODUCT_KEYS,
  FARM_SPECIES,
  FLOWER_PLANT_KINDS,
  FRUIT_PLANT_KINDS,
  LEADERBOARD_METRICS,
  type FarmLeaderboardResponse,
  type FarmLeaderboardRow,
  type FarmStateJson,
  type LeaderboardMetric,
  type StorageKey,
} from '../../types/ocb-farm.types';

const TOP_N = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Số vùng đất tối đa dùng để dựng bảng giá mở rộng (`expand_price_plot<n>`). */
const MAX_PLOT_ID = 20;

// ============================================================================
// Làm mới `total_assets_cached`
// ============================================================================

interface AssetPriceConfig {
  sellPriceTable: FarmPriceTable;
  animalPurchasePrice: Partial<Record<string, number>>;
  plantPurchasePrice: Partial<Record<string, number>>;
  plotExpandPrice: Partial<Record<number, number>>;
}

/** Dựng bảng giá cho `totalAssets()` từ cấu hình đang áp dụng (cùng quy ước khóa với các nhóm lệnh). */
function buildAssetPriceConfig(values: Record<string, number>): AssetPriceConfig {
  const sellPriceTable: FarmPriceTable = {};
  for (const key of ANIMAL_PRODUCT_KEYS) {
    const price = values['sell_price_' + key];
    if (price !== undefined) sellPriceTable[key] = price;
  }
  for (const kind of FRUIT_PLANT_KINDS) {
    const price = values['sell_price_' + kind];
    if (price !== undefined) sellPriceTable[('fruit_' + kind) as StorageKey] = price;
  }
  for (const kind of FLOWER_PLANT_KINDS) {
    const price = values['sell_price_' + kind];
    if (price !== undefined) sellPriceTable[('flower_' + kind) as StorageKey] = price;
  }

  const animalPurchasePrice: Partial<Record<string, number>> = {};
  for (const species of FARM_SPECIES) animalPurchasePrice[species] = values['animal_price_' + species];

  const plantPurchasePrice: Partial<Record<string, number>> = {};
  for (const kind of [...FRUIT_PLANT_KINDS, ...FLOWER_PLANT_KINDS]) {
    plantPurchasePrice[kind] = values['seed_price_' + kind];
  }

  const plotExpandPrice: Partial<Record<number, number>> = {};
  for (let id = 1; id <= MAX_PLOT_ID; id++) plotExpandPrice[id] = values['expand_price_plot' + id];

  return { sellPriceTable, animalPurchasePrice, plantPurchasePrice, plotExpandPrice };
}

/**
 * Tính lại `total_assets_cached` cho mọi nông trại khi mốc làm mới gần nhất đã
 * cũ hơn `leaderboard_refresh` phút. Dòng `farm_leaderboard_refresh` bị khóa
 * bằng `FOR UPDATE SKIP LOCKED`: nếu một request khác đang làm mới, request này
 * không chờ mà dùng số liệu hiện có.
 *
 * Chỉ ghi cột `total_assets_cached` (không chạm `state`/`seeds`/`version`) nên
 * không xung đột với các lệnh đang chạy đồng thời.
 *
 * Trả mốc làm mới gần nhất (có thể `null` khi chưa từng làm mới).
 */
export async function refreshTotalAssetsIfStale(
  now: Date,
  values: Record<string, number>,
): Promise<Date | null> {
  const refreshMs = Math.max(1, values['leaderboard_refresh'] ?? 5) * 60 * 1000;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query<{ refreshed_at: Date | null }>(
      'SELECT refreshed_at FROM farm_leaderboard_refresh WHERE id = 1 FOR UPDATE SKIP LOCKED',
    );

    if (locked.rows.length === 0) {
      // Đang có tiến trình khác làm mới (hoặc chưa seed dòng mốc) — dùng số liệu hiện có.
      await client.query('ROLLBACK');
      const current = await pool.query<{ refreshed_at: Date | null }>(
        'SELECT refreshed_at FROM farm_leaderboard_refresh WHERE id = 1',
      );
      return current.rows[0]?.refreshed_at ?? null;
    }

    const lastRefreshed = locked.rows[0].refreshed_at;
    if (lastRefreshed !== null && now.getTime() - lastRefreshed.getTime() < refreshMs) {
      await client.query('COMMIT');
      return lastRefreshed;
    }

    const prices = buildAssetPriceConfig(values);
    const farms = await client.query<{ user_id: number; seeds: string; state: FarmStateJson }>(
      'SELECT user_id, seeds, state FROM farm_states',
    );

    const userIds: number[] = [];
    const totals: number[] = [];
    for (const farm of farms.rows) {
      const state = farm.state;
      const safeState: FarmStateJson = {
        ...state,
        storage: state.storage ?? {},
        animals: state.animals ?? [],
        plants: state.plants ?? [],
        plots: state.plots ?? [],
      };
      userIds.push(farm.user_id);
      totals.push(Math.max(0, Math.round(totalAssets(safeState, Number(farm.seeds), prices))));
    }

    if (userIds.length > 0) {
      await client.query(
        `UPDATE farm_states AS fs
         SET total_assets_cached = v.total
         FROM (SELECT UNNEST($1::int[]) AS user_id, UNNEST($2::bigint[]) AS total) AS v
         WHERE fs.user_id = v.user_id AND fs.total_assets_cached IS DISTINCT FROM v.total`,
        [userIds, totals],
      );
    }

    await client.query(
      'UPDATE farm_leaderboard_refresh SET refreshed_at = $1, farm_count = $2, updated_at = NOW() WHERE id = 1',
      [now.toISOString(), userIds.length],
    );
    await client.query('COMMIT');
    return now;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ============================================================================
// GET /leaderboard
// ============================================================================

export interface LeaderboardQuery {
  metric?: string;
  department_id?: string;
}

interface LeaderboardSourceRow {
  user_id: number;
  full_name: string | null;
  department_name: string | null;
  join_date: string;
  checkin_streak: number;
  last_checkin_date: string | null;
  total_assets_cached: string; // BIGINT
}

interface RankedCandidate {
  userId: number;
  name: string;
  departmentName: string | null;
  joinDate: string;
  value: number;
}

/**
 * Khóa ngày dùng cho `last_checkin_date` — PHẢI cùng công thức với
 * `farm-command.service.ts` / `farm-me.service.ts`
 * (`startOfDayVN(now).toISOString().slice(0, 10)`) để so sánh nhất quán với
 * giá trị đã ghi khi check-in.
 */
function checkinDayKey(ts: Date): string {
  return startOfDayVN(ts).toISOString().slice(0, 10);
}

function metricValue(row: LeaderboardSourceRow, metric: LeaderboardMetric, now: Date): number {
  switch (metric) {
    case 'assets':
      return Number(row.total_assets_cached);
    case 'streak': {
      const today = checkinDayKey(now);
      const yesterday = checkinDayKey(new Date(now.getTime() - DAY_MS));
      const alive = row.last_checkin_date === today || row.last_checkin_date === yesterday;
      return alive ? row.checkin_streak : 0;
    }
    case 'seniority':
    default:
      return seniority(new Date(row.join_date + 'T00:00:00.000Z'), now).totalMonths;
  }
}

function compareCandidates(a: RankedCandidate, b: RankedCandidate): number {
  if (a.value !== b.value) return b.value - a.value;
  // Thâm niên dài hơn (ngày vào làm sớm hơn) đứng trước.
  if (a.joinDate !== b.joinDate) return a.joinDate < b.joinDate ? -1 : 1;
  const byName = a.name.localeCompare(b.name, 'vi', { sensitivity: 'base' });
  if (byName !== 0) return byName;
  return a.userId - b.userId;
}

function toRow(candidate: RankedCandidate, rank: number, callerUserId: number): FarmLeaderboardRow {
  return {
    rank,
    user_id: candidate.userId,
    full_name: candidate.name,
    department_name: candidate.departmentName,
    value: candidate.value,
    is_self: candidate.userId === callerUserId,
  };
}

/**
 * Bảng xếp hạng top 20 theo tiêu chí, lọc được theo phòng ban. `me` luôn có
 * vị trí và giá trị của người gọi (kể cả ngoài top 20) khi người gọi có nông
 * trại và thuộc phạm vi lọc; ngược lại `null`.
 */
export async function getLeaderboard(
  callerUserId: number,
  query: LeaderboardQuery,
): Promise<FarmLeaderboardResponse> {
  const metricRaw = query.metric === undefined || query.metric === '' ? 'seniority' : query.metric;
  if (!(LEADERBOARD_METRICS as readonly string[]).includes(metricRaw)) {
    throw new FarmConfigError(
      'INVALID_PAYLOAD',
      'Tiêu chí xếp hạng phải là một trong: ' + LEADERBOARD_METRICS.join(', ') + '.',
      { field: 'metric', value: query.metric },
    );
  }
  const metric = metricRaw as LeaderboardMetric;

  let departmentId: number | null = null;
  if (query.department_id !== undefined && query.department_id !== '') {
    departmentId = Number(query.department_id);
    if (!Number.isInteger(departmentId)) {
      throw new FarmConfigError('INVALID_PAYLOAD', 'Giá trị "department_id" phải là số nguyên.', {
        field: 'department_id',
        value: query.department_id,
      });
    }
  }

  const now = nowVN();
  const config = await getFarmConfig();
  const refreshedAt = await refreshTotalAssetsIfStale(now, config.values);

  const values: unknown[] = [];
  let where = 'WHERE fs.join_date IS NOT NULL';
  if (departmentId !== null) {
    values.push(departmentId);
    where += ' AND u.department_id = $' + values.length;
  }

  const result = await pool.query<LeaderboardSourceRow>(
    'SELECT fs.user_id, COALESCE(u.full_name, u.username) AS full_name, d.name AS department_name, ' +
      "to_char(fs.join_date, 'YYYY-MM-DD') AS join_date, fs.checkin_streak, " +
      "to_char(fs.last_checkin_date, 'YYYY-MM-DD') AS last_checkin_date, fs.total_assets_cached " +
      'FROM farm_states fs ' +
      'JOIN users u ON u.id = fs.user_id ' +
      'LEFT JOIN departments d ON d.id = u.department_id ' +
      where,
    values,
  );

  const ranked: RankedCandidate[] = result.rows
    .map((row) => ({
      userId: row.user_id,
      name: row.full_name ?? '',
      departmentName: row.department_name,
      joinDate: row.join_date,
      value: metricValue(row, metric, now),
    }))
    .sort(compareCandidates);

  const rows = ranked.slice(0, TOP_N).map((c, i) => toRow(c, i + 1, callerUserId));
  const myIndex = ranked.findIndex((c) => c.userId === callerUserId);
  const me = myIndex >= 0 ? toRow(ranked[myIndex], myIndex + 1, callerUserId) : null;

  return {
    metric,
    department_id: departmentId,
    rows,
    me,
    refreshed_at: (refreshedAt ?? now).toISOString(),
  };
}
