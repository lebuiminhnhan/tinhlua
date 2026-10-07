/**
 * OCB Farm — nhóm lệnh cây trồng: `PLANT_SEED`, `WATER_PLANT`, `WATER_ALL`,
 * `FERTILIZE_PLANT`, `HARVEST_PLANT`.
 *
 * Mọi handler ở đây THUẦN theo đúng chữ ký `FarmCommandHandler<C>` (xem
 * `types.ts`): không đọc/ghi DB, không gọi `tick()` (state truyền vào đã
 * được `farm-command.service.ts` tick tới `ctx.now` trước khi dispatch) —
 * chỉ nhận `state` đã tick + `payload` + `ctx` rồi trả `success()`/`fail()`.
 *
 * Bán kính nghiệp vụ phải khớp đúng ngữ nghĩa mà `farm-simulation.ts` dùng
 * khi mô phỏng offline, vì cả hai cùng đọc/viết đúng các trường của
 * `FarmPlant`:
 * - `stage_elapsed_ms`: thời gian đã tích lũy trong giai đoạn hiện tại
 *   (ms), đóng băng khi thiếu nước — `tick()` cộng dần vào đây, các handler
 *   ở đây (đặc biệt `FERTILIZE_PLANT`) phải thao tác đúng cùng đơn vị.
 * - `watered_at`: mốc tưới gần nhất — cây được coi là đủ nước khi
 *   `now < watered_at + water_interval` (xem `isWithinWaterInterval` trong
 *   `farm-simulation.ts`); `WATER_PLANT`/`WATER_ALL` chỉ set lại mốc này.
 * - `ready_at`: trường khai báo trong kiểu nhưng KHÔNG được `tick()` tính
 *   toán hay sử dụng (nguồn chân lý duy nhất về tiến độ sinh trưởng là
 *   `stage_elapsed_ms`) — các handler ở đây giữ nguyên quy ước đó, luôn để
 *   `null` khi chưa xác định thay vì tự suy ra một giá trị không ai đọc.
 *
 * `MOVE_ENTITY` KHÔNG có nhánh `plant` ở đây: rà lại US-16..US-20 không có
 * AC nào cho phép di chuyển một cây đã trồng sang ô khác (ô đất là cố định
 * một khi đã trồng — chỉ có trồng mới / thu hoạch / bón / tưới / bán sản
 * phẩm; hoa "hết vòng đời" khi thu hoạch chứ không di chuyển). Vì vậy entry
 * `MOVE_ENTITY` trong `command-registry.ts` được giữ nguyên như task 5.2 để
 * lại (chỉ xử lý `entity_kind === 'animal'`), và nhánh `plant` tiếp tục trả
 * `INVALID_COMMAND` — không mở rộng ở task này.
 *
 * _Requirements: US-16, US-17, US-18, US-19, US-20, BR-16, BR-19, BR-20_
 */

import { randomUUID } from 'crypto';
import { canPlace } from '../farm-grid';
import {
  FarmPlant,
  FarmStateJson,
  FLOWER_PLANT_KINDS,
  FlowerPlantKind,
  FRUIT_PLANT_KINDS,
  FruitPlantKind,
  PLANT_STAGES,
  PlantKind,
  PlantStage,
  StorageKey,
} from '../../../types/ocb-farm.types';
import { FarmCommandHandler, fail, success } from './types';

/** `true` khi `kind` là một trong 3 loại hoa (US-16) — còn lại là cây ăn quả. */
function isFlowerKind(kind: PlantKind): kind is FlowerPlantKind {
  return (FLOWER_PLANT_KINDS as readonly string[]).includes(kind);
}

/** Khóa kho tương ứng với sản phẩm của một loại cây — tiền tố theo `StorageKey`. */
function plantStorageKey(kind: PlantKind): StorageKey {
  return (isFlowerKind(kind) ? `flower_${kind}` : `fruit_${kind}`) as StorageKey;
}

