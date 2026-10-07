/**
 * OCB Farm — nhóm lệnh vật nuôi: `BUY_ANIMAL`, `FEED_ANIMAL`, `FEED_ALL`,
 * `HARVEST_ANIMAL`, `HARVEST_ALL`, `MOVE_ENTITY`, `SELL_ANIMAL`.
 *
 * Mọi handler ở đây THUẦN theo đúng chữ ký `FarmCommandHandler<C>` (xem
 * `types.ts`): không đọc/ghi DB, không gọi `tick()` (state truyền vào đã
 * được `farm-command.service.ts` tick tới `ctx.now` trước khi dispatch) —
 * chỉ nhận `state` đã tick + `payload` + `ctx` rồi trả `success()`/`fail()`.
 *
 * `MOVE_ENTITY` là lệnh chung cho cả vật nuôi/cây trồng/trang trí
 * (`FarmEntityKind`). Ở task 5.2 chỉ triển khai nhánh `entity_kind ===
 * 'animal'`; các nhánh `plant`/`decor` trả `INVALID_COMMAND` tạm thời cho
 * tới khi task 5.3/5.5 export một handler thay thế toàn bộ entry
 * `MOVE_ENTITY` trong `command-registry.ts` (xem TODO cạnh `moveEntity`).
 *
 * _Requirements: US-10, US-11, US-12, US-13, US-14, US-15, US-37, BR-15, BR-18, BR-28_
 */

import { randomUUID } from 'crypto';
import { canPlace } from '../farm-grid';
import { refund } from '../farm-economy';
import {
  FarmAnimal,
  FarmSpecies,
  FarmStateJson,
  StorageKey,
} from '../../../types/ocb-farm.types';
import { FarmCommandHandler, fail, success } from './types';

/** Sản phẩm thu hoạch của mỗi loài — ngựa không có sản phẩm (US-13, BR-15). */
const ANIMAL_PRODUCT_BY_SPECIES: Partial<Record<FarmSpecies, StorageKey>> = {
  chicken: 'egg',
  cow: 'milk',
  sheep: 'wool',
  fish: 'fish',
  pig: 'manure',
};

const FULLNESS_MAX = 100;

/** Giá mua của loài `species`, tra theo khóa cấu hình `animal_price_<species>`. */
function animalPrice(species: FarmSpecies, config: Record<string, number>): number {
  return config[`animal_price_${species}`] ?? 0;
}

/** Chi phí một lần cho ăn — `feed_cost_ratio`% giá mua của loài, làm tròn xuống. */
function feedCost(species: FarmSpecies, config: Record<string, number>): number {
  const ratioPercent = config['feed_cost_ratio'] ?? 0;
  return Math.floor(animalPrice(species, config) * (ratioPercent / 100));
}

function findAnimalIndex(state: FarmStateJson, animalId: string): number {
  return state.animals.findIndex((animal) => animal.id === animalId);
}

// ============================================================================
// BUY_ANIMAL (US-10, BR-18, BR-28)
// ============================================================================

const buyAnimal: FarmCommandHandler<'BUY_ANIMAL'> = (state, payload, ctx) => {
  const { species, cell } = payload;

  const maxAnimals = ctx.config['max_animals'] ?? 30;
  if (state.animals.length >= maxAnimals) {
    return fail('ANIMAL_LIMIT_REACHED', `Nông trại đã đạt giới hạn ${maxAnimals} vật nuôi.`, {
      current: state.animals.length,
      max: maxAnimals,
    });
  }

  const price = animalPrice(species, ctx.config);
  if (ctx.seeds < price) {
    return fail('INSUFFICIENT_SEEDS', `Không đủ Hạt OCB để mua vật nuôi này. Còn thiếu ${price - ctx.seeds} Hạt OCB.`, {
      required: price,
      current_balance: ctx.seeds,
      missing: price - ctx.seeds,
    });
  }

  const placement = canPlace(state, cell, 'animal', { species });
  if (!placement.ok) {
    return fail(placement.reason, buyAnimalPlacementMessage(placement.reason));
  }

  const newAnimal: FarmAnimal = {
    id: randomUUID(),
    species,
    cell,
    fed_at: ctx.now.toISOString(),
    fullness: FULLNESS_MAX,
    cycle_started_at: ctx.now.toISOString(),
    pending: 0,
  };

  const nextState: FarmStateJson = { ...state, animals: [...state.animals, newAnimal] };

  return success(nextState, {
    seedsDelta: -price,
    ledgerLines: [
      {
        kind: 'buy_animal',
        amount: -price,
        refType: 'animal',
        refId: newAnimal.id,
        note: `Mua ${species}`,
      },
    ],
  });
};

