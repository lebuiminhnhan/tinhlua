/**
 * OCB Farm — vật phẩm hỗ trợ (mua bằng Hạt OCB và dùng ngay trên một đối tượng):
 *
 * - `USE_GROWTH_POTION` — Thuốc tăng trưởng cho vật nuôi: hoàn tất NGAY chu kỳ tạo sản
 *   phẩm hiện tại (+1 sản phẩm chờ thu hoạch, chu kỳ mới bắt đầu từ bây giờ) và cho vật
 *   nuôi no lại. Không dùng cho loài không cho sản phẩm (ngựa) hoặc khi đã đầy trần
 *   tích lũy `offline_cap_per_entity`.
 * - `USE_SUPER_FERTILIZER` — Phân bón siêu cấp cho cây trồng: đưa cây lên NGAY giai
 *   đoạn kế tiếp, không cần phân hữu cơ, không bị giới hạn "mỗi giai đoạn một lần"
 *   của phân thường (BR-20), đồng thời tưới đủ nước. Không dùng khi cây đã sẵn sàng thu hoạch.
 *
 * Giá theo khóa cấu hình `boost_price_growth_potion` / `boost_price_super_fertilizer`
 * (seed `20261005_002_seed_farm_config_boost.sql`). Handler thuần, cùng chữ ký
 * `FarmCommandHandler` như các module lệnh khác.
 */

import { FarmStateJson, PLANT_STAGES } from '../../../types/ocb-farm.types';
import { FarmCommandHandler, fail, success } from './types';

const FULLNESS_MAX = 100;
const DEFAULT_POTION_PRICE = 100;
const DEFAULT_FERTILIZER_PRICE = 80;
const NO_PRODUCT_SPECIES = new Set(['horse']);

function price(config: Record<string, number>, key: string, fallback: number): number {
  const v = config[key];
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
}

function insufficient(required: number, balance: number) {
  return fail('INSUFFICIENT_SEEDS', `Không đủ Hạt OCB. Còn thiếu ${required - balance} Hạt OCB.`, {
    required,
    current_balance: balance,
    missing: required - balance,
  });
}

// ============================================================================
// USE_GROWTH_POTION
// ============================================================================

const useGrowthPotion: FarmCommandHandler<'USE_GROWTH_POTION'> = (state, payload, ctx) => {
  const index = state.animals.findIndex((a) => a.id === payload.animal_id);
  if (index === -1) return fail('ANIMAL_NOT_FOUND', 'Không tìm thấy vật nuôi này.');
  const animal = state.animals[index];

  if (NO_PRODUCT_SPECIES.has(animal.species)) {
    return fail('SPECIES_HAS_NO_PRODUCT', 'Ngựa không tạo sản phẩm nên không cần thuốc tăng trưởng.');
  }
  const cap = Math.max(ctx.config['offline_cap_per_entity'] ?? 0, 1);
  if (animal.pending >= cap) {
    return fail('ANIMAL_PENDING_FULL', 'Vật nuôi đã tích đầy sản phẩm — hãy thu hoạch trước khi dùng thuốc.', {
      pending: animal.pending,
      cap,
    });
  }

  const cost = price(ctx.config, 'boost_price_growth_potion', DEFAULT_POTION_PRICE);
  if (ctx.seeds < cost) return insufficient(cost, ctx.seeds);

  const nowIso = ctx.now.toISOString();
  const animals = [...state.animals];
  animals[index] = {
    ...animal,
    pending: animal.pending + 1,
    // Chu kỳ mới bắt đầu ngay — tiến độ cũ đã được "hoàn tất" bởi thuốc.
    cycle_started_at: nowIso,
    fullness: FULLNESS_MAX,
    fed_at: nowIso,
  };
  const next: FarmStateJson = { ...state, animals };

  return success(next, {
    seedsDelta: -cost,
    ledgerLines: [
      { kind: 'buy_boost', amount: -cost, refType: 'animal', refId: animal.id, note: 'Thuốc tăng trưởng' },
    ],
  });
};

// ============================================================================
// USE_SUPER_FERTILIZER
// ============================================================================

const useSuperFertilizer: FarmCommandHandler<'USE_SUPER_FERTILIZER'> = (state, payload, ctx) => {
  const index = state.plants.findIndex((p) => p.id === payload.plant_id);
  if (index === -1) return fail('PLANT_NOT_FOUND', 'Không tìm thấy cây này.');
  const plant = state.plants[index];

  const stageIndex = PLANT_STAGES.indexOf(plant.stage);
  if (plant.stage === 'ready' || stageIndex < 0 || stageIndex >= PLANT_STAGES.length - 1) {
    return fail('PLANT_STAGE_NOT_FERTILIZABLE', 'Cây đã sẵn sàng thu hoạch, không cần bón thêm.');
  }

  const cost = price(ctx.config, 'boost_price_super_fertilizer', DEFAULT_FERTILIZER_PRICE);
  if (ctx.seeds < cost) return insufficient(cost, ctx.seeds);

  const plants = [...state.plants];
  plants[index] = {
    ...plant,
    stage: PLANT_STAGES[stageIndex + 1],
    stage_elapsed_ms: 0,
    // Giai đoạn mới vẫn bón phân hữu cơ được (phân siêu cấp không chiếm lượt bón thường).
    fertilized_stage: plant.fertilized_stage === plant.stage ? null : plant.fertilized_stage,
    watered_at: ctx.now.toISOString(),
    ready_at: null,
  };

  return success(
    { ...state, plants },
    {
      seedsDelta: -cost,
      ledgerLines: [
        { kind: 'buy_boost', amount: -cost, refType: 'plant', refId: plant.id, note: 'Phân bón siêu cấp' },
      ],
    },
  );
};

export const BOOST_COMMAND_HANDLERS = {
  USE_GROWTH_POTION: useGrowthPotion,
  USE_SUPER_FERTILIZER: useSuperFertilizer,
};
