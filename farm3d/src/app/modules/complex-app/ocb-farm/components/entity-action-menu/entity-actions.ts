import {
  decorGroupOf,
  FLOWER_PLANT_KINDS,
  PLANT_STAGES,
  type AnimalProductKey,
  type DecorGroup,
  type DecorRotation,
  type FarmAnimal,
  type FarmCellRef,
  type FarmDecor,
  type FarmEntityKind,
  type FarmPlant,
  type FarmSpecies,
  type FarmStateJson,
  type FarmStorage,
  type PlantKind,
  type PlantStage,
  type StorageKey,
} from '../../models/ocb-farm.model';
import type { FarmEntityMarker } from '../../scene/entity-markers';
import { centerCellOf } from '../../scene/farm-scene-math';
import { PLANT_LABELS, PRODUCT_LABELS, SPECIES_LABELS } from '../offline-summary-dialog/offline-summary';
import { DECOR_DEFS, formatSeeds } from '../shop-panel/shop-catalog';

/**
 * OCB Farm — hàm thuần cho menu tương tác vật nuôi / cây trồng / trang trí (task 13.6).
 *
 * Mirror quy tắc của `backend/src/services/ocb-farm/commands/{animal,plant,decor}.commands.ts`
 * và `farm-simulation.ts` để UI vô hiệu hoá thao tác kèm lý do TRƯỚC khi gửi lệnh. Server
 * vẫn là nguồn chân lý: mọi giá trị ở đây chỉ là dự báo để hiển thị (đếm ngược, dấu hiệu).
 *
 * Dự báo theo thời gian: state client là ảnh chụp tại `syncedAtMs` (lần server tick gần
 * nhất); phần thời gian trôi qua sau đó được ước lượng theo đúng công thức mô phỏng.
 *
 * _Requirements: US-11, US-12, US-13, US-15, US-17, US-18, US-19, US-20, US-34_
 */

export const FULLNESS_MAX = 100;
const HOUR_MS = 3_600_000;
const STAGE_TRANSITIONS = PLANT_STAGES.length - 1;

export type FarmConfigValues = Readonly<Record<string, number>>;

/** Ngữ cảnh dự báo dùng chung cho mọi hàm trạng thái. */
export interface FarmStatusContext {
  values: FarmConfigValues;
  balance: number;
  nowMs: number;
  /** Thời điểm state client khớp với server (lần tick gần nhất). */
  syncedAtMs: number;
  /** Trời đang mưa → cây tự đủ nước (US-31). */
  raining: boolean;
}

// ---------------------------------------------------------------------------
// Bảng tra
// ---------------------------------------------------------------------------

export const ANIMAL_PRODUCT: Readonly<Partial<Record<FarmSpecies, AnimalProductKey>>> = {
  chicken: 'egg',
  cow: 'milk',
  sheep: 'wool',
  fish: 'fish',
  pig: 'manure',
};

export const SPECIES_ICONS: Readonly<Record<FarmSpecies, string>> = {
  chicken: 'bi bi-egg-fried',
  fish: 'bi bi-water',
  sheep: 'bi bi-cloud',
  pig: 'bi bi-piggy-bank',
  cow: 'bi bi-cup-straw',
  horse: 'bi bi-trophy',
};

const STAGE_LABELS: Readonly<Record<PlantStage, string>> = {
  seed: 'Hạt',
  sprout: 'Mầm',
  grown: 'Cây lớn',
  flowering: 'Ra hoa',
  ready: 'Sẵn sàng thu hoạch',
};

export function isFlower(kind: PlantKind): boolean {
  return (FLOWER_PLANT_KINDS as readonly string[]).includes(kind);
}

export function plantStorageKey(kind: PlantKind): StorageKey {
  return (isFlower(kind) ? `flower_${kind}` : `fruit_${kind}`) as StorageKey;
}

export function stageLabel(kind: PlantKind, stage: PlantStage): string {
  if (stage === 'flowering' && !isFlower(kind)) return 'Ra quả';
  return STAGE_LABELS[stage];
}

/** Nhóm của mã trang trí (`lamp` / `lamp_stand` → `lamp`). */
function groupOfDecor(kind: string): DecorGroup | null {
  return decorGroupOf(kind);
}

