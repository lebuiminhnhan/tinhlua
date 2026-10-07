/**
 * OCB Farm — hàm thuần đánh giá thành tựu (US-29, BR-12).
 *
 * `evaluate()` chỉ quyết định "điều kiện nào đang đúng ngay bây giờ" dựa
 * trên `state`, `counters` và `config` — KHÔNG quyết định việc lưu trữ.
 * Việc ghi `farm_achievements` (idempotent bằng
 * `UNIQUE(user_id, achievement_code)`), cộng Hạt OCB thưởng và phát thông
 * báo do `farm-command.service` (task 5.x) thực hiện trong transaction,
 * sau khi lọc bỏ các mã đã có trong `alreadyUnlockedCodes` — đây chính là
 * cách BR-12 ("mỗi thành tựu chỉ được trao một lần") được bảo đảm mà không
 * cần module này truy vấn DB.
 *
 * Danh mục mã thành tựu dùng lại `ACHIEVEMENT_CODES` của
 * `ocb-farm.types.ts` (nguồn chân lý duy nhất, khớp
 * `farm_achievements.achievement_code`) — module này không tự định nghĩa
 * mã mới.
 *
 * _Requirements: US-25, US-29, BR-12, BR-13, BR-14_
 */

import {
  ACHIEVEMENT_CODES,
  AchievementCode,
  FarmCounters,
  FarmStateJson,
  FarmSpecies,
  FARM_SPECIES,
} from '../../types/ocb-farm.types';

/**
 * Mô tả tĩnh của một thành tựu: tên hiển thị và Hạt OCB thưởng một lần.
 * Không có cấu hình DB riêng cho thành tựu (không có khóa `farm_config`
 * tương ứng) nên catalog được khai báo cố định ở đây — khớp mọi mã trong
 * `ACHIEVEMENT_CODES` (kiểm tra bằng `satisfies` để không thiếu/lệch mã).
 */
export interface AchievementCatalogEntry {
  code: AchievementCode;
  name: string;
  description: string;
  /** Hạt OCB thưởng một lần khi đạt (US-29). */
  reward: number;
  /** Mốc cần đạt — dùng để hiển thị tiến trình `progress/target` (US-29). */
  target: number;
}

/** Catalog đầy đủ, một dòng cho mỗi mã trong `ACHIEVEMENT_CODES`. */
export const ACHIEVEMENT_CATALOG: Record<AchievementCode, AchievementCatalogEntry> = {
  ALL_SPECIES: {
    code: 'ALL_SPECIES',
    name: 'Đủ mặt anh tài',
    description: 'Từng sở hữu đủ 6 loài vật nuôi trên nông trại',
    reward: 300,
    target: FARM_SPECIES.length,
  },
  HARVEST_10: {
    code: 'HARVEST_10',
    name: 'Tay thu hoạch',
    description: 'Thu hoạch đủ 10 lần',
    reward: 100,
    target: 10,
  },
  HARVEST_100: {
    code: 'HARVEST_100',
    name: 'Nông dân chăm chỉ',
    description: 'Thu hoạch đủ 100 lần',
    reward: 500,
    target: 100,
  },
  HARVEST_500: {
    code: 'HARVEST_500',
    name: 'Bậc thầy nông trại',
    description: 'Thu hoạch đủ 500 lần',
    reward: 2000,
    target: 500,
  },
  STREAK_3: {
    code: 'STREAK_3',
    name: 'Khởi động',
    description: 'Check-in liên tiếp 3 ngày',
    reward: 100,
    target: 3,
  },
  STREAK_7: {
    code: 'STREAK_7',
    name: 'Một tuần đều đặn',
    description: 'Check-in liên tiếp 7 ngày',
    reward: 300,
    target: 7,
  },
  STREAK_14: {
    code: 'STREAK_14',
    name: 'Nửa tháng bền bỉ',
    description: 'Check-in liên tiếp 14 ngày',
    reward: 700,
    target: 14,
  },
  STREAK_30: {
    code: 'STREAK_30',
    name: 'Một tháng gắn bó',
    description: 'Check-in liên tiếp 30 ngày',
    reward: 1500,
    target: 30,
  },
  HELP_10: {
    code: 'HELP_10',
    name: 'Bạn tốt',
    description: 'Giúp đồng nghiệp đủ 10 lượt',
    reward: 200,
    target: 10,
  },
  HELP_50: {
    code: 'HELP_50',
    name: 'Người hàng xóm tốt bụng',
    description: 'Giúp đồng nghiệp đủ 50 lượt',
    reward: 800,
    target: 50,
  },
  HELP_200: {
    code: 'HELP_200',
    name: 'Trái tim nông trại',
    description: 'Giúp đồng nghiệp đủ 200 lượt',
    reward: 2500,
    target: 200,
  },
  TREE_6M: {
    code: 'TREE_6M',
    name: 'Mầm đầu tiên',
    description: 'Cây OCB đạt mốc 6 tháng thâm niên',
    reward: 100,
    target: 1,
  },
  TREE_1Y: {
    code: 'TREE_1Y',
    name: 'Một năm đồng hành',
    description: 'Cây OCB đạt mốc 1 năm thâm niên',
    reward: 300,
    target: 2,
  },
  TREE_3Y: {
    code: 'TREE_3Y',
    name: 'Ba năm gắn bó',
    description: 'Cây OCB đạt mốc 3 năm thâm niên',
    reward: 800,
    target: 6,
  },
  TREE_5Y: {
    code: 'TREE_5Y',
    name: 'Nửa thập kỷ',
    description: 'Cây OCB đạt mốc 5 năm thâm niên',
    reward: 1500,
    target: 10,
  },
  TREE_10Y: {
    code: 'TREE_10Y',
    name: 'Một thập kỷ OCB',
    description: 'Cây OCB đạt mốc 10 năm thâm niên',
    reward: 3000,
    target: 20,
  },
  ALL_PLOTS_UNLOCKED: {
    code: 'ALL_PLOTS_UNLOCKED',
    name: 'Điền chủ',
    description: 'Mở khoá toàn bộ vùng đất của nông trại',
    reward: 1000,
    target: 1,
  },
} satisfies Record<AchievementCode, AchievementCatalogEntry>;

