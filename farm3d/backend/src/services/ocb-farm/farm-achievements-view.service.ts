/**
 * OCB Farm — logic nghiệp vụ của `GET /api/ocb-farm/me/achievements`.
 *
 * Route Express thực tế (`backend/src/routes/ocb-farm.routes.ts`) chỉ gọi
 * {@link getAchievementsView} và trả JSON — theo đúng khuôn mẫu route mỏng /
 * service chứa logic đã dùng ở `farm-me.service.ts`, `farm-ledger.service.ts`.
 *
 * Tên file có hậu tố `-view` (khác `farm-achievement.ts`, hàm thuần
 * `evaluate()` của task 2.11) để tránh nhầm lẫn: `farm-achievement.ts` quyết
 * định "mã nào vừa đạt điều kiện ngay bây giờ" (dùng trong
 * `farm-command.service.ts`, task 5.x, để mở khoá thành tựu); file này build
 * TOÀN BỘ danh sách 17 thành tựu kèm trạng thái đã đạt/tiến trình, phục vụ
 * hiển thị — không ghi gì vào DB.
 *
 * Cách tính `progress` theo từng loại thành tựu — mirror đúng logic
 * `isConditionMet()` của `farm-achievement.ts` (cùng ngưỡng, cùng nguồn dữ
 * liệu đếm) để tránh một thành tựu hiển thị "đã đạt" ở đây nhưng
 * `evaluate()` lại không đồng ý (hoặc ngược lại):
 *
 * - `HARVEST_*`  → `counters.harvest_count` (đếm tổng số lần thu hoạch).
 * - `STREAK_*`   → `farm_states.checkin_streak` (chuỗi check-in hiện tại —
 *                  KHÔNG phải `counters`, vì `FarmCounters` (task 1.3) không
 *                  có trường chuỗi riêng; `farm-achievement.ts` cũng đọc
 *                  giá trị này qua khoá mở rộng `counters.checkin_streak`
 *                  do `farm-command.service` gộp vào trước khi gọi
 *                  `evaluate()` — ở đây đọc trực tiếp từ cột DB vì không có
 *                  bước gộp tương tự).
 * - `HELP_*`     → `counters.help_given`.
 * - `TREE_*`     → `state.tree.milestone` (số kỳ 6 tháng đã hoàn thành) —
 *                  `target` lấy từ `ACHIEVEMENT_CATALOG[code].target`, vốn
 *                  đã được định nghĩa đúng bằng ngưỡng mốc tương ứng
 *                  (`TREE_6M` → 1, `TREE_1Y` → 2, ... khớp
 *                  `TREE_MILESTONE_THRESHOLDS` nội bộ của
 *                  `farm-achievement.ts`).
 * - `ALL_SPECIES` → progress = số loài riêng biệt đã từng sở hữu
 *                  (`counters.species_owned`, loại trùng bằng `Set`); target
 *                  = `ACHIEVEMENT_CATALOG.ALL_SPECIES.target` (= 6, hằng số
 *                  `FARM_SPECIES.length`).
 * - `ALL_PLOTS_UNLOCKED` → progress = số vùng đất đã mở khoá hiện tại
 *                  (`state.plots.filter(unlocked).length`); **target ở đây
 *                  LÀ TỔNG SỐ VÙNG ĐẤT HIỆN CÓ** (`state.plots.length`) —
 *                  khác với `target: 1` tĩnh trong `ACHIEVEMENT_CATALOG`
 *                  (catalog chỉ cần một con số khác 0 cho mục đích nội bộ,
 *                  không dùng để hiển thị tiến trình `x/y` có ý nghĩa vì số
 *                  vùng đất thay đổi theo từng nông trại khi mở rộng, US-24).
 *                  Vì vậy `target` của riêng mã này được TÍNH ĐỘNG tại đây,
 *                  ghi đè giá trị tĩnh của catalog, để UI hiển thị đúng
 *                  "đã mở N / tổng M vùng đất" thay vì "đã đạt / chưa đạt".
 *
 * _Requirements: US-29_
 */

import { pool } from '../../config/database';
import { ACHIEVEMENT_CATALOG } from './farm-achievement';
import {
  ACHIEVEMENT_CODES,
  FARM_SPECIES,
  type AchievementCode,
  type FarmAchievementView,
  type FarmCounters,
  type FarmStateJson,
} from '../../types/ocb-farm.types';

/** Mốc Cây OCB (số kỳ 6 tháng) tương ứng từng mã `TREE_*` — khớp `farm-achievement.ts`. */
const TREE_MILESTONE_THRESHOLDS: Partial<Record<AchievementCode, number>> = {
  TREE_6M: 1,
  TREE_1Y: 2,
  TREE_3Y: 6,
  TREE_5Y: 10,
  TREE_10Y: 20,
};

/** Mốc thu hoạch tương ứng từng mã `HARVEST_*` — khớp `farm-achievement.ts`. */
const HARVEST_THRESHOLDS: Partial<Record<AchievementCode, number>> = {
  HARVEST_10: 10,
  HARVEST_100: 100,
  HARVEST_500: 500,
};

/** Mốc chuỗi check-in tương ứng từng mã `STREAK_*` — khớp `farm-achievement.ts`/`farm-checkin.ts`. */
const STREAK_THRESHOLDS: Partial<Record<AchievementCode, number>> = {
  STREAK_3: 3,
  STREAK_7: 7,
  STREAK_14: 14,
  STREAK_30: 30,
};

