/**
 * OCB Farm — kiểu dữ liệu phía frontend.
 *
 * File này MIRROR nguyên vẹn `backend/src/types/ocb-farm.types.ts` (cùng tên, cùng
 * hình dạng) để hai phía nói cùng một hợp đồng dữ liệu mà không import chéo qua
 * ranh giới backend/frontend. Khi sửa một bên, phải sửa bên còn lại.
 *
 * Nội dung:
 * - Hình dạng JSONB của `farm_states.state` và `farm_states.settings`
 * - DTO request/response của endpoint lệnh duy nhất `POST /api/ocb-farm/commands`
 * - Danh mục mã lệnh và mã lỗi nghiệp vụ
 *
 * Quy ước:
 * - Chỉ chứa type/interface và const union (`as const`) — KHÔNG có logic runtime.
 * - Mọi mốc thời gian là chuỗi ISO 8601 (server sinh theo UTC, mốc nghiệp vụ tính theo UTC+7).
 * - Mọi giá trị ngày (không có giờ) là chuỗi `YYYY-MM-DD` theo giờ Việt Nam (UTC+7).
 *
 * _Requirements: US-40_
 */

// ============================================================================
// 1. Danh mục cơ bản (loài, sản phẩm, cây, trang trí, môi trường)
// ============================================================================

/** 6 loài vật nuôi (US-10). */
export const FARM_SPECIES = ['chicken', 'fish', 'sheep', 'pig', 'cow', 'horse'] as const;
export type FarmSpecies = (typeof FARM_SPECIES)[number];

/**
 * Loài Free_Roam_Pet (bản nâng cấp Cinema) — chó/mèo đi lại tự do toàn lưới,
 * chỉ hiển thị phía client, không thuộc `state.animals` và không tham gia
 * cơ chế occupancy/nghiệp vụ của 6 loài vật nuôi ở trên. Tách riêng khỏi
 * `FARM_SPECIES` theo đúng thiết kế — KHÔNG gộp hai danh sách này.
 */
export const FARM_FREE_ROAM_SPECIES = ['dog', 'cat'] as const;
export type FarmFreeRoamSpecies = (typeof FARM_FREE_ROAM_SPECIES)[number];

/**
 * Sản phẩm của vật nuôi (US-13): gà → trứng, bò → sữa, cừu → len,
 * cá → cá tươi, heo → phân hữu cơ. Ngựa không có sản phẩm thu hoạch.
 */
export const ANIMAL_PRODUCT_KEYS = ['egg', 'milk', 'wool', 'fish', 'manure'] as const;
export type AnimalProductKey = (typeof ANIMAL_PRODUCT_KEYS)[number];

/** 3 loại cây ăn quả (US-16): chuối, cam, xoài. */
export const FRUIT_PLANT_KINDS = ['banana', 'orange', 'mango'] as const;
export type FruitPlantKind = (typeof FRUIT_PLANT_KINDS)[number];

/** 3 loại hoa (US-16): hướng dương, cúc, hồng. */
export const FLOWER_PLANT_KINDS = ['sunflower', 'daisy', 'rose'] as const;
export type FlowerPlantKind = (typeof FLOWER_PLANT_KINDS)[number];

export type PlantKind = FruitPlantKind | FlowerPlantKind;

/** Cây ăn quả thu hoạch xong quay lại giai đoạn ra quả; hoa hết vòng đời (US-20). */
export type PlantCategory = 'fruit' | 'flower';

/** Khóa kho của quả và hoa — tiền tố `fruit_` / `flower_` theo design. */
export type FruitStorageKey = `fruit_${FruitPlantKind}`;
export type FlowerStorageKey = `flower_${FlowerPlantKind}`;

/** Toàn bộ khóa hợp lệ của kho (`state.storage`). */
export type StorageKey = AnimalProductKey | FruitStorageKey | FlowerStorageKey;

/**
 * Giai đoạn sinh trưởng của cây (US-17), đúng thứ tự:
 * hạt → mầm → cây lớn → ra hoa/ra quả → sẵn sàng thu hoạch.
 */
export const PLANT_STAGES = ['seed', 'sprout', 'grown', 'flowering', 'ready'] as const;
export type PlantStage = (typeof PLANT_STAGES)[number];

/**
 * 6 nhóm vật phẩm trang trí tối thiểu (US-34) + nhóm vật phẩm giới hạn theo dịp lễ (US-33).
 */
export const DECOR_GROUPS = [
  'fence',
  'path',
  'lamp',
  'bench',
  'well',
  'nameplate',
  'seasonal',
  // Nhóm mở rộng — cây cảnh, bụi cây, khóm hoa, luống rau, trái cây trang trí.
  'tree',
  'bush',
  'flowerbed',
  'crop',
  'produce',
] as const;
export type DecorGroup = (typeof DECOR_GROUPS)[number];

/** Nhóm của mã trang trí (`lamp` / `lamp_stand` → `lamp`) — khớp `decorGroupOf` ở backend. */
export function decorGroupOf(kind: string): DecorGroup | null {
  if (typeof kind !== 'string' || !/^[a-z]+(?:_[a-z0-9]+)*$/.test(kind)) return null;
  const head = kind.split('_')[0];
  return (DECOR_GROUPS as readonly string[]).includes(head) ? (head as DecorGroup) : null;
}

/** Mã vật phẩm trang trí cụ thể, phải được khai báo trong manifest tài nguyên 3D. */
export type DecorKind = string;

/** Hướng đặt vật phẩm trang trí — xoay lần lượt qua 4 hướng (US-34). */
export type DecorRotation = 0 | 90 | 180 | 270;

/** Địa hình của một vùng đất: cá chỉ vào `water`, loài khác chỉ trên `land` (BR-18). */
export type FarmTerrain = 'land' | 'water';

/** Tham chiếu một ô đất theo dạng `"hàng,cột"` — ví dụ `"3,4"`. */
export type FarmCellRef = string;

/** 4 buổi trong ngày, phủ kín 24h và không chồng lấn (US-30). */
export const DAY_PHASES = ['morning', 'noon', 'afternoon', 'night'] as const;
export type DayPhase = (typeof DAY_PHASES)[number];

/** 3 trạng thái thời tiết, giống nhau cho mọi nông trại tại cùng thời điểm (BR-30). */
export const WEATHER_STATES = ['sunny', 'cloudy', 'rainy'] as const;
export type Weather = (typeof WEATHER_STATES)[number];

/** Dịp lễ / mùa của phiên bản đầu (XN-4). */
export const SEASON_THEMES = ['tet', 'christmas', 'mid_autumn', 'ocb_birthday'] as const;
export type SeasonTheme = (typeof SEASON_THEMES)[number];

/** Nguồn ngày vào làm — khớp CHECK của `farm_states.join_date_source`. */
export type JoinDateSource = 'hr' | 'self' | 'admin';

/** Loại hành động giúp đỡ — khớp CHECK của `farm_helps.action_type` (US-27). */
export type HelpActionType = 'water' | 'feed';

/** Loại lời chúc — khớp CHECK của `farm_greetings.kind` (US-8, US-48). */
export type GreetingKind = 'text' | 'emoji';

/** Tiêu chí bảng xếp hạng (US-28). */
export const LEADERBOARD_METRICS = ['seniority', 'assets', 'streak'] as const;
export type LeaderboardMetric = (typeof LEADERBOARD_METRICS)[number];

// ============================================================================
// 2. Thành tựu và huy hiệu (US-29)
// ============================================================================