function buyAnimalPlacementMessage(reason: string): string {
  switch (reason) {
    case 'CENTER_CELL_RESERVED':
      return 'Ô trung tâm dành riêng cho Cây OCB, không thể đặt vật nuôi.';
    case 'PLOT_LOCKED':
    case 'INVALID_CELL':
      return 'Ô đã chọn thuộc vùng đất chưa mở khoá.';
    case 'WRONG_TERRAIN':
      return 'Sai loại địa hình cho loài vật nuôi này.';
    case 'CELL_OCCUPIED':
      return 'Ô đã chọn đã có vật nuôi hoặc vật phẩm khác.';
    default:
      return 'Không thể đặt vật nuôi vào ô đã chọn.';
  }
}

// ============================================================================
// FEED_ANIMAL (US-11)
// ============================================================================

const feedAnimal: FarmCommandHandler<'FEED_ANIMAL'> = (state, payload, ctx) => {
  const index = findAnimalIndex(state, payload.animal_id);
  if (index === -1) {
    return fail('ANIMAL_NOT_FOUND', 'Không tìm thấy vật nuôi này.');
  }

  const animal = state.animals[index];

  if (animal.fullness >= FULLNESS_MAX) {
    return fail('ANIMAL_ALREADY_FULL', 'Vật nuôi này đang no, không cần cho ăn.');
  }

  const cost = feedCost(animal.species, ctx.config);
  if (ctx.seeds < cost) {
    return fail('INSUFFICIENT_SEEDS', `Không đủ Hạt OCB để cho ăn. Cần ${cost} Hạt OCB.`, {
      required: cost,
      current_balance: ctx.seeds,
    });
  }

  const fedAnimal: FarmAnimal = {
    ...animal,
    fullness: FULLNESS_MAX,
    fed_at: ctx.now.toISOString(),
    cycle_started_at: ctx.now.toISOString(),
  };

  const animals = [...state.animals];
  animals[index] = fedAnimal;
  const nextState: FarmStateJson = { ...state, animals };

  return success(nextState, {
    seedsDelta: -cost,
    ledgerLines: [
      {
        kind: 'feed_animal',
        amount: -cost,
        refType: 'animal',
        refId: animal.id,
        note: `Cho ăn ${animal.species}`,
      },
    ],
  });
};

// ============================================================================
// FEED_ALL (US-11)
// ============================================================================

const feedAll: FarmCommandHandler<'FEED_ALL'> = (state, _payload, ctx) => {
  const hungryAnimals = state.animals
    .filter((animal) => animal.fullness < FULLNESS_MAX)
    .sort((a, b) => a.fullness - b.fullness);

  if (hungryAnimals.length === 0) {
    return fail('NOTHING_TO_FEED', 'Không có vật nuôi nào đang đói.');
  }

  let seedsAvailable = ctx.seeds;
  let totalCost = 0;
  const fedIds = new Set<string>();
  const ledgerLines: NonNullable<ReturnType<typeof success>['ledgerLines']> = [];

  for (const animal of hungryAnimals) {
    const cost = feedCost(animal.species, ctx.config);
    if (cost > seedsAvailable) {
      continue;
    }
    seedsAvailable -= cost;
    totalCost += cost;
    fedIds.add(animal.id);
    ledgerLines.push({
      kind: 'feed_animal',
      amount: -cost,
      refType: 'animal',
      refId: animal.id,
      note: `Cho ăn tất cả: ${animal.species}`,
    });
  }

  if (fedIds.size === 0) {
    return fail('INSUFFICIENT_SEEDS', 'Không đủ Hạt OCB để cho ăn bất kỳ vật nuôi nào.', {
      current_balance: ctx.seeds,
    });
  }

  const animals = state.animals.map((animal) =>
    fedIds.has(animal.id)
      ? { ...animal, fullness: FULLNESS_MAX, fed_at: ctx.now.toISOString(), cycle_started_at: ctx.now.toISOString() }
      : animal,
  );

  const fedCount = fedIds.size;
  const notFedCount = hungryAnimals.length - fedCount;

  return success(
    { ...state, animals },
    {
      seedsDelta: -totalCost,
      ledgerLines,
      notices:
        notFedCount > 0
          ? [
              {
                code: 'FEED_ALL_PARTIAL',
                level: 'warning',
                message: `Đã cho ăn ${fedCount} vật nuôi, còn ${notFedCount} vật nuôi chưa được cho ăn do không đủ Hạt OCB.`,
                data: { fed_count: fedCount, not_fed_count: notFedCount },
              },
            ]
          : [],
    },
  );
};