export function decorName(kind: string): string {
  const group = groupOfDecor(kind);
  return group ? DECOR_DEFS[group].name : 'Vật trang trí';
}

// ---------------------------------------------------------------------------
// Kinh tế (mirror backend)
// ---------------------------------------------------------------------------

export function animalPrice(species: FarmSpecies, values: FarmConfigValues): number {
  return values[`animal_price_${species}`] ?? 0;
}

/** Chi phí một lần cho ăn = `feed_cost_ratio`% giá mua, làm tròn xuống. */
export function feedCost(species: FarmSpecies, values: FarmConfigValues): number {
  return Math.floor(animalPrice(species, values) * ((values['feed_cost_ratio'] ?? 0) / 100));
}

/** Hoàn tiền khi bán lại = `resell_ratio`% giá mua, làm tròn xuống. */
export function refundOf(price: number, values: FarmConfigValues): number {
  return Math.floor(Math.max(price, 0) * ((values['resell_ratio'] ?? 0) / 100));
}

export function decorRefund(kind: string, values: FarmConfigValues): number {
  const group = groupOfDecor(kind);
  return group ? refundOf(values[`decor_price_${group}`] ?? 0, values) : 0;
}

export function storageTotal(storage: FarmStorage): number {
  return Object.values(storage).reduce<number>((sum, q) => sum + (q ?? 0), 0);
}

export function storageFull(state: FarmStateJson, values: FarmConfigValues): boolean {
  return storageTotal(state.storage) >= (values['storage_cap'] ?? 500);
}

// ---------------------------------------------------------------------------
// Định dạng
// ---------------------------------------------------------------------------

/** Đếm ngược dạng "2 ngày 3 giờ", "1 giờ 05 phút", "4 phút 09 giây", "9 giây". */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  if (d > 0) return `${d} ngày ${h} giờ`;
  if (h > 0) return `${h} giờ ${pad(m)} phút`;
  if (m > 0) return `${m} phút ${pad(s)} giây`;
  return `${s} giây`;
}

// ---------------------------------------------------------------------------
// Trạng thái dự báo
// ---------------------------------------------------------------------------

export interface AnimalStatus {
  /** Độ no dự báo 0..100. */
  fullness: number;
  /** Độ no bằng 0 → buồn, dừng tạo sản phẩm (US-12). */
  sad: boolean;
  full: boolean;
  productKey: AnimalProductKey | null;
  /** Số sản phẩm chờ thu hoạch (dự báo). */
  pending: number;
  /** Đã đạt trần tích lũy. */
  capped: boolean;
  /** Thời gian tới sản phẩm kế tiếp — `null` khi không tạo thêm (buồn, đạt trần, ngựa). */
  msToNextProduct: number | null;
}

export function animalStatus(animal: FarmAnimal, ctx: FarmStatusContext): AnimalStatus {
  const { values } = ctx;
  const elapsed = Math.max(0, ctx.nowMs - ctx.syncedAtMs);
  const decayPerMs = FULLNESS_MAX / (Math.max(values['fullness_decay_hours'] ?? 24, 0.0001) * HOUR_MS);
  const fullness = Math.max(0, animal.fullness - decayPerMs * elapsed);
  const sad = fullness <= 0;
  const productKey = ANIMAL_PRODUCT[animal.species] ?? null;

  let pending = animal.pending;
  let capped = false;
  let msToNextProduct: number | null = null;
  if (productKey) {
    const cap = Math.max(values['offline_cap_per_entity'] ?? 0, 0);
    const cycleMs = (values[`produce_cycle_${animal.species}`] ?? 0) * HOUR_MS;
    const productiveMs = animal.fullness > 0 ? Math.min(animal.fullness / decayPerMs, elapsed) : 0;
    if (cap > 0 && cycleMs > 0) {
      // Tiến độ chu kỳ mang sang từ lần đồng bộ (khớp `farm-simulation.ts`: tiến độ = mốc − `cycle_started_at`).
      const anchor = Date.parse(animal.cycle_started_at);
      const carried = Number.isFinite(anchor) ? Math.min(Math.max(ctx.syncedAtMs - anchor, 0), cycleMs - 1) : 0;
      const total = carried + productiveMs;
      pending = Math.min(Math.max(cap, animal.pending), animal.pending + Math.floor(total / cycleMs));
      capped = pending >= cap;
      if (!sad && !capped) msToNextProduct = cycleMs - (total % cycleMs);
    }
  }
  return {
    fullness,
    sad,
    full: fullness >= FULLNESS_MAX - 0.5,
    productKey,
    pending,
    capped,
    msToNextProduct,
  };
}