/**
 * Mã thành tựu — khớp `farm_achievements.achievement_code` (VARCHAR(50)),
 * phủ tối thiểu: nuôi đủ 6 loài, mốc thu hoạch, mốc chuỗi check-in,
 * mốc giúp đồng nghiệp, mốc thâm niên Cây OCB, mở hết vùng đất.
 */
export const ACHIEVEMENT_CODES = [
  'ALL_SPECIES',
  'HARVEST_10',
  'HARVEST_100',
  'HARVEST_500',
  'STREAK_3',
  'STREAK_7',
  'STREAK_14',
  'STREAK_30',
  'HELP_10',
  'HELP_50',
  'HELP_200',
  'TREE_6M',
  'TREE_1Y',
  'TREE_3Y',
  'TREE_5Y',
  'TREE_10Y',
  'ALL_PLOTS_UNLOCKED',
] as const;
export type AchievementCode = (typeof ACHIEVEMENT_CODES)[number];

/** Một thành tựu vừa được mở khóa trong lượt xử lý hiện tại. */
export interface FarmAchievementUnlocked {
  code: AchievementCode;
  name: string;
  reward: number;
  unlocked_at: string;
}

/** Một dòng trong danh sách thành tựu của `GET /me/achievements`. */
export interface FarmAchievementView {
  code: AchievementCode;
  name: string;
  description: string;
  reward: number;
  unlocked: boolean;
  /** Ngày đạt (ISO) — `null` khi chưa đạt. */
  unlocked_at: string | null;
  /** Tiến trình hiện tại so với mốc cần đạt. */
  progress: number;
  target: number;
}

// ============================================================================
// 3. Hình dạng JSONB `farm_states.state`
// ============================================================================

/** Một vùng đất: nhóm ô được mở khóa cùng nhau (US-24). */
export interface FarmPlot {
  /** Vùng 1 là vùng khởi đầu, các vùng sau mở theo thứ tự kề. */
  id: number;
  unlocked: boolean;
  cells: FarmCellRef[];
  terrain: FarmTerrain;
}

/** Một vật nuôi trên nông trại. */
export interface FarmAnimal {
  id: string;
  species: FarmSpecies;
  cell: FarmCellRef;
  /** Lần cho ăn gần nhất (ISO). */
  fed_at: string;
  /** Độ no 0..100 — bằng 0 là trạng thái buồn (US-12). */
  fullness: number;
  /** Mốc bắt đầu chu kỳ tạo sản phẩm hiện tại (ISO). */
  cycle_started_at: string;
  /** Số sản phẩm đã tạo xong đang chờ thu hoạch, giới hạn bởi trần tích lũy (BR-17). */
  pending: number;
}

/** Một cây trồng trên nông trại. */
export interface FarmPlant {
  id: string;
  kind: PlantKind;
  cell: FarmCellRef;
  stage: PlantStage;
  /** Thời gian đã tích lũy trong giai đoạn hiện tại (ms) — đóng băng khi thiếu nước. */
  stage_elapsed_ms: number;
  /** Lần tưới gần nhất (ISO) — dùng để suy ra trạng thái thiếu nước. */
  watered_at: string;
  /** Giai đoạn đã được bón phân — mỗi giai đoạn chỉ bón một lần (BR-20). */
  fertilized_stage: PlantStage | null;
  /** Mốc dự kiến sẵn sàng thu hoạch (ISO) — `null` khi chưa xác định. */
  ready_at: string | null;
}

/** Một vật phẩm trang trí trên nông trại. */
export interface FarmDecor {
  id: string;
  kind: DecorKind;
  cell: FarmCellRef;
  rotation: DecorRotation;
  /** `true` khi vật phẩm là nguồn sáng, được bật vào buổi đêm (US-30). */
  is_light: boolean;
  /** Dịp lễ mà vật phẩm thuộc về — `null` với vật phẩm thường (US-33). */
  seasonal_tag: SeasonTheme | null;
}

/** Kho sản phẩm — khóa thiếu đồng nghĩa với số lượng 0. */
export type FarmStorage = { [K in StorageKey]?: number };

/** Trạng thái Cây OCB đã tính sẵn theo thâm niên (BR-2, BR-3). */
export interface FarmTreeState {
  /** Số kỳ 6 tháng đã hoàn thành, có trần theo cấu hình. */
  milestone: number;
  /** Số nhánh lớn = số năm tròn − 2, tối thiểu 0, có trần theo cấu hình. */
  branches: number;
  /** Lần đánh giá mốc gần nhất (ISO). */
  last_evaluated_at: string;
}

/** Bộ đếm phục vụ đánh giá thành tựu (US-29). */
export interface FarmCounters {
  harvest_count: number;
  /** Chỉ đếm lần nhân viên tự tưới — mưa không tính (US-31). */
  water_count: number;
  help_given: number;
  species_owned: FarmSpecies[];
}

/** Toàn bộ nội dung cột JSONB `farm_states.state`. */
export interface FarmStateJson {
  /** Phiên bản hình dạng dữ liệu, dùng để nâng cấp về sau. */
  schema: number;
  plots: FarmPlot[];
  animals: FarmAnimal[];
  plants: FarmPlant[];
  decors: FarmDecor[];
  storage: FarmStorage;
  tree: FarmTreeState;
  /** Huy hiệu được chọn hiển thị, số lượng giới hạn theo cấu hình (US-29). */
  badges_shown: AchievementCode[];
  counters: FarmCounters;
  /**
   * Mốc thời gian (ISO) của mỗi lần đổi tên nông trại thành công, dùng để
   * tính hạn mức `rename_quota` trong `rename_quota_days` ngày gần nhất
   * (US-35, BR-24). Tùy chọn — các nông trại tạo trước khi trường này tồn
   * tại không có khóa này trong JSONB, coi như mảng rỗng (chưa đổi tên lần
   * nào), không cần migration vì nằm trong JSONB.
   */
  renames?: string[];
  /**
   * Phiên bản lưới đất (US-7, US-8 — bản nâng cấp Cinema). Tùy chọn — các
   * nông trại tạo trước khi trường này tồn tại không có khóa này trong
   * JSONB, coi như version 1 (lưới 13×15 cũ, `CELL_SIZE` cũ). Version 2 là
   * lưới 20×25 mới với `CELL_SIZE` gấp đôi. Không cần migration SQL vì nằm
   * trong JSONB — `grid_version` chỉ được nâng lên qua `migrateGridTo20x25`
   * (lazy, idempotent) hoặc đặt sẵn khi khởi tạo nông trại mới.
   */
  grid_version?: number;
}

// ============================================================================
// 4. Hình dạng JSONB `farm_states.settings`
// ============================================================================

/** 3 mức chất lượng đồ họa (US-36). */
export const FARM_QUALITIES = ['low', 'medium', 'high'] as const;
export type FarmQuality = (typeof FARM_QUALITIES)[number];

/** Khóa cảnh ở một buổi cố định — `null` là theo giờ thực (US-30). */
export type FarmSceneLock = DayPhase | null;

/** Thiết lập theo nhân viên (không theo thiết bị) — âm thanh mặc định tắt (BR-29). */
export interface FarmSettings {
  quality: FarmQuality;
  /** `true` khi nhân viên tự chọn mức chất lượng, ghi đè kết quả tự dò. */
  quality_manual: boolean;
  bgm: boolean;
  sfx: boolean;
  scene_lock: FarmSceneLock;
}

// ============================================================================
// 5. Danh mục mã lệnh của `POST /api/ocb-farm/commands`
// ============================================================================