// ============================================================================
// HARVEST_ANIMAL (US-13, BR-15)
// ============================================================================

/** Tổng số lượng sản phẩm hiện có trong kho — dùng để kiểm tra trần `storage_cap` (BR-16/19). */
function storageTotal(state: FarmStateJson): number {
  return Object.values(state.storage).reduce((sum, qty) => sum + (qty ?? 0), 0);
}

const harvestAnimal: FarmCommandHandler<'HARVEST_ANIMAL'> = (state, payload, ctx) => {
  const index = findAnimalIndex(state, payload.animal_id);
  if (index === -1) {
    return fail('ANIMAL_NOT_FOUND', 'Không tìm thấy vật nuôi này.');
  }

  const animal = state.animals[index];
  const productKey = ANIMAL_PRODUCT_BY_SPECIES[animal.species];

  if (!productKey) {
    return fail('SPECIES_HAS_NO_PRODUCT', 'Ngựa không tạo ra sản phẩm thu hoạch được.');
  }

  if (animal.pending <= 0) {
    return fail('NO_PRODUCT_READY', 'Vật nuôi này chưa có sản phẩm nào sẵn sàng để thu hoạch.');
  }

  const storageCap = ctx.config['storage_cap'] ?? 500;
  if (storageTotal(state) >= storageCap) {
    return fail('STORAGE_FULL', 'Kho đã đầy, hãy bán sản phẩm trước khi thu hoạch thêm.', {
      storage_cap: storageCap,
    });
  }

  const quantity = animal.pending;
  const animals = [...state.animals];
  animals[index] = { ...animal, pending: 0 };

  const storage = {
    ...state.storage,
    [productKey]: (state.storage[productKey] ?? 0) + quantity,
  };

  return success({ ...state, animals, storage });
};

// ============================================================================
// HARVEST_ALL (US-13, BR-15)
// ============================================================================

const harvestAll: FarmCommandHandler<'HARVEST_ALL'> = (state, _payload, ctx) => {
  // Ngựa không có sản phẩm — bỏ qua lặng lẽ (không phải lỗi) vì đây là
  // thao tác hàng loạt (US-13 AC "ngựa không có nút thu hoạch").
  const harvestableAnimals = state.animals.filter((animal) => {
    const productKey = ANIMAL_PRODUCT_BY_SPECIES[animal.species];
    return productKey !== undefined && animal.pending > 0;
  });

  if (harvestableAnimals.length === 0) {
    return fail('NOTHING_TO_HARVEST', 'Chưa có sản phẩm nào sẵn sàng để thu hoạch.');
  }

  const storageCap = ctx.config['storage_cap'] ?? 500;
  let remainingCapacity = Math.max(storageCap - storageTotal(state), 0);

  if (remainingCapacity <= 0) {
    return fail('STORAGE_FULL', 'Kho đã đầy, hãy bán sản phẩm trước khi thu hoạch thêm.', {
      storage_cap: storageCap,
    });
  }

  const storage = { ...state.storage };
  const animals = [...state.animals];
  let anyHarvested = false;

  for (const animal of harvestableAnimals) {
    if (remainingCapacity <= 0) break;

    const productKey = ANIMAL_PRODUCT_BY_SPECIES[animal.species]!;
    const quantity = Math.min(animal.pending, remainingCapacity);
    if (quantity <= 0) continue;

    storage[productKey] = (storage[productKey] ?? 0) + quantity;
    remainingCapacity -= quantity;
    anyHarvested = true;

    const index = animals.findIndex((a) => a.id === animal.id);
    animals[index] = { ...animal, pending: animal.pending - quantity };
  }

  if (!anyHarvested) {
    return fail('STORAGE_FULL', 'Kho đã đầy, hãy bán sản phẩm trước khi thu hoạch thêm.', {
      storage_cap: storageCap,
    });
  }

  return success({ ...state, animals, storage });
};