/** Giá hạt giống của loại cây `kind`, tra theo khóa cấu hình `seed_price_<kind>`. */
function seedPrice(kind: PlantKind, config: Record<string, number>): number {
  return config[`seed_price_${kind}`] ?? 0;
}

/** Số lượng sản phẩm thu được mỗi lần thu hoạch loại cây `kind`, theo cấu hình `harvest_qty_<kind>`. */
function harvestQuantity(kind: PlantKind, config: Record<string, number>): number {
  return config[`harvest_qty_${kind}`] ?? 1;
}

/** Tổng số lượng sản phẩm hiện có trong kho — dùng để kiểm tra trần `storage_cap` (BR-19). */
function storageTotal(state: FarmStateJson): number {
  return Object.values(state.storage).reduce((sum, qty) => sum + (qty ?? 0), 0);
}

/** Thời gian (ms) cần để đi qua một giai đoạn của loại cây `kind` — khớp `stageDurationMs` trong `farm-simulation.ts`. */
const PLANT_STAGE_TRANSITIONS = PLANT_STAGES.length - 1;

function stageDurationMs(kind: PlantKind, config: Record<string, number>): number {
  const totalHours = config[`grow_total_${kind}`] ?? 0;
  if (totalHours <= 0) return 0;
  return (totalHours * 60 * 60 * 1000) / PLANT_STAGE_TRANSITIONS;
}

/** `true` khi cây hiện đang đủ nước tại `now`, theo đúng ngữ nghĩa `farm-simulation.ts`. */
function isPlantWatered(plant: FarmPlant, now: Date, config: Record<string, number>): boolean {
  const waterIntervalHours = config['water_interval'] ?? 8;
  const deadline = new Date(plant.watered_at).getTime() + waterIntervalHours * 60 * 60 * 1000;
  return now.getTime() < deadline;
}

function findPlantIndex(state: FarmStateJson, plantId: string): number {
  return state.plants.findIndex((plant) => plant.id === plantId);
}

function plantPlacementMessage(reason: string): string {
  switch (reason) {
    case 'CENTER_CELL_RESERVED':
      return 'Ô trung tâm dành riêng cho Cây OCB, không thể trồng cây.';
    case 'PLOT_LOCKED':
    case 'INVALID_CELL':
      return 'Ô đã chọn thuộc vùng đất chưa mở khoá.';
    case 'WRONG_TERRAIN':
      return 'Cây chỉ trồng được trên đất, không trồng được trên ao nước.';
    case 'CELL_OCCUPIED':
      return 'Ô đã chọn đã có cây hoặc vật phẩm khác.';
    default:
      return 'Không thể trồng cây vào ô đã chọn.';
  }
}

// ============================================================================
// PLANT_SEED (US-16, BR-19)
// ============================================================================

const plantSeed: FarmCommandHandler<'PLANT_SEED'> = (state, payload, ctx) => {
  const { kind, cell } = payload;

  const isKnownKind =
    (FRUIT_PLANT_KINDS as readonly string[]).includes(kind) ||
    (FLOWER_PLANT_KINDS as readonly string[]).includes(kind);
  if (!isKnownKind) {
    return fail('INVALID_PAYLOAD', 'Loại hạt giống không hợp lệ.', { kind });
  }

  const maxPlants = ctx.config['max_plants'] ?? 40;
  if (state.plants.length >= maxPlants) {
    return fail('PLANT_LIMIT_REACHED', `Nông trại đã đạt giới hạn ${maxPlants} cây trồng.`, {
      current: state.plants.length,
      max: maxPlants,
    });
  }

  const price = seedPrice(kind, ctx.config);
  if (ctx.seeds < price) {
    return fail('INSUFFICIENT_SEEDS', `Không đủ Hạt OCB để mua hạt giống này. Còn thiếu ${price - ctx.seeds} Hạt OCB.`, {
      required: price,
      current_balance: ctx.seeds,
      missing: price - ctx.seeds,
    });
  }

  const placement = canPlace(state, cell, 'plant');
  if (!placement.ok) {
    return fail(placement.reason, plantPlacementMessage(placement.reason));
  }

  const newPlant: FarmPlant = {
    id: randomUUID(),
    kind,
    cell,
    stage: 'seed',
    stage_elapsed_ms: 0,
    watered_at: ctx.now.toISOString(),
    fertilized_stage: null,
    ready_at: null,
  };

  const nextState: FarmStateJson = { ...state, plants: [...state.plants, newPlant] };

  return success(nextState, {
    seedsDelta: -price,
    ledgerLines: [
      {
        kind: 'buy_seed',
        amount: -price,
        refType: 'plant',
        refId: newPlant.id,
        note: `Trồng ${kind}`,
      },
    ],
  });
};