export interface PlantStatus {
  stage: PlantStage;
  stageLabel: string;
  ready: boolean;
  /** Thiếu nước → sinh trưởng tạm dừng (US-18). */
  thirsty: boolean;
  /** Thời gian còn lại tới giai đoạn kế tiếp — `null` khi đã sẵn sàng / chưa cấu hình. */
  remainingMs: number | null;
  /** Đã bón trong giai đoạn hiện tại (BR-20). */
  fertilizedThisStage: boolean;
  /** 0..100 — tiến độ trong giai đoạn hiện tại. */
  stagePercent: number;
}

export function plantStatus(plant: FarmPlant, ctx: FarmStatusContext): PlantStatus {
  const { values } = ctx;
  const durationMs = ((values[`grow_total_${plant.kind}`] ?? 0) * HOUR_MS) / STAGE_TRANSITIONS;
  const deadline = Date.parse(plant.watered_at) + (values['water_interval'] ?? 8) * HOUR_MS;
  const thirsty = !ctx.raining && !(ctx.nowMs < deadline);
  // Thời gian sinh trưởng thêm từ lần đồng bộ: chỉ tính khi đủ nước (đóng băng khi thiếu nước).
  const growEnd = ctx.raining ? ctx.nowMs : Math.min(ctx.nowMs, Number.isFinite(deadline) ? deadline : ctx.nowMs);
  let grow = Math.max(0, growEnd - ctx.syncedAtMs);

  let stage = plant.stage;
  let elapsed = plant.stage_elapsed_ms;
  if (durationMs > 0) {
    while (stage !== 'ready' && grow > 0) {
      const step = Math.min(grow, durationMs - elapsed);
      elapsed += step;
      grow -= step;
      if (elapsed >= durationMs) {
        stage = PLANT_STAGES[PLANT_STAGES.indexOf(stage) + 1] ?? 'ready';
        elapsed = 0;
      }
    }
  }
  const ready = stage === 'ready';
  return {
    stage,
    stageLabel: stageLabel(plant.kind, stage),
    ready,
    thirsty: thirsty && !ready,
    remainingMs: ready || durationMs <= 0 ? null : Math.max(0, durationMs - elapsed),
    fertilizedThisStage: plant.fertilized_stage === stage && stage === plant.stage,
    stagePercent: ready ? 100 : durationMs > 0 ? Math.min(100, Math.round((elapsed / durationMs) * 100)) : 0,
  };
}

// ---------------------------------------------------------------------------
// Menu tương tác trên một vật thể
// ---------------------------------------------------------------------------

export type EntityActionId =
  | 'feed'
  | 'harvest'
  | 'water'
  | 'fertilize'
  | 'potion'
  | 'superFertilize'
  | 'move'
  | 'rotate'
  | 'sell';

/** Giá mặc định khớp seed `20261005_002_seed_farm_config_boost.sql`. */
export const DEFAULT_POTION_PRICE = 100;
export const DEFAULT_SUPER_FERTILIZER_PRICE = 80;

export function potionPrice(values: FarmConfigValues): number {
  return values['boost_price_growth_potion'] ?? DEFAULT_POTION_PRICE;
}

export function superFertilizerPrice(values: FarmConfigValues): number {
  return values['boost_price_super_fertilizer'] ?? DEFAULT_SUPER_FERTILIZER_PRICE;
}

export interface EntityAction {
  id: EntityActionId;
  label: string;
  icon: string;
  /** Lý do vô hiệu hoá (tiếng Việt) — `null` là thực hiện được. */
  disabledReason: string | null;
  /** Chi phí Hạt OCB (cho ăn). */
  cost?: number;
}

export interface EntityRef {
  entityKind: FarmEntityKind;
  id: string;
}