/** Mốc Cây OCB (số kỳ 6 tháng) tương ứng từng mã `TREE_*` — 1 mốc = 6 tháng. */
const TREE_MILESTONE_THRESHOLDS: Partial<Record<AchievementCode, number>> = {
  TREE_6M: 1,
  TREE_1Y: 2,
  TREE_3Y: 6,
  TREE_5Y: 10,
  TREE_10Y: 20,
};

/** Mốc thu hoạch tương ứng từng mã `HARVEST_*`. */
const HARVEST_THRESHOLDS: Partial<Record<AchievementCode, number>> = {
  HARVEST_10: 10,
  HARVEST_100: 100,
  HARVEST_500: 500,
};

/** Mốc chuỗi check-in tương ứng từng mã `STREAK_*` — khớp `farm-checkin.ts`. */
const STREAK_THRESHOLDS: Partial<Record<AchievementCode, number>> = {
  STREAK_3: 3,
  STREAK_7: 7,
  STREAK_14: 14,
  STREAK_30: 30,
};

/** Mốc số lượt giúp đồng nghiệp tương ứng từng mã `HELP_*`. */
const HELP_THRESHOLDS: Partial<Record<AchievementCode, number>> = {
  HELP_10: 10,
  HELP_50: 50,
  HELP_200: 200,
};

/**
 * `true` khi điều kiện của `code` đang đúng với `state`/`counters` hiện tại
 * — không quan tâm mã đã từng được trao hay chưa (việc lọc trùng do caller
 * của `evaluate()` xử lý qua `alreadyUnlockedCodes`).
 */
function isConditionMet(
  code: AchievementCode,
  state: FarmStateJson,
  counters: FarmCounters
): boolean {
  const harvestThreshold = HARVEST_THRESHOLDS[code];
  if (harvestThreshold !== undefined) {
    return counters.harvest_count >= harvestThreshold;
  }

  const streakThreshold = STREAK_THRESHOLDS[code];
  if (streakThreshold !== undefined) {
    return currentCheckinStreak(counters) >= streakThreshold;
  }

  const helpThreshold = HELP_THRESHOLDS[code];
  if (helpThreshold !== undefined) {
    return counters.help_given >= helpThreshold;
  }

  const treeThreshold = TREE_MILESTONE_THRESHOLDS[code];
  if (treeThreshold !== undefined) {
    return state.tree.milestone >= treeThreshold;
  }

  if (code === 'ALL_SPECIES') {
    return hasAllSpecies(counters.species_owned);
  }

  if (code === 'ALL_PLOTS_UNLOCKED') {
    return state.plots.length > 0 && state.plots.every((plot) => plot.unlocked);
  }

  return false;
}

/** `true` khi `owned` chứa đủ 6 loài vật nuôi, không phân biệt trùng/thứ tự. */
function hasAllSpecies(owned: FarmSpecies[]): boolean {
  const ownedSet = new Set(owned);
  return FARM_SPECIES.every((species) => ownedSet.has(species));
}

/**
 * Chuỗi check-in hiện tại. `FarmCounters` (task 1.3) không có trường chuỗi
 * riêng — mã `STREAK_*` đối chiếu với `farm_states.checkin_streak`, được
 * `farm-command.service` gộp vào cùng object `counters` dưới khóa
 * `checkin_streak` khi gọi `evaluate()`. Thiếu khóa này (ví dụ gọi
 * `evaluate()` ở nơi không liên quan tới check-in) được coi là chuỗi 0.
 */
function currentCheckinStreak(counters: FarmCounters & { checkin_streak?: number }): number {
  return counters.checkin_streak ?? 0;
}

/**
 * Trả về danh sách mã thành tựu **vừa** đạt điều kiện ngay bây giờ, đã loại
 * bỏ những mã đã có trong `alreadyUnlockedCodes` (BR-12: mỗi thành tựu chỉ
 * trao một lần, kể cả khi điều kiện tiếp tục đúng ở các lượt đánh giá sau).
 *
 * Thứ tự trả về theo đúng thứ tự khai báo trong `ACHIEVEMENT_CODES`, để
 * caller thông báo lần lượt từng thành tựu theo một thứ tự ổn định khi
 * nhiều thành tựu đạt cùng lúc (US-29).
 *
 * `config` được nhận vào để khớp chữ ký thiết kế (`evaluate(state, counters,
 * config)`) và dự phòng cho các mốc có thể chuyển sang cấu hình được ở
 * tương lai; hiện tại toàn bộ mốc và thưởng tra từ `ACHIEVEMENT_CATALOG`
 * (không có khóa `farm_config` riêng cho thành tựu).
 *
 * _Requirements: US-25, US-29, BR-12_
 */
export function evaluate(
  state: FarmStateJson,
  counters: FarmCounters & { checkin_streak?: number },
  config: Record<string, number>,
  alreadyUnlockedCodes: readonly string[]
): AchievementCode[] {
  void config;

  const alreadyUnlocked = new Set(alreadyUnlockedCodes);

  return ACHIEVEMENT_CODES.filter((code) => {
    if (alreadyUnlocked.has(code)) {
      return false;
    }
    return isConditionMet(code, state, counters);
  });
}