/** Mốc số lượt giúp đồng nghiệp tương ứng từng mã `HELP_*` — khớp `farm-achievement.ts`. */
const HELP_THRESHOLDS: Partial<Record<AchievementCode, number>> = {
  HELP_10: 10,
  HELP_50: 50,
  HELP_200: 200,
};

/** Dòng DB thô của `farm_achievements` cho một nhân viên. */
interface UnlockedRow {
  achievement_code: AchievementCode;
  unlocked_at: Date;
}

/**
 * Tính `(progress, target)` của một mã thành tựu dựa trên `state`/`counters`
 * hiện tại — mirror logic ngưỡng của `isConditionMet()` trong
 * `farm-achievement.ts`, xem giải thích đầy đủ ở đầu file.
 */
function computeProgress(
  code: AchievementCode,
  state: FarmStateJson,
  counters: FarmCounters,
  checkinStreak: number,
): { progress: number; target: number } {
  const catalogTarget = ACHIEVEMENT_CATALOG[code].target;

  const harvestThreshold = HARVEST_THRESHOLDS[code];
  if (harvestThreshold !== undefined) {
    return { progress: counters.harvest_count, target: harvestThreshold };
  }

  const streakThreshold = STREAK_THRESHOLDS[code];
  if (streakThreshold !== undefined) {
    return { progress: checkinStreak, target: streakThreshold };
  }

  const helpThreshold = HELP_THRESHOLDS[code];
  if (helpThreshold !== undefined) {
    return { progress: counters.help_given, target: helpThreshold };
  }

  const treeThreshold = TREE_MILESTONE_THRESHOLDS[code];
  if (treeThreshold !== undefined) {
    return { progress: state.tree.milestone, target: treeThreshold };
  }

  if (code === 'ALL_SPECIES') {
    const distinctOwned = new Set(counters.species_owned).size;
    return { progress: distinctOwned, target: FARM_SPECIES.length };
  }

  if (code === 'ALL_PLOTS_UNLOCKED') {
    const unlockedCount = state.plots.filter((plot) => plot.unlocked).length;
    // Target động = tổng số vùng đất hiện có (khác target tĩnh của catalog
    // — xem giải thích chi tiết ở đầu file).
    return { progress: unlockedCount, target: state.plots.length };
  }

  // Không nên tới đây — mọi mã trong ACHIEVEMENT_CODES đều rơi vào một
  // trong các nhánh trên. Trả về catalog target như một giá trị an toàn.
  return { progress: 0, target: catalogTarget };
}

/**
 * Trả toàn bộ danh sách thành tựu (17 mã trong `ACHIEVEMENT_CODES`) của
 * `userId`, kèm trạng thái đã đạt/ngày đạt hoặc `progress`/`target` hiện
 * tại cho các thành tựu chưa đạt — sắp xếp theo đúng thứ tự khai báo trong
 * `ACHIEVEMENT_CODES` (US-29).
 *
 * Nhân viên chưa có nông trại (`farm_states` chưa có dòng) nhận về danh
 * sách với mọi thành tựu ở trạng thái chưa đạt, `progress: 0` — route (task
 * 4.4/5.7) không cần tạo nhánh riêng cho trường hợp này vì
 * `farm-access.middleware` + luồng onboarding đã đảm bảo nhân viên phải init
 * trước khi tới được màn hình thành tựu trên UI; hàm này vẫn không throw để
 * an toàn trong trường hợp gọi trực tiếp qua API.
 *
 * _Requirements: US-29_
 */
export async function getAchievementsView(userId: number): Promise<FarmAchievementView[]> {
  const [stateResult, unlockedResult] = await Promise.all([
    pool.query<{ state: FarmStateJson; checkin_streak: number }>(
      'SELECT state, checkin_streak FROM farm_states WHERE user_id = $1',
      [userId],
    ),
    pool.query<UnlockedRow>(
      'SELECT achievement_code, unlocked_at FROM farm_achievements WHERE user_id = $1',
      [userId],
    ),
  ]);

  const stateRow = stateResult.rows[0];
  const state: FarmStateJson = stateRow?.state ?? {
    schema: 1,
    plots: [],
    animals: [],
    plants: [],
    decors: [],
    storage: {},
    tree: { milestone: 0, branches: 0, last_evaluated_at: new Date(0).toISOString() },
    badges_shown: [],
    counters: { harvest_count: 0, water_count: 0, help_given: 0, species_owned: [] },
  };
  const counters = state.counters;
  const checkinStreak = stateRow?.checkin_streak ?? 0;

  const unlockedByCode = new Map<AchievementCode, string>(
    unlockedResult.rows.map((row) => [row.achievement_code, row.unlocked_at.toISOString()]),
  );

  return ACHIEVEMENT_CODES.map((code) => {
    const entry = ACHIEVEMENT_CATALOG[code];
    const unlockedAt = unlockedByCode.get(code) ?? null;
    const { progress, target } = computeProgress(code, state, counters, checkinStreak);

    return {
      code,
      name: entry.name,
      description: entry.description,
      reward: entry.reward,
      unlocked: unlockedAt !== null,
      unlocked_at: unlockedAt,
      progress,
      target,
    };
  });
}