export interface EntityDetail {
  ref: EntityRef;
  cell: FarmCellRef;
  title: string;
  icon: string;
  animal?: { species: FarmSpecies; status: AnimalStatus; feedCost: number; refund: number; productLabel: string | null };
  plant?: { kind: PlantKind; status: PlantStatus; fruit: boolean; productLabel: string };
  decor?: { kind: string; rotation: DecorRotation; refund: number };
  actions: EntityAction[];
  /** Ghi chú thêm (ví dụ ngựa không có sản phẩm thu hoạch). */
  note: string | null;
}

function missingSeedsReason(cost: number, balance: number): string | null {
  return balance < cost ? `Không đủ Hạt OCB — cần ${formatSeeds(cost)}, còn thiếu ${formatSeeds(cost - balance)}.` : null;
}

function animalDetail(state: FarmStateJson, a: FarmAnimal, ctx: FarmStatusContext): EntityDetail {
  const status = animalStatus(a, ctx);
  const cost = feedCost(a.species, ctx.values);
  const refund = refundOf(animalPrice(a.species, ctx.values), ctx.values);
  const actions: EntityAction[] = [
    {
      id: 'feed',
      label: 'Cho ăn',
      icon: 'bi bi-basket2',
      cost,
      disabledReason: status.full ? 'Vật nuôi đang no, không cần cho ăn.' : missingSeedsReason(cost, ctx.balance),
    },
  ];
  if (status.productKey) {
    let reason: string | null = null;
    if (status.pending <= 0) {
      reason = status.sad
        ? 'Chưa có sản phẩm. Vật nuôi đang buồn vì đói — cho ăn để tiếp tục tạo sản phẩm.'
        : status.msToNextProduct !== null
          ? `Chưa có sản phẩm, sản phẩm kế tiếp sau ${formatCountdown(status.msToNextProduct)}.`
          : 'Chưa có sản phẩm nào sẵn sàng.';
    } else if (storageFull(state, ctx.values)) {
      reason = 'Kho đã đầy — hãy bán bớt sản phẩm trong kho trước khi thu hoạch.';
    }
    actions.push({ id: 'harvest', label: 'Thu hoạch', icon: 'bi bi-basket', disabledReason: reason });
    // Thuốc tăng trưởng: hoàn tất ngay chu kỳ sản phẩm hiện tại (+1 sản phẩm), cho no lại.
    const potion = potionPrice(ctx.values);
    actions.push({
      id: 'potion',
      label: 'Thuốc tăng trưởng',
      icon: 'bi bi-capsule',
      cost: potion,
      disabledReason: status.capped
        ? 'Vật nuôi đã tích đầy sản phẩm — hãy thu hoạch trước.'
        : missingSeedsReason(potion, ctx.balance),
    });
  }
  actions.push(
    { id: 'move', label: 'Di chuyển', icon: 'bi bi-arrows-move', disabledReason: null },
    { id: 'sell', label: 'Bán', icon: 'bi bi-cash-coin', disabledReason: null },
  );
  return {
    ref: { entityKind: 'animal', id: a.id },
    cell: a.cell,
    title: SPECIES_LABELS[a.species],
    icon: SPECIES_ICONS[a.species],
    animal: {
      species: a.species,
      status,
      feedCost: cost,
      refund,
      productLabel: status.productKey ? PRODUCT_LABELS[status.productKey] : null,
    },
    actions,
    note:
      a.species === 'horse'
        ? 'Ngựa không có sản phẩm thu hoạch; ngựa ở trạng thái bình thường được cộng thưởng khi bán sản phẩm.'
        : null,
  };
}