// ============================================================================
// WATER_PLANT (US-18)
// ============================================================================

const waterPlant: FarmCommandHandler<'WATER_PLANT'> = (state, payload, ctx) => {
  const index = findPlantIndex(state, payload.plant_id);
  if (index === -1) {
    return fail('PLANT_NOT_FOUND', 'Không tìm thấy cây này.');
  }

  const plant = state.plants[index];

  // Cây đã đủ nước — từ chối mà KHÔNG đổi `watered_at`, để không kéo dài
  // chu kỳ khát nước (US-18, AC "không kéo dài chu kỳ khát nước").
  if (isPlantWatered(plant, ctx.now, ctx.config)) {
    return fail('PLANT_ALREADY_WATERED', 'Cây này đã đủ nước, không cần tưới thêm.');
  }

  const plants = [...state.plants];
  plants[index] = { ...plant, watered_at: ctx.now.toISOString() };

  return success({ ...state, plants });
};

// ============================================================================
// WATER_ALL (US-18)
// ============================================================================

const waterAll: FarmCommandHandler<'WATER_ALL'> = (state, _payload, ctx) => {
  const thirstyPlants = state.plants.filter((plant) => !isPlantWatered(plant, ctx.now, ctx.config));

  if (thirstyPlants.length === 0) {
    return fail('NOTHING_TO_WATER', 'Không có cây nào đang thiếu nước.');
  }

  const thirstyIds = new Set(thirstyPlants.map((plant) => plant.id));
  const plants = state.plants.map((plant) =>
    thirstyIds.has(plant.id) ? { ...plant, watered_at: ctx.now.toISOString() } : plant,
  );

  return success(
    { ...state, plants },
    {
      notices: [
        {
          code: 'RAIN_WATERED_PLANTS',
          level: 'success',
          message: `Đã tưới ${thirstyPlants.length} cây đang thiếu nước.`,
          data: { watered_count: thirstyPlants.length },
        },
      ],
    },
  );
};

// ============================================================================
// FERTILIZE_PLANT (US-19, BR-20)
// ============================================================================