// ============================================================================
// MOVE_ENTITY — nhánh vật nuôi (US-15); dispatcher tổng hợp theo
// `entity_kind` được ghép ở `command-registry.ts` (task 5.5) bằng cách gọi
// lại {@link moveAnimalEntity} cho nhánh `'animal'` và `moveDecorEntity`
// (decor.commands.ts) cho nhánh `'decor'` — `plant` tiếp tục không được hỗ
// trợ (xem ghi chú ở đầu `plant.commands.ts`: không có AC nào cho phép di
// chuyển cây đã trồng).
// ============================================================================

/**
 * Logic di chuyển một vật nuôi, dùng chung bởi cả `MOVE_ENTITY` (nhánh
 * `entity_kind === 'animal'`, qua dispatcher ở `command-registry.ts`) và
 * mọi nơi khác cần di chuyển vật nuôi — tách thành hàm export riêng để
 * `command-registry.ts` ghép dispatcher mà không phải viết lại logic.
 */
export function moveAnimalEntity(
  state: FarmStateJson,
  entityId: string,
  toCell: string,
): ReturnType<FarmCommandHandler<'MOVE_ENTITY'>> {
  const index = findAnimalIndex(state, entityId);
  if (index === -1) {
    return fail('ANIMAL_NOT_FOUND', 'Không tìm thấy vật nuôi này.');
  }

  const animal = state.animals[index];

  const placement = canPlace(state, toCell, 'animal', {
    species: animal.species,
    ignoreEntityId: animal.id,
  });
  if (!placement.ok) {
    return fail(placement.reason, buyAnimalPlacementMessage(placement.reason));
  }

  const animals = [...state.animals];
  animals[index] = { ...animal, cell: toCell };

  return success({ ...state, animals });
}

const moveEntity: FarmCommandHandler<'MOVE_ENTITY'> = (state, payload, _ctx) => {
  if (payload.entity_kind !== 'animal') {
    return fail('INVALID_COMMAND', 'Di chuyển loại thực thể này chưa được hỗ trợ.', {
      entity_kind: payload.entity_kind,
    });
  }

  return moveAnimalEntity(state, payload.entity_id, payload.to_cell);
};

// ============================================================================
// SELL_ANIMAL (US-15)
// ============================================================================

const sellAnimal: FarmCommandHandler<'SELL_ANIMAL'> = (state, payload, ctx) => {
  const index = findAnimalIndex(state, payload.animal_id);
  if (index === -1) {
    return fail('ANIMAL_NOT_FOUND', 'Không tìm thấy vật nuôi này.');
  }

  const animal = state.animals[index];
  const purchasePrice = animalPrice(animal.species, ctx.config);
  const refundAmount = refund(purchasePrice, ctx.config);

  const animals = state.animals.filter((a) => a.id !== animal.id);

  return success(
    { ...state, animals },
    {
      seedsDelta: refundAmount,
      ledgerLines: [
        {
          kind: 'sell_animal',
          amount: refundAmount,
          refType: 'animal',
          refId: animal.id,
          note: `Bán ${animal.species}`,
        },
      ],
    },
  );
};

// ============================================================================
// Đăng ký — export để `command-registry.ts` spread vào `COMMAND_REGISTRY`
// ============================================================================

export const ANIMAL_COMMAND_HANDLERS = {
  BUY_ANIMAL: buyAnimal,
  FEED_ANIMAL: feedAnimal,
  FEED_ALL: feedAll,
  HARVEST_ANIMAL: harvestAnimal,
  HARVEST_ALL: harvestAll,
  MOVE_ENTITY: moveEntity,
  SELL_ANIMAL: sellAnimal,
};