export const FARM_COMMAND_CODES = [
  // Vật nuôi (US-10..US-15)
  'BUY_ANIMAL',
  'FEED_ANIMAL',
  'FEED_ALL',
  'HARVEST_ANIMAL',
  'HARVEST_ALL',
  'MOVE_ENTITY',
  'SELL_ANIMAL',
  // Cây trồng (US-16..US-20)
  'PLANT_SEED',
  'WATER_PLANT',
  'WATER_ALL',
  'FERTILIZE_PLANT',
  'HARVEST_PLANT',
  // Vật phẩm hỗ trợ: thuốc tăng trưởng (vật nuôi), phân bón siêu cấp (cây trồng)
  'USE_GROWTH_POTION',
  'USE_SUPER_FERTILIZER',
  // Kho, bán và mở rộng đất (US-21, US-22, US-24)
  'SELL_PRODUCT',
  'EXPAND_PLOT',
  // Trang trí, đổi tên (US-34, US-35)
  'BUY_DECOR',
  'MOVE_DECOR',
  'ROTATE_DECOR',
  'SELL_DECOR',
  'RENAME_FARM',
  // Hằng ngày, kỷ niệm, huy hiệu, cài đặt (US-7, US-25, US-29, US-30, US-32, US-36)
  'CLAIM_CHECKIN',
  'PICK_ANNIVERSARY_FRUIT',
  'SELECT_BADGES',
  'UPDATE_SETTINGS',
] as const;

export type FarmCommandCode = (typeof FARM_COMMAND_CODES)[number];

/** Nhóm lệnh theo module xử lý ở backend (chỉ phục vụ phân loại và hiển thị). */
export const FARM_COMMAND_GROUPS = {
  animal: [
    'BUY_ANIMAL',
    'FEED_ANIMAL',
    'FEED_ALL',
    'HARVEST_ANIMAL',
    'HARVEST_ALL',
    'MOVE_ENTITY',
    'SELL_ANIMAL',
  ],
  plant: ['PLANT_SEED', 'WATER_PLANT', 'WATER_ALL', 'FERTILIZE_PLANT', 'HARVEST_PLANT'],
  boost: ['USE_GROWTH_POTION', 'USE_SUPER_FERTILIZER'],
  economy: ['SELL_PRODUCT', 'EXPAND_PLOT'],
  decor: ['BUY_DECOR', 'MOVE_DECOR', 'ROTATE_DECOR', 'SELL_DECOR', 'RENAME_FARM'],
  daily: ['CLAIM_CHECKIN', 'PICK_ANNIVERSARY_FRUIT', 'SELECT_BADGES'],
  settings: ['UPDATE_SETTINGS'],
} as const satisfies Record<string, readonly FarmCommandCode[]>;

export type FarmCommandGroup = keyof typeof FARM_COMMAND_GROUPS;

// ---------------------------------------------------------------------------
// 5.1 Payload của từng lệnh
// ---------------------------------------------------------------------------

/** Payload rỗng — lệnh không cần tham số. */
export type EmptyPayload = Record<string, never>;

/** Loại thực thể có thể di chuyển trên nông trại. */
export type FarmEntityKind = 'animal' | 'plant' | 'decor';

export interface BuyAnimalPayload {
  species: FarmSpecies;
  cell: FarmCellRef;
}

export interface FeedAnimalPayload {
  animal_id: string;
}

/** Cho ăn tất cả — khi không đủ Hạt OCB thì ưu tiên độ no thấp nhất (US-11). */
export type FeedAllPayload = EmptyPayload;

export interface HarvestAnimalPayload {
  animal_id: string;
}

export type HarvestAllPayload = EmptyPayload;

export interface MoveEntityPayload {
  entity_kind: FarmEntityKind;
  entity_id: string;
  to_cell: FarmCellRef;
}

export interface SellAnimalPayload {
  animal_id: string;
}

export interface PlantSeedPayload {
  kind: PlantKind;
  cell: FarmCellRef;
}

export interface WaterPlantPayload {
  plant_id: string;
}

export type WaterAllPayload = EmptyPayload;

export interface FertilizePlantPayload {
  plant_id: string;
}

/** Thuốc tăng trưởng: mua + dùng ngay, hoàn tất chu kỳ sản phẩm hiện tại của vật nuôi. */
export interface UseGrowthPotionPayload {
  animal_id: string;
}

/** Phân bón siêu cấp: mua + dùng ngay, đưa cây lên giai đoạn kế tiếp. */
export interface UseSuperFertilizerPayload {
  plant_id: string;
}

export interface HarvestPlantPayload {
  plant_id: string;
}

export interface SellProductPayload {
  product: StorageKey;
  /** Số nguyên trong [1, số lượng đang có]. */
  quantity: number;
  /**
   * Số lượng client thấy lúc mở kho — lệch nghĩa là đã bán ở thiết bị khác,
   * lệnh bị từ chối bằng `QUANTITY_CHANGED` (US-22).
   */
  expected_quantity: number;
}

export interface ExpandPlotPayload {
  plot_id: number;
}

export interface BuyDecorPayload {
  kind: DecorKind;
  cell: FarmCellRef;
  rotation?: DecorRotation;
}

export interface MoveDecorPayload {
  decor_id: string;
  to_cell: FarmCellRef;
}

export interface RotateDecorPayload {
  decor_id: string;
  rotation: DecorRotation;
}

export interface SellDecorPayload {
  decor_id: string;
}

export interface RenameFarmPayload {
  farm_name: string;
}

export type ClaimCheckinPayload = EmptyPayload;

export interface PickAnniversaryFruitPayload {
  /** Năm dương lịch của ngày kỷ niệm — khớp `UNIQUE(user_id, anniversary_year)`. */
  anniversary_year: number;
}

export interface SelectBadgesPayload {
  badges: AchievementCode[];
}

export type UpdateSettingsPayload = Partial<FarmSettings>;

/** Ánh xạ mã lệnh → payload tương ứng. */
export interface FarmCommandPayloadMap {
  BUY_ANIMAL: BuyAnimalPayload;
  FEED_ANIMAL: FeedAnimalPayload;
  FEED_ALL: FeedAllPayload;
  HARVEST_ANIMAL: HarvestAnimalPayload;
  HARVEST_ALL: HarvestAllPayload;
  MOVE_ENTITY: MoveEntityPayload;
  SELL_ANIMAL: SellAnimalPayload;
  PLANT_SEED: PlantSeedPayload;
  WATER_PLANT: WaterPlantPayload;
  WATER_ALL: WaterAllPayload;
  FERTILIZE_PLANT: FertilizePlantPayload;
  HARVEST_PLANT: HarvestPlantPayload;
  USE_GROWTH_POTION: UseGrowthPotionPayload;
  USE_SUPER_FERTILIZER: UseSuperFertilizerPayload;
  SELL_PRODUCT: SellProductPayload;
  EXPAND_PLOT: ExpandPlotPayload;
  BUY_DECOR: BuyDecorPayload;
  MOVE_DECOR: MoveDecorPayload;
  ROTATE_DECOR: RotateDecorPayload;
  SELL_DECOR: SellDecorPayload;
  RENAME_FARM: RenameFarmPayload;
  CLAIM_CHECKIN: ClaimCheckinPayload;
  PICK_ANNIVERSARY_FRUIT: PickAnniversaryFruitPayload;
  SELECT_BADGES: SelectBadgesPayload;
  UPDATE_SETTINGS: UpdateSettingsPayload;
}

// ---------------------------------------------------------------------------
// 5.2 Request của `POST /commands`
// ---------------------------------------------------------------------------