function plantDetail(state: FarmStateJson, p: FarmPlant, ctx: FarmStatusContext): EntityDetail {
  const status = plantStatus(p, ctx);
  const manure = state.storage.manure ?? 0;
  const left = status.remainingMs !== null ? ` (còn ${formatCountdown(status.remainingMs)})` : '';
  const actions: EntityAction[] = [
    {
      id: 'water',
      label: 'Tưới nước',
      icon: 'bi bi-droplet',
      disabledReason: status.thirsty
        ? null
        : ctx.raining
          ? 'Trời đang mưa, cây đã đủ nước.'
          : 'Cây đã đủ nước, không cần tưới thêm.',
    },
    {
      id: 'fertilize',
      label: 'Bón phân',
      icon: 'bi bi-recycle',
      disabledReason: status.ready
        ? 'Cây đã sẵn sàng thu hoạch, không cần bón thêm.'
        : status.fertilizedThisStage
          ? 'Cây đã được bón phân trong giai đoạn này.'
          : manure < 1
            ? 'Hết phân hữu cơ — hãy thu hoạch phân từ heo.'
            : null,
    },
    {
      // Phân bón siêu cấp: lên ngay giai đoạn kế tiếp, không cần phân hữu cơ.
      id: 'superFertilize',
      label: 'Phân bón siêu cấp',
      icon: 'bi bi-lightning-charge-fill',
      cost: superFertilizerPrice(ctx.values),
      disabledReason: status.ready
        ? 'Cây đã sẵn sàng thu hoạch, không cần bón thêm.'
        : missingSeedsReason(superFertilizerPrice(ctx.values), ctx.balance),
    },
    {
      id: 'harvest',
      label: 'Thu hoạch',
      icon: 'bi bi-basket',
      disabledReason: !status.ready
        ? `Cây chưa tới lúc thu hoạch${left}.`
        : storageFull(state, ctx.values)
          ? 'Kho đã đầy — hãy bán bớt sản phẩm trong kho trước khi thu hoạch.'
          : null,
    },
    {
      id: 'move',
      label: 'Di chuyển',
      icon: 'bi bi-arrows-move',
      disabledReason: 'Cây đã trồng gắn cố định với ô đất, không di chuyển được.',
    },
  ];
  return {
    ref: { entityKind: 'plant', id: p.id },
    cell: p.cell,
    title: PLANT_LABELS[p.kind],
    icon: isFlower(p.kind) ? 'bi bi-flower1' : 'bi bi-tree',
    plant: { kind: p.kind, status, fruit: !isFlower(p.kind), productLabel: PRODUCT_LABELS[plantStorageKey(p.kind)] },
    actions,
    note: null,
  };
}

function decorDetail(d: FarmDecor, ctx: FarmStatusContext): EntityDetail {
  return {
    ref: { entityKind: 'decor', id: d.id },
    cell: d.cell,
    title: decorName(d.kind),
    icon: DECOR_DEFS[groupOfDecor(d.kind) ?? 'seasonal'].icon,
    decor: { kind: d.kind, rotation: d.rotation, refund: decorRefund(d.kind, ctx.values) },
    actions: [
      { id: 'move', label: 'Di chuyển', icon: 'bi bi-arrows-move', disabledReason: null },
      { id: 'rotate', label: 'Xoay 90°', icon: 'bi bi-arrow-clockwise', disabledReason: null },
      { id: 'sell', label: 'Bán', icon: 'bi bi-cash-coin', disabledReason: null },
    ],
    note: null,
  };
}

/** Chi tiết + thao tác của vật thể; `null` khi vật thể không còn (đã bán / thu hoạch hết). */
export function describeEntity(
  state: FarmStateJson | null,
  ref: EntityRef | null,
  ctx: FarmStatusContext,
): EntityDetail | null {
  if (!state || !ref) return null;
  switch (ref.entityKind) {
    case 'animal': {
      const a = state.animals.find((x) => x.id === ref.id);
      return a ? animalDetail(state, a, ctx) : null;
    }
    case 'plant': {
      const p = state.plants.find((x) => x.id === ref.id);
      return p ? plantDetail(state, p, ctx) : null;
    }
    case 'decor': {
      const d = state.decors.find((x) => x.id === ref.id);
      return d ? decorDetail(d, ctx) : null;
    }
  }
}

export function nextRotation(rotation: DecorRotation): DecorRotation {
  return ((rotation + 90) % 360) as DecorRotation;
}

// ---------------------------------------------------------------------------
// Thao tác hàng loạt (US-11, US-13, US-18)
// ---------------------------------------------------------------------------

export type BulkActionId = 'feed_all' | 'water_all' | 'harvest_all';

export interface BulkSummary {
  id: BulkActionId;
  /** Số đối tượng phù hợp (vật nuôi đói / cây thiếu nước / đối tượng có sản phẩm). */
  count: number;
  /** Tổng chi phí Hạt OCB nếu thực hiện cho toàn bộ. */
  totalCost: number;
  /** Cho ăn tất cả: số vật nuôi đủ tiền cho ăn theo thứ tự độ no thấp nhất trước. */
  affordableCount: number;
  /** Thu hoạch tất cả: tổng số sản phẩm dự kiến. */
  units: number;
  /** Thu hoạch tất cả: id cây đang sẵn sàng (gửi `HARVEST_PLANT` từng cây). */
  readyPlantIds: string[];
  /** Thu hoạch tất cả: còn vật nuôi có sản phẩm (gửi `HARVEST_ALL`). */
  hasAnimalProducts: boolean;
  disabledReason: string | null;
}