const fertilizePlant: FarmCommandHandler<'FERTILIZE_PLANT'> = (state, payload, ctx) => {
  const index = findPlantIndex(state, payload.plant_id);
  if (index === -1) {
    return fail('PLANT_NOT_FOUND', 'Không tìm thấy cây này.');
  }

  const plant = state.plants[index];

  if (plant.stage === 'ready') {
    return fail('PLANT_STAGE_NOT_FERTILIZABLE', 'Cây đã sẵn sàng thu hoạch, không cần bón thêm.');
  }

  if (plant.fertilized_stage === plant.stage) {
    return fail('PLANT_ALREADY_FERTILIZED_IN_STAGE', 'Cây này đã được bón phân trong giai đoạn hiện tại.');
  }

  const manureCount = state.storage['manure'] ?? 0;
  if (manureCount < 1) {
    return fail('NO_MANURE', 'Hết phân hữu cơ, hãy thu hoạch thêm từ heo.');
  }

  const duration = stageDurationMs(plant.kind, ctx.config);
  const remainingMs = Math.max(duration - plant.stage_elapsed_ms, 0);
  const reductionRatioPercent = ctx.config['fertilize_reduction'] ?? 0;
  const reductionMs = remainingMs * (reductionRatioPercent / 100);

  const currentStage = plant.stage;
  let nextStage: PlantStage = currentStage;
  let nextStageElapsedMs: number;

  if (duration <= 0 || reductionMs >= remainingMs) {
    // Mức giảm vượt hoặc bằng thời gian còn lại — chuyển ngay sang giai
    // đoạn kế tiếp, phần giảm vượt quá KHÔNG được chuyển tiếp (US-19, BR-20).
    const stageIndex = PLANT_STAGES.indexOf(currentStage);
    const next = stageIndex >= 0 && stageIndex < PLANT_STAGES.length - 1 ? PLANT_STAGES[stageIndex + 1] : currentStage;
    nextStage = next;
    nextStageElapsedMs = 0;
  } else {
    nextStageElapsedMs = plant.stage_elapsed_ms + reductionMs;
  }

  const plants = [...state.plants];
  plants[index] = {
    ...plant,
    stage: nextStage,
    stage_elapsed_ms: nextStage === 'ready' ? 0 : nextStageElapsedMs,
    // `fertilized_stage` ghi nhận GIAI ĐOẠN TRƯỚC KHI tiến (nếu có) — một
    // cây vừa chuyển giai đoạn nhờ bón phân vẫn bón được lần nữa ở giai
    // đoạn mới, vì giai đoạn mới chưa từng được bón (US-19).
    fertilized_stage: currentStage,
  };

  const storage = { ...state.storage, manure: manureCount - 1 };

  return success({ ...state, plants, storage });
};

// ============================================================================
// HARVEST_PLANT (US-20, BR-19)
// ============================================================================

const harvestPlant: FarmCommandHandler<'HARVEST_PLANT'> = (state, payload, ctx) => {
  const index = findPlantIndex(state, payload.plant_id);
  if (index === -1) {
    return fail('PLANT_NOT_FOUND', 'Không tìm thấy cây này.');
  }

  const plant = state.plants[index];

  if (plant.stage !== 'ready') {
    return fail('PLANT_NOT_READY', 'Cây này chưa tới lúc thu hoạch.');
  }

  const storageCap = ctx.config['storage_cap'] ?? 500;
  if (storageTotal(state) >= storageCap) {
    return fail('STORAGE_FULL', 'Kho đã đầy, hãy bán sản phẩm trước khi thu hoạch thêm.', {
      storage_cap: storageCap,
    });
  }

  const storageKey = plantStorageKey(plant.kind);
  const quantity = harvestQuantity(plant.kind, ctx.config);
  const storage = {
    ...state.storage,
    [storageKey]: (state.storage[storageKey] ?? 0) + quantity,
  };

  let plants: FarmPlant[];

  if (isFlowerKind(plant.kind)) {
    // Hoa hết vòng đời sau khi thu hoạch — xoá khỏi state, giải phóng ô (US-20).
    plants = state.plants.filter((p) => p.id !== plant.id);
  } else {
    // Cây ăn quả quay lại giai đoạn ra quả, giữ nguyên ô, bắt đầu lại chu kỳ (US-20).
    plants = [...state.plants];
    plants[index] = {
      ...plant,
      stage: 'flowering',
      stage_elapsed_ms: 0,
      fertilized_stage: null,
      ready_at: null,
    };
  }

  return success({ ...state, plants, storage });
};

// ============================================================================
// Đăng ký — export để `command-registry.ts` spread vào `COMMAND_REGISTRY`
// ============================================================================

export const PLANT_COMMAND_HANDLERS = {
  PLANT_SEED: plantSeed,
  WATER_PLANT: waterPlant,
  WATER_ALL: waterAll,
  FERTILIZE_PLANT: fertilizePlant,
  HARVEST_PLANT: harvestPlant,
};