/** Khung request chung: `{ command, payload, version, idempotency_key }`. */
export interface FarmCommandEnvelope<C extends FarmCommandCode> {
  command: C;
  payload: FarmCommandPayloadMap[C];
  /** Phiên bản state mà client đang giữ — lệch thì trả 409 (US-40). */
  version: number;
  /** Khóa chống lặp: gửi lại cùng khóa không nhân đôi hiệu lực. */
  idempotency_key: string;
}

/**
 * Union phân biệt theo `command` — cho phép `farm-command.service`
 * thu hẹp kiểu payload bằng `switch (req.command)`.
 */
export type FarmCommandRequest =
  | FarmCommandEnvelope<'BUY_ANIMAL'>
  | FarmCommandEnvelope<'FEED_ANIMAL'>
  | FarmCommandEnvelope<'FEED_ALL'>
  | FarmCommandEnvelope<'HARVEST_ANIMAL'>
  | FarmCommandEnvelope<'HARVEST_ALL'>
  | FarmCommandEnvelope<'MOVE_ENTITY'>
  | FarmCommandEnvelope<'SELL_ANIMAL'>
  | FarmCommandEnvelope<'PLANT_SEED'>
  | FarmCommandEnvelope<'WATER_PLANT'>
  | FarmCommandEnvelope<'WATER_ALL'>
  | FarmCommandEnvelope<'FERTILIZE_PLANT'>
  | FarmCommandEnvelope<'HARVEST_PLANT'>
  | FarmCommandEnvelope<'USE_GROWTH_POTION'>
  | FarmCommandEnvelope<'USE_SUPER_FERTILIZER'>
  | FarmCommandEnvelope<'SELL_PRODUCT'>
  | FarmCommandEnvelope<'EXPAND_PLOT'>
  | FarmCommandEnvelope<'BUY_DECOR'>
  | FarmCommandEnvelope<'MOVE_DECOR'>
  | FarmCommandEnvelope<'ROTATE_DECOR'>
  | FarmCommandEnvelope<'SELL_DECOR'>
  | FarmCommandEnvelope<'RENAME_FARM'>
  | FarmCommandEnvelope<'CLAIM_CHECKIN'>
  | FarmCommandEnvelope<'PICK_ANNIVERSARY_FRUIT'>
  | FarmCommandEnvelope<'SELECT_BADGES'>
  | FarmCommandEnvelope<'UPDATE_SETTINGS'>;

// ============================================================================
// 6. Mã lỗi nghiệp vụ
// ============================================================================

/**
 * Mã lỗi nghiệp vụ ổn định, trả kèm HTTP 409 (xung đột phiên bản) hoặc 422
 * (lệnh không hợp lệ). Mã là hợp đồng giữa backend và frontend: frontend dựa
 * vào mã để chọn thông báo tiếng Việt, không dựa vào chuỗi `message`.
 */
export const FARM_ERROR_CODES = [
  // --- Phiên bản và hạ tầng lệnh ---
  /** `version` client gửi lệch với `farm_states.version` → 409 kèm state mới nhất. */
  'VERSION_CONFLICT',
  'INVALID_COMMAND',
  'INVALID_PAYLOAD',

  // --- Khởi tạo và ngày vào làm ---
  'FARM_NOT_INITIALIZED',
  'JOIN_DATE_REQUIRED',
  'JOIN_DATE_OUT_OF_RANGE',
  'JOIN_DATE_ADMIN_LOCKED',

  // --- Kinh tế ---
  'INSUFFICIENT_SEEDS',
  'INSUFFICIENT_PRODUCT',
  'INVALID_QUANTITY',
  /** Số lượng trong kho đã thay đổi so với lúc client mở kho (US-22). */
  'QUANTITY_CHANGED',
  'PRODUCT_NOT_IN_STORAGE',
  'STORAGE_FULL',

  // --- Ô đất và vùng đất ---
  'INVALID_CELL',
  'CELL_OCCUPIED',
  'WRONG_TERRAIN',
  /** Ô trung tâm của Cây OCB không nhận vật phẩm nào khác (US-9). */
  'CENTER_CELL_RESERVED',
  'PLOT_LOCKED',
  'PLOT_ALREADY_UNLOCKED',
  'PLOT_NOT_ADJACENT',
  'ALL_PLOTS_UNLOCKED',

  // --- Giới hạn số vật phẩm (US-37, BR-28) ---
  'ANIMAL_LIMIT_REACHED',
  'PLANT_LIMIT_REACHED',
  'DECOR_LIMIT_REACHED',

  // --- Vật nuôi ---
  'ANIMAL_NOT_FOUND',
  'ANIMAL_ALREADY_FULL',
  'NOTHING_TO_FEED',
  'NOTHING_TO_HARVEST',
  'NO_PRODUCT_READY',
  /** Ngựa không tạo sản phẩm thu hoạch được (US-13). */
  'SPECIES_HAS_NO_PRODUCT',
  /** Vật nuôi đã tích đầy trần sản phẩm — thu hoạch trước khi dùng thuốc tăng trưởng. */
  'ANIMAL_PENDING_FULL',

  // --- Cây trồng ---
  'PLANT_NOT_FOUND',
  'PLANT_ALREADY_WATERED',
  'NOTHING_TO_WATER',
  'PLANT_NOT_READY',
  'PLANT_ALREADY_FERTILIZED_IN_STAGE',
  'PLANT_STAGE_NOT_FERTILIZABLE',
  'NO_MANURE',

  // --- Trang trí và Cây OCB ---
  'DECOR_NOT_FOUND',
  /** Cây OCB không di chuyển, không bán, không xoá được (BR-1). */
  'TREE_IMMUTABLE',

  // --- Tên nông trại (US-35, BR-24) ---
  'FARM_NAME_REQUIRED',
  'FARM_NAME_TOO_LONG',
  'FARM_NAME_FORBIDDEN_WORD',
  'RENAME_QUOTA_EXCEEDED',

  // --- Check-in, kỷ niệm, huy hiệu ---
  'CHECKIN_ALREADY_CLAIMED',
  'ANNIVERSARY_ALREADY_CLAIMED',
  'ANNIVERSARY_NOT_ACTIVE',
  'ANNIVERSARY_GRACE_EXPIRED',
  'SENIORITY_TOO_LOW',
  'BADGE_NOT_UNLOCKED',
  'BADGE_LIMIT_EXCEEDED',

  // --- Cài đặt ---
  'SETTINGS_INVALID_VALUE',

  // --- Ghé thăm, giúp đỡ, lời chúc ---
  /** Ở chế độ ghé thăm chỉ được xem và giúp đỡ (BR-21). */
  'VISIT_MODE_READ_ONLY',
  'TARGET_FARM_NOT_FOUND',
  'HELP_QUOTA_EXCEEDED',
  'HELP_ALREADY_HELPED_TODAY',
  'HELP_NOTHING_TO_DO',
  'HELP_SELF_NOT_ALLOWED',
  'GREETING_TOO_LONG',
  'GREETING_FORBIDDEN_WORD',
  'GREETING_QUOTA_EXCEEDED',
  'GREETING_SELF_NOT_ALLOWED',

  // --- Quyền truy cập (BR-25, BR-26) ---
  'APP_ACCESS_FORBIDDEN',
  'ADMIN_ONLY',

  // --- Thao tác quản trị (US-43, US-45) ---
  'ADMIN_REASON_TOO_SHORT',
  'ADMIN_ADJUST_INVALID_AMOUNT',
  'ADMIN_ADJUST_LIMIT_EXCEEDED',
  'ADMIN_ADJUST_NEGATIVE_BALANCE',
  'CONFIG_KEY_UNKNOWN',
  'CONFIG_VALUE_OUT_OF_RANGE',
] as const;