export function bulkSummary(id: BulkActionId, state: FarmStateJson | null, ctx: FarmStatusContext): BulkSummary {
  const base: BulkSummary = {
    id,
    count: 0,
    totalCost: 0,
    affordableCount: 0,
    units: 0,
    readyPlantIds: [],
    hasAnimalProducts: false,
    disabledReason: null,
  };
  if (!state) return { ...base, disabledReason: 'Nông trại chưa sẵn sàng.' };

  switch (id) {
    case 'feed_all': {
      if (state.animals.length === 0) return { ...base, disabledReason: 'Chưa có vật nuôi nào.' };
      const hungry = state.animals
        .map((a) => ({ a, s: animalStatus(a, ctx) }))
        .filter((x) => !x.s.full)
        .sort((x, y) => x.s.fullness - y.s.fullness);
      if (hungry.length === 0) return { ...base, disabledReason: 'Không có vật nuôi nào đang đói.' };
      let budget = ctx.balance;
      let affordable = 0;
      let total = 0;
      for (const { a } of hungry) {
        const cost = feedCost(a.species, ctx.values);
        total += cost;
        // Mirror server: bỏ qua con không đủ tiền, thử con kế tiếp.
        if (cost <= budget) {
          budget -= cost;
          affordable++;
        }
      }
      return {
        ...base,
        count: hungry.length,
        totalCost: total,
        affordableCount: affordable,
        disabledReason: affordable === 0 ? 'Không đủ Hạt OCB để cho ăn bất kỳ vật nuôi nào.' : null,
      };
    }
    case 'water_all': {
      if (state.plants.length === 0) return { ...base, disabledReason: 'Chưa có cây trồng nào.' };
      const thirsty = state.plants.filter((p) => plantStatus(p, ctx).thirsty).length;
      return {
        ...base,
        count: thirsty,
        disabledReason: thirsty === 0 ? 'Không có cây nào cần tưới.' : null,
      };
    }
    case 'harvest_all': {
      if (state.animals.length === 0 && state.plants.length === 0) {
        return { ...base, disabledReason: 'Chưa có vật nuôi hay cây trồng nào.' };
      }
      let count = 0;
      let units = 0;
      let nearest: number | null = null;
      const consider = (ms: number | null): void => {
        if (ms !== null && (nearest === null || ms < nearest)) nearest = ms;
      };
      let hasAnimalProducts = false;
      for (const a of state.animals) {
        const s = animalStatus(a, ctx);
        if (!s.productKey) continue;
        if (s.pending > 0) {
          count++;
          units += s.pending;
          hasAnimalProducts = true;
        } else consider(s.msToNextProduct);
      }
      const readyPlantIds: string[] = [];
      for (const p of state.plants) {
        const s = plantStatus(p, ctx);
        if (s.ready) {
          count++;
          units += ctx.values[`harvest_qty_${p.kind}`] ?? 1;
          readyPlantIds.push(p.id);
        } else if (!s.thirsty && s.remainingMs !== null) {
          // Ước lượng tới lúc sẵn sàng: phần còn lại của giai đoạn này + các giai đoạn sau.
          const duration = ((ctx.values[`grow_total_${p.kind}`] ?? 0) * HOUR_MS) / STAGE_TRANSITIONS;
          const stagesAfter = STAGE_TRANSITIONS - 1 - PLANT_STAGES.indexOf(s.stage);
          consider(s.remainingMs + Math.max(0, stagesAfter) * duration);
        }
      }
      let reason: string | null = null;
      if (count === 0) {
        reason =
          nearest !== null
            ? `Chưa có sản phẩm nào sẵn sàng — sản phẩm gần nhất sau ${formatCountdown(nearest)}.`
            : 'Chưa có sản phẩm nào sẵn sàng.';
      } else if (storageFull(state, ctx.values)) {
        reason = 'Kho đã đầy — hãy bán bớt sản phẩm trong kho trước khi thu hoạch.';
      }
      return { ...base, count, units, readyPlantIds, hasAnimalProducts, disabledReason: reason };
    }
  }
}

/** Số lượng thu được theo từng loại sản phẩm, so kho trước / sau khi thu hoạch. */
export function harvestResultRows(
  before: FarmStorage,
  after: FarmStorage,
): { key: StorageKey; label: string; quantity: number }[] {
  return (Object.keys(PRODUCT_LABELS) as StorageKey[])
    .map((key) => ({ key, label: PRODUCT_LABELS[key], quantity: (after[key] ?? 0) - (before[key] ?? 0) }))
    .filter((r) => r.quantity > 0)
    .sort((a, b) => b.quantity - a.quantity);
}

// ---------------------------------------------------------------------------
// Dấu hiệu 3D và di chuyển
// ---------------------------------------------------------------------------

/** Dấu hiệu trên vật thể: sẵn sàng thu hoạch ưu tiên hơn thiếu nước / buồn. */
export function entityMarkers(state: FarmStateJson | null, ctx: FarmStatusContext): FarmEntityMarker[] {
  if (!state) return [];
  const out: FarmEntityMarker[] = [];
  for (const a of state.animals) {
    const s = animalStatus(a, ctx);
    if (s.productKey && s.pending > 0) out.push({ id: a.id, cell: a.cell, kind: 'ready' });
    else if (s.sad) out.push({ id: a.id, cell: a.cell, kind: 'sad' });
  }
  for (const p of state.plants) {
    const s = plantStatus(p, ctx);
    if (s.ready) out.push({ id: p.id, cell: p.cell, kind: 'ready' });
    else if (s.thirsty) out.push({ id: p.id, cell: p.cell, kind: 'thirsty' });
  }
  return out;
}

/** Lý do không đặt được vật thể vào ô đích (mirror `canPlace`) — `null` là hợp lệ. */
export function moveBlockReason(state: FarmStateJson, ref: EntityRef, cell: FarmCellRef): string | null {
  if (ref.entityKind === 'plant') return 'Cây đã trồng không di chuyển được.';
  if (cell === centerCellOf(state.plots)) return 'Ô trung tâm dành riêng cho Cây OCB.';
  const plot = state.plots.find((p) => p.cells.includes(cell));
  if (!plot || !plot.unlocked) return 'Ô này thuộc vùng đất chưa mở khoá.';
  const species = ref.entityKind === 'animal' ? state.animals.find((a) => a.id === ref.id)?.species : undefined;
  const needWater = species === 'fish';
  if (plot.terrain !== (needWater ? 'water' : 'land')) {
    return needWater ? 'Cá chỉ thả được ở ô ao nước.' : 'Ô ao nước chỉ dành cho cá.';
  }
  const occupied =
    state.animals.some((a) => a.cell === cell && a.id !== ref.id) ||
    state.plants.some((p) => p.cell === cell && p.id !== ref.id) ||
    state.decors.some((d) => d.cell === cell && d.id !== ref.id);
  if (occupied) return 'Ô này đã có vật nuôi, cây hoặc vật trang trí khác.';
  return null;
}

/** Các ô đích hợp lệ để tô sáng khi đang di chuyển (không gồm ô hiện tại). */
export function moveTargets(state: FarmStateJson | null, ref: EntityRef | null, fromCell: FarmCellRef | null): FarmCellRef[] {
  if (!state || !ref) return [];
  const cells: FarmCellRef[] = [];
  for (const plot of state.plots) {
    if (!plot.unlocked) continue;
    for (const cell of plot.cells) {
      if (cell !== fromCell && moveBlockReason(state, ref, cell) === null) cells.push(cell);
    }
  }
  return cells;
}

/** Áp lạc quan: đổi ô của vật thể (server từ chối thì store tự hoàn tác). */
export function withEntityMoved(state: FarmStateJson, ref: EntityRef, cell: FarmCellRef): FarmStateJson {
  switch (ref.entityKind) {
    case 'animal':
      return { ...state, animals: state.animals.map((a) => (a.id === ref.id ? { ...a, cell } : a)) };
    case 'decor':
      return { ...state, decors: state.decors.map((d) => (d.id === ref.id ? { ...d, cell } : d)) };
    default:
      return state;
  }
}