export type FarmErrorCode = (typeof FARM_ERROR_CODES)[number];

// ============================================================================
// 7. Sổ thu chi, thông báo, môi trường, thâm niên
// ============================================================================

/** Loại giao dịch trong `farm_transactions.kind`. */
export const FARM_LEDGER_KINDS = [
  'buy_animal',
  'sell_animal',
  'feed_animal',
  'buy_seed',
  'sell_product',
  'buy_decor',
  'buy_boost',
  'sell_decor',
  'expand_plot',
  'checkin',
  'streak_bonus',
  'anniversary',
  'help_reward',
  'help_received',
  'achievement_reward',
  'admin_adjust',
  'admin_reset',
] as const;
export type FarmLedgerKind = (typeof FARM_LEDGER_KINDS)[number];

/** Một dòng sổ thu chi (US-21) — `amount` dương là thu, âm là chi. */
export interface FarmLedgerEntry {
  id: number;
  occurred_at: string;
  kind: FarmLedgerKind;
  amount: number;
  balance_after: number;
  ref_type: string | null;
  ref_id: string | null;
  note: string | null;
  /** Khác `user_id` khi là admin điều chỉnh hoặc đồng nghiệp giúp. */
  actor_user_id: number | null;
}

/** Trang lịch sử thu chi của `GET /me/ledger`. */
export interface FarmLedgerPage {
  entries: FarmLedgerEntry[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
}

export type FarmNoticeLevel = 'info' | 'success' | 'warning' | 'error';

/** Mã thông báo không chặn, trả kèm response để frontend hiển thị. */
export const FARM_NOTICE_CODES = [
  'JOIN_DATE_ADJUSTED_BY_ADMIN',
  'SEEDS_ADJUSTED_BY_ADMIN',
  'FARM_RESET_BY_ADMIN',
  'OFFLINE_SUMMARY_READY',
  'FEED_ALL_PARTIAL',
  'STORAGE_NEAR_FULL',
  'STORAGE_FULL',
  'ACHIEVEMENT_REWARD_PENDING',
  'ANNIVERSARY_TODAY',
  'ANNIVERSARY_GRACE_ENDING',
  'RAIN_WATERED_PLANTS',
  'TREE_MILESTONE_REACHED',
  /** Tách giá bán gốc / thưởng ngựa / tổng nhận được của một lượt `SELL_PRODUCT` (US-14, US-22). */
  'SELL_PRODUCT_BREAKDOWN',
  /** `CLAIM_CHECKIN` thành công — kèm chuỗi mới và thưởng mốc (nếu có) (US-25). */
  'CHECKIN_CLAIMED',
  /** `PICK_ANNIVERSARY_FRUIT` thành công — kèm số năm đồng hành và thưởng (US-7). */
  'ANNIVERSARY_FRUIT_PICKED',
] as const;
export type FarmNoticeCode = (typeof FARM_NOTICE_CODES)[number];

export interface FarmNotice {
  code: FarmNoticeCode;
  level: FarmNoticeLevel;
  /** Nội dung tiếng Việt đã dựng sẵn ở backend (RB-4). */
  message: string;
  data?: Record<string, unknown>;
}

/** Trạng thái môi trường tại một thời điểm (US-30, US-31, US-33). */
export interface FarmEnvironment {
  day_phase: DayPhase;
  weather: Weather;
  /** Dịp lễ có ưu tiên cao nhất đang bao phủ hôm nay — `null` là chủ đề mặc định. */
  season_theme: SeasonTheme | null;
  season_theme_name: string | null;
  /** Chu kỳ thời tiết hiện tại (ISO) — giống nhau cho mọi nông trại (BR-30). */
  weather_cycle_started_at: string;
  weather_cycle_ends_at: string;
  /** Thời điểm server, dùng để client đồng bộ đồng hồ hiển thị. */
  server_time: string;
}

/** Thâm niên đã tính sẵn ở backend (US-5, US-6). */
export interface FarmSeniority {
  join_date: string | null;
  years: number;
  months: number;
  total_months: number;
  milestone: number;
  branches: number;
  /** `null` khi đã đạt mốc cao nhất theo cấu hình. */
  days_to_next_milestone: number | null;
  at_max_milestone: boolean;
}

/** Một mốc trên dòng thời gian Cây OCB (US-51). */
export interface FarmTreeMilestone {
  milestone: number;
  /** Ngày đạt mốc theo giờ Việt Nam (`YYYY-MM-DD`). */
  reached_on: string;
  label: string;
  reached: boolean;
}

/** Trạng thái check-in hằng ngày (US-25). */
export interface FarmCheckinStatus {
  claimed_today: boolean;
  streak: number;
  last_checkin_date: string | null;
  /** Thưởng cơ bản của lượt check-in kế tiếp. */
  next_reward: number;
  /** Thưởng mốc kèm theo nếu lượt kế tiếp chạm mốc chuỗi — 0 nếu không. */
  next_streak_bonus: number;
  /** 00:00 UTC+7 của ngày kế tiếp (ISO). */
  resets_at: string;
}

/** Một dòng trong bảng tổng kết tích lũy khi vắng mặt (US-23). */
export interface FarmOfflineSummaryItem {
  key: StorageKey;
  quantity: number;
  /** `true` khi có ít nhất một đối tượng đã đạt trần tích lũy (BR-17). */
  capped: boolean;
}

export interface FarmOfflineSummary {
  from: string;
  to: string;
  away_ms: number;
  items: FarmOfflineSummaryItem[];
  /** Id vật nuôi / cây đã đạt trần tích lũy. */
  capped_entity_ids: string[];
  /** Số chu kỳ mưa đã tự tưới cây trong khoảng vắng mặt (US-31). */
  rain_cycles: number;
}

/** Số lượng hiện tại so với giới hạn của một nhóm vật phẩm (US-37). */
export interface FarmLimitCounter {
  current: number;
  max: number;
}

export interface FarmLimits {
  animals: FarmLimitCounter;
  plants: FarmLimitCounter;
  decors: FarmLimitCounter;
  storage: FarmLimitCounter;
  badges_shown: FarmLimitCounter;
}

// ============================================================================
// 8. Response của `POST /commands`
// ============================================================================

/** Response 200 — kết quả áp lệnh thành công. */
export interface FarmCommandSuccessResponse {
  state: FarmStateJson;
  version: number;
  /** Số dư Hạt OCB sau lệnh, luôn ≥ 0 (BR-9). */
  balance: number;
  /** Các dòng sổ vừa phát sinh trong cùng transaction. */
  ledger_delta: FarmLedgerEntry[];
  achievements_unlocked: FarmAchievementUnlocked[];
  notices: FarmNotice[];
}

/** Response 409 — lệch phiên bản, kèm state mới nhất để client tự hòa giải. */
export interface FarmVersionConflictResponse {
  code: 'VERSION_CONFLICT';
  message: string;
  state: FarmStateJson;
  version: number;
  balance: number;
}

/** Response 422 — lệnh không hợp lệ theo nghiệp vụ. */
export interface FarmBusinessErrorResponse {
  code: FarmErrorCode;
  message: string;
  /** Dữ liệu bổ trợ để frontend dựng thông báo, ví dụ `{ missing: 120 }`. */
  details?: Record<string, unknown>;
}

export type FarmCommandResponse =
  | FarmCommandSuccessResponse
  | FarmVersionConflictResponse
  | FarmBusinessErrorResponse;

// ============================================================================
// 9. `GET /me`, `POST /me/init`, `GET /config`
// ============================================================================

/** Thông tin công khai của chủ nông trại (BR-23). */
export interface FarmOwnerProfile {
  user_id: number;
  full_name: string;
  department_id: number | null;
  department_name: string | null;
  farm_name: string;
  seniority: FarmSeniority;
  badges_shown: AchievementCode[];
}

/** Response của `GET /api/ocb-farm/me` — đã tick tới thời điểm hiện tại. */
export interface FarmMeResponse {
  owner: FarmOwnerProfile;
  /** `false` khi chưa gọi `POST /me/init` — frontend phải mở màn hình khởi tạo. */
  initialized: boolean;
  join_date: string | null;
  join_date_source: JoinDateSource | null;
  join_date_admin_locked: boolean;
  balance: number;
  version: number;
  state: FarmStateJson;
  settings: FarmSettings;
  seniority: FarmSeniority;
  limits: FarmLimits;
  checkin: FarmCheckinStatus;
  environment: FarmEnvironment;
  /** `null` khi thời gian vắng mặt chưa đủ một chu kỳ nào (US-23). */
  offline_summary: FarmOfflineSummary | null;
  /** Số mục chưa xem trong hộp thư (người đã giúp + lời chúc). */
  inbox_new_count: number;
  notices: FarmNotice[];
  last_tick_at: string;
  server_time: string;
}

/**
 * Response tối giản của `GET /me` khi nhân viên chưa gọi `POST /me/init`
 * (mirror `FarmMeUninitializedResponse` ở `backend/src/services/ocb-farm/farm-me.service.ts`).
 */
export interface FarmMeUninitializedResponse {
  initialized: false;
  user_id: number;
  server_time: string;
}

/** Union thực tế mà `GET /me` trả về. */
export type FarmMeResult = FarmMeResponse | FarmMeUninitializedResponse;

/** Response của `POST /me/init` (mirror `FarmInitResult` ở `farm-init.service.ts`). */
export interface FarmInitResult {
  join_date: string;
  join_date_source: JoinDateSource;
  join_date_admin_locked: boolean;
  farm_name: string;
  seeds: number;
  state: FarmStateJson;
  settings: FarmSettings;
  version: number;
  last_tick_at: string;
  /** `false` khi nông trại đã tồn tại từ trước (phiên/thiết bị khác tạo trước). */
  created: boolean;
}

/** Request của `POST /me/init` — idempotent theo `user_id` (US-1, US-2). */
export interface FarmInitRequest {
  /** `YYYY-MM-DD` theo giờ Việt Nam. */
  join_date: string;
  join_date_source: JoinDateSource;
  farm_name?: string;
}

/** Response của `GET /me/join-date-suggestion` (US-3). */
export interface FarmJoinDateSuggestion {
  available: boolean;
  join_date: string | null;
  source: JoinDateSource | null;
  /** Lý do không đề xuất được: ngoài khoảng hợp lệ, tra cứu lỗi, hết thời gian chờ. */
  reason: string | null;
  min_date: string;
  max_date: string;
}

/** Nhóm hiển thị của thông số cấu hình — khớp `farm_config.config_group`. */
export const FARM_CONFIG_GROUPS = [
  'khoi_tao',
  'cay_ocb',
  'vat_nuoi',
  'cay_trong',
  'kho',
  'kinh_te',
  'dat',
  'checkin',
  'giup_do',
  'gioi_han',
  'moi_truong',
  'hieu_nang',
  'xep_hang',
  'khac',
] as const;
export type FarmConfigGroup = (typeof FARM_CONFIG_GROUPS)[number];

/** Một dòng `farm_config` (US-45). */
export interface FarmConfigEntry {
  key: string;
  value: number;
  unit: string | null;
  min_value: number | null;
  max_value: number | null;
  config_group: FarmConfigGroup;
  description: string | null;
  updated_at: string;
}

/** Response của `GET /config` — cấu hình đang áp dụng. */
export interface FarmConfigResponse {
  /** Tra nhanh theo khóa, ví dụ `values['initial_seeds']`. */
  values: Record<string, number>;
  entries: FarmConfigEntry[];
  refreshed_at: string;
}

// ============================================================================
// 10. Ghé thăm, giúp đỡ, hộp thư, bảng xếp hạng
// ============================================================================

/** Một dòng trong danh sách nông trại để ghé thăm (US-26). */
export interface FarmListItem {
  user_id: number;
  full_name: string;
  department_id: number | null;
  department_name: string | null;
  farm_name: string;
  seniority_months: number;
  badges_shown: AchievementCode[];
  /** `true` khi hôm nay là ngày kỷ niệm vào làm của chủ nông trại (US-8). */
  is_anniversary_today: boolean;
  has_farm: boolean;
}

export interface FarmListPage {
  items: FarmListItem[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
}

/** Trạng thái khả dụng của hành động giúp đỡ khi đang ghé thăm (US-27). */
export interface FarmHelpAvailability {
  remaining_quota: number;
  already_helped_today: boolean;
  can_water: boolean;
  can_feed: boolean;
  /** 00:00 UTC+7 của ngày kế tiếp (ISO) — mốc làm mới lượt giúp. */
  resets_at: string;
}

/** Response của `GET /farms/:userId` — chỉ xem, đã lọc dữ liệu riêng tư. */
export interface FarmVisitResponse {
  owner: FarmOwnerProfile;
  has_farm: boolean;
  state: FarmStateJson;
  environment: FarmEnvironment;
  is_anniversary_today: boolean;
  anniversary_years: number | null;
  help: FarmHelpAvailability;
}

export interface FarmHelpRequest {
  action_type: HelpActionType;
  /** Id cây / vật nuôi cụ thể — bỏ trống nghĩa là giúp toàn bộ đối tượng đang cần. */
  target_id?: string;
}

export interface FarmHelpResponse {
  action_type: HelpActionType;
  affected_ids: string[];
  helper_reward: number;
  owner_reward: number;
  /** Số dư của người giúp sau khi cộng thưởng. */
  balance: number;
  help: FarmHelpAvailability;
}

export interface FarmGreetingRequest {
  kind: GreetingKind;
  message: string;
}

export interface FarmGreetingResponse {
  id: number;
  created_at: string;
  remaining_quota: number;
}

/** Một mục "đã giúp nông trại của tôi" trong hộp thư (US-27). */
export interface FarmInboxHelp {
  id: number;
  helper_user_id: number;
  helper_name: string;
  action_type: HelpActionType;
  help_date: string;
  created_at: string;
  is_new: boolean;
}

/** Một lời chúc trong hộp thư (US-8, US-48). */
export interface FarmInboxGreeting {
  id: number;
  sender_user_id: number;
  sender_name: string;
  kind: GreetingKind;
  message: string;
  created_at: string;
  is_new: boolean;
}

export interface FarmInboxResponse {
  helps: FarmInboxHelp[];
  greetings: FarmInboxGreeting[];
  new_count: number;
}

/** Response của `POST /me/inbox/read` (US-8, US-27, US-48). */
export interface FarmInboxReadResult {
  helps_marked: number;
  greetings_marked: number;
  new_count: number;
}

/** Response của `DELETE /me/inbox/greetings/:id` (US-48). */
export interface FarmInboxDeleteGreetingResult {
  deleted: boolean;
  new_count: number;
}

/** Response của `DELETE /me/inbox/greetings` — xoá toàn bộ (US-48). */
export interface FarmInboxClearGreetingsResult {
  cleared: number;
  new_count: number;
}

/** Một dòng bảng xếp hạng — chỉ tên, phòng ban và giá trị tiêu chí (BR-23). */
export interface FarmLeaderboardRow {
  rank: number;
  user_id: number;
  full_name: string;
  department_name: string | null;
  value: number;
  is_self: boolean;
}

export interface FarmLeaderboardResponse {
  metric: LeaderboardMetric;
  department_id: number | null;
  rows: FarmLeaderboardRow[];
  /** Vị trí của chính người gọi, luôn có kể cả khi ngoài top 20 (US-28). */
  me: FarmLeaderboardRow | null;
  refreshed_at: string;
}

// ============================================================================
// 11. Dòng dữ liệu `farm_states` (giữ để mirror đủ với backend types)
// ============================================================================

/** Dòng bảng `farm_states` — cột JSONB đã được ép về kiểu tương ứng. */
export interface FarmStateRow {
  user_id: number;
  farm_name: string | null;
  join_date: string | null;
  join_date_source: JoinDateSource | null;
  join_date_admin_locked: boolean;
  seeds: number;
  checkin_streak: number;
  last_checkin_date: string | null;
  total_assets_cached: number;
  state: FarmStateJson;
  settings: FarmSettings;
  version: number;
  last_tick_at: string;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// 11.1. Quản trị — tìm nhân viên, sửa ngày vào làm, điều chỉnh Hạt OCB, đặt lại
// nông trại (US-42, US-43, US-44, BR-26, BR-27). Mirror
// `backend/src/types/ocb-farm.types.ts` phần 10.1–10.2.
// ============================================================================

/** Một dòng trong danh sách nhân viên của `GET /admin/users` (US-42). */
export interface FarmAdminUserListItem {
  user_id: number;
  full_name: string;
  username: string;
  department_id: number | null;
  department_name: string | null;
  /** `false` khi nhân viên chưa gọi `POST /me/init` — chưa có nông trại để sửa. */
  has_farm: boolean;
  join_date: string | null;
  join_date_source: JoinDateSource | null;
  join_date_admin_locked: boolean;
  seniority: FarmSeniority | null;
}

export interface FarmAdminUserListPage {
  items: FarmAdminUserListItem[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
}

/** Request của `PATCH /admin/users/:id/join-date` (US-42). */
export interface FarmAdminJoinDatePatchRequest {
  /** `YYYY-MM-DD` theo giờ Việt Nam — cùng khoảng hợp lệ áp dụng cho nhân viên (BR-7). */
  join_date: string;
  /** Lý do chỉnh sửa — hiển thị lại cho nhân viên trong thông báo (không bắt buộc độ dài tối thiểu như US-43). */
  reason?: string;
}

/** Response của `PATCH /admin/users/:id/join-date` — thâm niên và mốc Cây OCB tính lại ngay (US-42). */
export interface FarmAdminJoinDatePatchResponse {
  user_id: number;
  join_date: string;
  join_date_source: JoinDateSource;
  join_date_admin_locked: true;
  previous_join_date: string | null;
  seniority: FarmSeniority;
  tree: FarmTreeState;
  audit_id: number;
}

/** Request của `POST /admin/users/:id/seeds` (US-43). */
export interface FarmAdminSeedsAdjustRequest {
  /** Số nguyên khác 0, |amount| ≤ `admin_adjust_max` — dương là cộng, âm là trừ. */
  amount: number;
  /** Bắt buộc, độ dài ≥ `admin_reason_min_len` ký tự — hiển thị lại cho nhân viên trong thông báo. */
  reason: string;
}

/** Response của `POST /admin/users/:id/seeds`. */
export interface FarmAdminSeedsAdjustResponse {
  user_id: number;
  amount: number;
  reason: string;
  balance_before: number;
  balance_after: number;
  audit_id: number;
  transaction_id: number | null;
  /**
   * `true` khi response này là kết quả đọc lại của một request trước đó có
   * cùng `Idempotency-Key` (replay) — KHÔNG áp dụng lại hiệu lực, chỉ trả
   * đúng kết quả đã ghi lần đầu.
   */
  replayed: boolean;
}

/** Một hạng mục trong bảng kết quả xem trước đặt lại nông trại (US-44). */
export interface FarmAdminResetPreviewItem {
  /** Nhãn tiếng Việt ngắn, hiển thị trực tiếp ở hộp xác nhận hai bước phía UI. */
  label: string;
  detail?: string;
}

/** Response chung của xem trước và thực hiện đặt lại nông trại (US-44). */
export interface FarmAdminResetPreview {
  user_id: number;
  /** Phần giữ nguyên: ngày vào làm, thâm niên, mốc Cây OCB, thành tựu, huy hiệu đang chọn. */
  kept: FarmAdminResetPreviewItem[];
  /** Phần bị mất: vật nuôi, cây trồng, trang trí, kho, Hạt OCB, chuỗi check-in, vùng đất đã mở. */
  lost: FarmAdminResetPreviewItem[];
}

/** Request của `POST /admin/users/:id/reset` (US-44). */
export interface FarmAdminResetRequest {
  /** Lý do đặt lại — hiển thị lại cho nhân viên trong thông báo (không bắt buộc độ dài tối thiểu như US-43). */
  reason?: string;
}

/** Response của `POST /admin/users/:id/reset` khi thực hiện thật (không phải xem trước). */
export interface FarmAdminResetResponse extends FarmAdminResetPreview {
  seeds: number;
  state: FarmStateJson;
  version: number;
  audit_id: number;
}

/** Response lỗi nghiệp vụ chung — khớp hình dạng `{ error, code, message, details? }` ở routes quản trị. */
export interface FarmAdminBusinessErrorResponse {
  error: true;
  code: FarmErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

// ----------------------------------------------------------------------------
// 11.1 Quản trị — cấu hình, thống kê, lưu vết (task 15.2, US-45, US-46, BR-27)
// ----------------------------------------------------------------------------

/** Request của `PUT /admin/config` — một hoặc nhiều thay đổi cùng lúc (US-45). */
export interface FarmAdminConfigPutRequest {
  updates: Array<{ key: string; value: number }>;
  /** Lý do thay đổi — không bắt buộc, lưu vào `farm_admin_audit.reason` cho mỗi khóa thay đổi. */
  reason?: string;
}

/** Response của `GET/PUT /admin/config` — cùng hình dạng `FarmConfigResponse` (admin xem cùng dữ liệu). */
export type FarmAdminConfigResponse = FarmConfigResponse;

/** Số lượt check-in của một ngày cụ thể, theo giờ Việt Nam (US-46). */
export interface FarmAdminStatsCheckinByDay {
  /** `YYYY-MM-DD` theo giờ Việt Nam. */
  date: string;
  count: number;
}

/** Loài vật nuôi (hoặc loại cây) phổ biến nhất kèm số lượng đang có trên toàn bộ nông trại (US-46). */
export interface FarmAdminStatsPopularEntry {
  code: string;
  count: number;
}

/** Một khoảng thâm niên trong phân bố thâm niên của `GET /admin/stats` (US-46). */
export interface FarmAdminStatsSeniorityBucket {
  /** Nhãn hiển thị, ví dụ "0-1 năm", "1-2 năm", "5+ năm". */
  label: string;
  /** Số năm tròn tối thiểu của khoảng (bao gồm). */
  min_years: number;
  /** Số năm tròn tối đa của khoảng (loại trừ) — `null` nghĩa là không giới hạn trên (khoảng cuối). */
  max_years: number | null;
  count: number;
}

/** Response của `GET /admin/stats` (US-46). */
export interface FarmAdminStatsResponse {
  /** Lọc theo phòng ban đã áp dụng, nếu có — `null` nghĩa là toàn bộ nhân viên. */
  department_id: number | null;
  total_farms: number;
  active_employees_7d: number;
  active_employees_30d: number;
  /** Lượt check-in theo từng ngày, 30 ngày gần nhất, sắp xếp theo ngày tăng dần. */
  checkins_by_day: FarmAdminStatsCheckinByDay[];
  /** Loài vật nuôi phổ biến nhất hiện có trên toàn bộ nông trại khớp bộ lọc — rỗng khi không có dữ liệu. */
  most_popular_animal_species: FarmAdminStatsPopularEntry[];
  /** Loại cây phổ biến nhất hiện có trên toàn bộ nông trại khớp bộ lọc — rỗng khi không có dữ liệu. */
  most_popular_plant_kind: FarmAdminStatsPopularEntry[];
  /** Phân bố thâm niên Cây OCB theo khoảng năm, sắp xếp theo `min_years` tăng dần. */
  seniority_distribution: FarmAdminStatsSeniorityBucket[];
  /** Mọi mốc thời gian trong response này tính theo giờ Việt Nam (UTC+7) — ISO string. */
  timezone_note: string;
  /** Thời điểm số liệu được tính (ISO, UTC+7) — số liệu tính trực tiếp mỗi lần gọi, không cache. */
  computed_at: string;
}

/** Một dòng trong `GET /admin/audit` — kèm tên hiển thị của người thực hiện/nhân viên bị tác động (BR-27). */
export interface FarmAdminAuditLogItem {
  id: number;
  admin_user_id: number;
  admin_full_name: string;
  admin_username: string;
  target_user_id: number | null;
  target_full_name: string | null;
  target_username: string | null;
  action: string;
  before_value: unknown;
  after_value: unknown;
  reason: string | null;
  occurred_at: string;
}

export interface FarmAdminAuditLogPage {
  items: FarmAdminAuditLogItem[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
}

// ============================================================================
// 12. Manifest tài nguyên 3D (`public/assets/ocb-farm/asset-manifest.json`)
// ============================================================================
//
// Chỉ có ở frontend — backend không đọc manifest. Manifest là NGUỒN CHÂN LÝ
// DUY NHẤT về danh sách tài nguyên 3D:
// - `AssetLoaderService` (task 11.2) chỉ nạp/render mã có khai báo ở đây; mã
//   không có trong manifest thì không nạp và không render.
// - Script kiểm ngân sách (task 10.9) cộng dung lượng gzip của đúng các file
//   thuộc mục có `initial: true` (khử trùng lặp theo đường dẫn — một file có
//   thể được nhiều mục dùng chung, ví dụ mô hình hạt/mầm chung của mọi cây).
// - Mã trang trí (`decors` key) phải khớp `decorGroupOfKind` ở
//   `backend/src/services/ocb-farm/commands/decor.commands.ts`; hiện tại mã
//   trang trí CHÍNH LÀ tên nhóm. Thêm mã cụ thể mới thì phải sửa cả hàm đó.
//
// _Requirements: US-36, US-39_

/** Màu hex `#RRGGBB` dùng cho khối hộp fallback khi mô hình tải lỗi (US-39). */
export type FarmAssetColor = string;

/** Đường dẫn file GLB (tương đối với base href) theo đủ 3 mức chất lượng (US-36). */
export type FarmAssetFileSet = Record<FarmQuality, string>;

/** Hạng mục dùng mô hình GLB tải từ thư mục tĩnh. */
export interface FarmGlbAssetEntry {
  source: 'glb';
  /** Tên hiển thị tiếng Việt — dùng trong danh sách hạng mục tải lỗi (US-39). */
  label: string;
  files: FarmAssetFileSet;
  /** `true` khi thuộc tập tải lần đầu — được tính vào ngân sách XN-1 (task 10.9). */
  initial: boolean;
  fallback_color: FarmAssetColor;
  /**
   * Mô hình thay thế cùng loại (dáng/màu khác). Khung 3D chọn ngẫu nhiên — tất định theo id
   * vật thể — giữa bản gốc và các biến thể. Mã tài nguyên của biến thể `i` là `<mã>#<i+1>`.
   */
  variants?: FarmGlbAssetEntry[];
}

/** Mã các hạng mục tự dựng bằng hình học sinh tại chỗ (task 10.10). */
export const FARM_PROCEDURAL_ASSET_KEYS = ['ocb_tree', 'terrain_grid', 'pond_water'] as const;
export type FarmProceduralAssetKey = (typeof FARM_PROCEDURAL_ASSET_KEYS)[number];

/** Hạng mục tự dựng — không có file GLB, nhận diện bằng nhãn `generator`. */
export interface FarmProceduralAssetEntry {
  source: 'procedural';
  label: string;
  /** Nhãn module sinh hình học tương ứng (task 10.10). */
  generator: FarmProceduralAssetKey;
  fallback_color: FarmAssetColor;
}

export type FarmAssetEntry = FarmGlbAssetEntry | FarmProceduralAssetEntry;

/** Tài nguyên của một loại cây: mỗi giai đoạn sinh trưởng một mô hình (US-17). */
export interface FarmPlantAssetEntry {
  label: string;
  category: PlantCategory;
  stages: Record<PlantStage, FarmGlbAssetEntry>;
}

/** Tài nguyên của một mã vật phẩm trang trí. */
export interface FarmDecorAssetEntry extends FarmGlbAssetEntry {
  group: DecorGroup;
  /** Nguồn sáng bật vào buổi đêm (US-30) — khớp `LIGHT_SOURCE_GROUPS` ở backend. */
  is_light: boolean;
}

/**
 * Mã các vật thể cố định đặt sẵn trong nông trại (mô hình GLB thật, khác `procedural`
 * là hình học tự sinh). Giống Cây OCB: luôn có mặt, không mua/bán/di chuyển/xoá, không
 * nằm trong `state.decors`. Mỗi mã có một ô cố định (`cell`) không đổi theo nông trại.
 */
export const FARM_FIXTURE_ASSET_KEYS = ['warehouse'] as const;
export type FarmFixtureAssetKey = (typeof FARM_FIXTURE_ASSET_KEYS)[number];

/** Tài nguyên của một vật thể cố định — thêm ô đặt cố định so với `FarmGlbAssetEntry`. */
export interface FarmFixtureAssetEntry extends FarmGlbAssetEntry {
  /** Ô cố định (`"hàng,cột"`) nơi vật thể luôn được dựng — giống `tree` ở ô trung tâm. */
  cell: FarmCellRef;
}

/** Toàn bộ nội dung `asset-manifest.json`. */
export interface FarmAssetManifest {
  /** Phiên bản hình dạng manifest. */
  schema: number;
  /** Ngân sách dung lượng gzip của tập tải lần đầu (XN-1), tính bằng byte. */
  initial_budget_bytes: number;
  /** Màu fallback cho trường hợp không xác định được loại vật thể. */
  default_fallback_color: FarmAssetColor;
  animals: Record<FarmSpecies, FarmGlbAssetEntry>;
  plants: Record<PlantKind, FarmPlantAssetEntry>;
  decors: Record<DecorKind, FarmDecorAssetEntry>;
  procedural: Record<FarmProceduralAssetKey, FarmProceduralAssetEntry>;
  /** Vật thể cố định đặt sẵn (nhà kho…) — tuỳ chọn để tương thích manifest cũ. */
  fixtures?: Record<FarmFixtureAssetKey, FarmFixtureAssetEntry>;
}
