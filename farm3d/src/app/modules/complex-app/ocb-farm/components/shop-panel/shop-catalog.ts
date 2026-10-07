import {
  DECOR_GROUPS,
  DecorGroup,
  decorGroupOf,
  FARM_SPECIES,
  FLOWER_PLANT_KINDS,
  FRUIT_PLANT_KINDS,
  FarmCellRef,
  FarmLimits,
  FarmSpecies,
  FarmStateJson,
  FarmTerrain,
  PlantKind,
  SeasonTheme,
} from '../../models/ocb-farm.model';
import { centerCellOf } from '../../scene/farm-scene-math';
import { formatSeniority } from '../onboarding-wizard/join-date';

/**
 * OCB Farm — danh mục cửa hàng (thuần, không phụ thuộc Angular).
 *
 * Dựng danh sách vật phẩm của 3 tab (vật nuôi / hạt giống / trang trí) từ cấu hình
 * `GET /config`, trạng thái nông trại, số dư, giới hạn nhóm, dịp lễ và thâm niên, rồi
 * gắn lý do chặn mua cho từng vật phẩm. Server vẫn là nơi kiểm tra cuối cùng — ở đây
 * chỉ để niêm yết đúng và chặn sớm thao tác chắc chắn bị từ chối.
 *
 * Khoá thâm niên (US-49): đọc khoá cấu hình tuỳ chọn
 * `seniority_unlock_<tab>_<code>` (số tháng thâm niên cần đạt). Không có khoá → vật
 * phẩm không bị khoá theo thâm niên.
 *
 * _Requirements: US-10, US-16, US-33, US-34, US-37, US-49_
 */

export type ShopTab = 'animal' | 'seed' | 'decor' | 'boost';

/** Mã vật phẩm hỗ trợ — mua là dùng ngay trên một vật nuôi / cây trồng. */
export type BoostCode = 'growth_potion' | 'super_fertilizer';

export const BOOST_DEFS: Record<BoostCode, CatalogDef & { priceKey: string; defaultPrice: number }> = {
  growth_potion: {
    name: 'Thuốc tăng trưởng',
    icon: 'bi bi-capsule',
    note: 'Vật nuôi cho sản phẩm ngay lập tức và no bụng trở lại',
    priceKey: 'boost_price_growth_potion',
    defaultPrice: 100,
  },
  super_fertilizer: {
    name: 'Phân bón siêu cấp',
    icon: 'bi bi-lightning-charge-fill',
    note: 'Cây lên ngay giai đoạn kế tiếp, không cần phân hữu cơ',
    priceKey: 'boost_price_super_fertilizer',
    defaultPrice: 80,
  },
};

export function isBoostCode(code: string): code is BoostCode {
  return code === 'growth_potion' || code === 'super_fertilizer';
}

export interface BoostTarget {
  id: string;
  label: string;
}

/** Đối tượng dùng được vật phẩm hỗ trợ (khớp điều kiện server ở `boost.commands.ts`). */
export function boostTargets(
  code: BoostCode,
  state: FarmStateJson | null,
  values: Record<string, number> | null,
): BoostTarget[] {
  if (!state) return [];
  if (code === 'growth_potion') {
    const cap = Math.max(values?.['offline_cap_per_entity'] ?? 1, 1);
    return state.animals
      .filter((a) => a.species !== 'horse' && a.pending < cap)
      .map((a) => ({ id: a.id, label: `${ANIMAL_DEFS[a.species].name} — ô ${a.cell} (chờ thu: ${a.pending})` }));
  }
  return state.plants
    .filter((p) => p.stage !== 'ready')
    .map((p) => ({ id: p.id, label: `${PLANT_DEFS[p.kind].name} — ô ${p.cell} (${PLANT_STAGE_NAMES[p.stage]})` }));
}

const PLANT_STAGE_NAMES: Record<string, string> = {
  seed: 'hạt',
  sprout: 'mầm',
  grown: 'cây lớn',
  flowering: 'ra hoa',
  ready: 'chín',
};

export type ShopBlockReason =
  /** Chưa tải được bảng giá từ cấu hình. */
  | 'no_price'
  /** Chưa đạt mốc thâm niên yêu cầu (US-49). */
  | 'seniority_locked'
  /** Nhóm đã đạt giới hạn số lượng (US-37). */
  | 'limit_reached'
  /** Không còn ô trống phù hợp địa hình (US-16). */
  | 'no_free_cell'
  /** Thiếu Hạt OCB (US-10, US-16, US-34). */
  | 'insufficient_seeds';

export interface ShopItem {
  tab: ShopTab;
  /** Mã gửi lên lệnh: loài (`BUY_ANIMAL`), loại cây (`PLANT_SEED`) hoặc mã trang trí (`BUY_DECOR`). */
  code: string;
  name: string;
  icon: string;
  /** Mô tả ngắn (sản phẩm, loại cây...). */
  note: string;
  price: number | null;
  /** Tổng thời gian sinh trưởng (giờ) — chỉ có ở hạt giống (US-16). */
  growHours: number | null;
  /** Chu kỳ tạo sản phẩm (giờ) — chỉ có ở vật nuôi cho sản phẩm. */
  cycleHours: number | null;
  terrain: FarmTerrain;
  /** Vật phẩm giới hạn theo dịp lễ (US-33). */
  seasonal: boolean;
  seasonName: string | null;
  /** Mốc thâm niên cần đạt (tháng) — `null` khi không khoá theo thâm niên (US-49). */
  requiredMonths: number | null;
  requiredLabel: string | null;
  /** Đã mở khoá nhờ đạt mốc thâm niên (chỉ khi `requiredMonths` khác `null`). */
  unlockedBySeniority: boolean;
  block: ShopBlockReason | null;
  /** Số Hạt OCB còn thiếu (0 khi đủ). */
  missing: number;
}

export interface ShopGroupCount {
  current: number;
  max: number | null;
}

export interface ShopContext {
  values: Record<string, number> | null;
  state: FarmStateJson | null;
  balance: number;
  limits: FarmLimits | null;
  seasonTheme: SeasonTheme | null;
  seasonName: string | null;
  seniorityMonths: number;
  /** Mã trang trí từ manifest 3D; rỗng/thiếu → niêm yết theo nhóm như cũ. */
  decorCatalog?: readonly DecorCatalogEntry[];
}

export const SHOP_TABS: readonly { id: ShopTab; label: string; icon: string }[] = [
  { id: 'animal', label: 'Vật nuôi', icon: 'bi bi-piggy-bank' },
  { id: 'seed', label: 'Hạt giống', icon: 'bi bi-flower1' },
  { id: 'decor', label: 'Trang trí', icon: 'bi bi-lamp' },
  { id: 'boost', label: 'Hỗ trợ', icon: 'bi bi-lightning-charge' },
];

interface CatalogDef {
  name: string;
  icon: string;
  note: string;
}

export const ANIMAL_DEFS: Record<FarmSpecies, CatalogDef> = {
  chicken: { name: 'Gà', icon: 'bi bi-egg', note: 'Cho trứng' },
  fish: { name: 'Cá', icon: 'bi bi-water', note: 'Cho cá tươi · chỉ thả ở ao nước' },
  sheep: { name: 'Cừu', icon: 'bi bi-cloud', note: 'Cho len' },
  pig: { name: 'Heo', icon: 'bi bi-piggy-bank', note: 'Cho phân hữu cơ để bón cây' },
  cow: { name: 'Bò', icon: 'bi bi-cup-straw', note: 'Cho sữa' },
  horse: { name: 'Ngựa', icon: 'bi bi-trophy', note: 'Không cho sản phẩm · tăng giá bán' },
};

export const PLANT_DEFS: Record<PlantKind, CatalogDef> = {
  banana: { name: 'Chuối', icon: 'bi bi-tree', note: 'Cây ăn quả · thu hoạch nhiều lần' },
  orange: { name: 'Cam', icon: 'bi bi-tree', note: 'Cây ăn quả · thu hoạch nhiều lần' },
  mango: { name: 'Xoài', icon: 'bi bi-tree', note: 'Cây ăn quả · thu hoạch nhiều lần' },
  sunflower: { name: 'Hướng dương', icon: 'bi bi-sun', note: 'Hoa · thu hoạch một lần' },
  daisy: { name: 'Hoa cúc', icon: 'bi bi-flower2', note: 'Hoa · thu hoạch một lần' },
  rose: { name: 'Hoa hồng', icon: 'bi bi-flower1', note: 'Hoa · thu hoạch một lần' },
};

/**
 * Icon riêng cho một mã trang trí cụ thể (ghi đè icon chung của nhóm `DECOR_DEFS[group]`).
 * Dùng khi một biến thể khác hẳn hình dáng/công năng so với mã gốc của nhóm — ví dụ
 * `well_windmill` (cối xay gió) thuộc nhóm `well` (điểm nhấn trang trí, như giếng nước)
 * nhưng không nên hiện icon giọt nước của giếng.
 */
const DECOR_KIND_ICON: Readonly<Record<string, string>> = {
  well_windmill: 'bi bi-fan',
};

export const DECOR_DEFS: Record<DecorGroup, CatalogDef> = {
  fence: { name: 'Hàng rào', icon: 'bi bi-bricks', note: 'Bao quanh khu vực' },
  path: { name: 'Đường đi', icon: 'bi bi-signpost-split', note: 'Lối đi trong nông trại' },
  lamp: { name: 'Đèn', icon: 'bi bi-lightbulb', note: 'Tự sáng vào buổi đêm' },
  bench: { name: 'Ghế', icon: 'bi bi-columns-gap', note: 'Chỗ ngồi nghỉ' },
  well: { name: 'Giếng nước', icon: 'bi bi-droplet', note: 'Điểm nhấn trang trí' },
  nameplate: { name: 'Bảng tên nông trại', icon: 'bi bi-signpost-2', note: 'Hiển thị tên nông trại' },
  seasonal: { name: 'Vật phẩm mùa lễ', icon: 'bi bi-stars', note: 'Giới hạn theo dịp' },
  tree: { name: 'Cây cảnh', icon: 'bi bi-tree-fill', note: 'Cây lớn tạo bóng mát' },
  bush: { name: 'Bụi cây', icon: 'bi bi-flower3', note: 'Bụi xanh viền lối đi' },
  flowerbed: { name: 'Khóm hoa', icon: 'bi bi-flower1', note: 'Điểm màu cho nông trại' },
  crop: { name: 'Luống rau', icon: 'bi bi-grid-3x3-gap', note: 'Luống rau trang trí' },
  produce: { name: 'Trái cây trang trí', icon: 'bi bi-basket2-fill', note: 'Nông sản bày quanh nhà' },
};

/** Một mã trang trí trong manifest 3D — cửa hàng niêm yết từng mã, giá theo nhóm. */
export interface DecorCatalogEntry {
  kind: string;
  group: DecorGroup;
  label: string;
}

/** Danh mục trang trí từ manifest (giữ thứ tự nhóm của `DECOR_GROUPS`, mã gốc đứng đầu nhóm). */
export function decorCatalogFromManifest(
  decors: Readonly<Record<string, { label?: string; group?: string }>> | null | undefined,
): DecorCatalogEntry[] {
  if (!decors) return [];
  const out: DecorCatalogEntry[] = [];
  for (const [kind, entry] of Object.entries(decors)) {
    const group = decorGroupOf(kind);
    if (!group || (entry.group && entry.group !== group)) continue;
    out.push({ kind, group, label: entry.label || DECOR_DEFS[group].name });
  }
  const order = (g: DecorGroup): number => DECOR_GROUPS.indexOf(g);
  return out.sort(
    (a, b) => order(a.group) - order(b.group) || Number(a.kind !== a.group) - Number(b.kind !== b.group) || a.label.localeCompare(b.label, 'vi'),
  );
}

/** Mã ngẫu nhiên trong số vật phẩm đang mua được (không bị chặn) — `null` khi không có. */
export function pickRandomItem(items: readonly ShopItem[], rand: () => number = Math.random): ShopItem | null {
  const buyable = items.filter((i) => i.block === null);
  if (buyable.length === 0) return null;
  return buyable[Math.floor(rand() * buyable.length) % buyable.length];
}

const SEED_ORDER: readonly PlantKind[] = [...FRUIT_PLANT_KINDS, ...FLOWER_PLANT_KINDS];

export function isFarmSpecies(code: string): code is FarmSpecies {
  return (FARM_SPECIES as readonly string[]).includes(code);
}

export function isPlantKind(code: string): code is PlantKind {
  return (SEED_ORDER as readonly string[]).includes(code);
}

function finite(v: number | undefined): number | null {
  return v !== undefined && Number.isFinite(v) ? v : null;
}

/** Nhãn mốc thâm niên từ số tháng, ví dụ `24` → "2 năm". */
export function requiredMonthsLabel(months: number): string {
  const m = Math.max(0, Math.floor(months));
  return formatSeniority({ years: Math.floor(m / 12), months: m % 12 });
}

/** Định dạng số Hạt OCB theo kiểu Việt Nam (1.000). */
export function formatSeeds(n: number): string {
  return Math.round(n).toLocaleString('vi-VN');
}

/** Định dạng thời lượng tính bằng giờ, ví dụ `36` → "1 ngày 12 giờ". */
export function formatHours(hours: number): string {
  const h = Math.max(0, Math.round(hours));
  const d = Math.floor(h / 24);
  const r = h % 24;
  if (d === 0) return `${r} giờ`;
  return r === 0 ? `${d} ngày` : `${d} ngày ${r} giờ`;
}

/** Các ô trống thuộc vùng đã mở, đúng địa hình, không phải ô Cây OCB. */
export function freeCells(state: FarmStateJson | null, terrain: FarmTerrain): FarmCellRef[] {
  if (!state) return [];
  const center = centerCellOf(state.plots);
  const occupied = new Set<FarmCellRef>([
    ...state.animals.map((a) => a.cell),
    ...state.plants.map((p) => p.cell),
    ...state.decors.map((d) => d.cell),
  ]);
  const cells: FarmCellRef[] = [];
  for (const plot of state.plots) {
    if (!plot.unlocked || plot.terrain !== terrain) continue;
    for (const cell of plot.cells) {
      if (cell !== center && !occupied.has(cell)) cells.push(cell);
    }
  }
  return cells;
}

/** Số lượng hiện tại / giới hạn của nhóm — hiện tại lấy theo state mới nhất (US-37). */
export function groupCount(tab: ShopTab, ctx: Pick<ShopContext, 'state' | 'limits' | 'values'>): ShopGroupCount {
  const state = ctx.state;
  const values = ctx.values ?? {};
  switch (tab) {
    case 'animal':
      return {
        current: state?.animals.length ?? ctx.limits?.animals.current ?? 0,
        max: ctx.limits?.animals.max ?? finite(values['max_animals']),
      };
    case 'seed':
      return {
        current: state?.plants.length ?? ctx.limits?.plants.current ?? 0,
        max: ctx.limits?.plants.max ?? finite(values['max_plants']),
      };
    case 'decor':
      return {
        current: state?.decors.length ?? ctx.limits?.decors.current ?? 0,
        max: ctx.limits?.decors.max ?? finite(values['max_decors']),
      };
    case 'boost':
      // Vật phẩm dùng ngay — không chiếm chỗ, không giới hạn số lượng.
      return { current: 0, max: null };
  }
}

function blockFor(
  price: number | null,
  locked: boolean,
  count: ShopGroupCount,
  hasCell: boolean,
  balance: number,
): { block: ShopBlockReason | null; missing: number } {
  const missing = price === null ? 0 : Math.max(0, price - balance);
  if (price === null) return { block: 'no_price', missing };
  if (locked) return { block: 'seniority_locked', missing };
  if (count.max !== null && count.current >= count.max) return { block: 'limit_reached', missing };
  if (!hasCell) return { block: 'no_free_cell', missing };
  if (missing > 0) return { block: 'insufficient_seeds', missing };
  return { block: null, missing };
}

/** Dựng danh mục của một tab. Vật phẩm mùa lễ chỉ niêm yết khi có dịp đang diễn ra (US-33). */
export function buildShopItems(tab: ShopTab, ctx: ShopContext): ShopItem[] {
  const values = ctx.values ?? {};
  const count = groupCount(tab, ctx);
  const landFree = freeCells(ctx.state, 'land').length > 0;
  const waterFree = freeCells(ctx.state, 'water').length > 0;

  const make = (
    code: string,
    def: CatalogDef,
    price: number | null,
    terrain: FarmTerrain,
    extra: Partial<Pick<ShopItem, 'growHours' | 'cycleHours' | 'seasonal' | 'seasonName' | 'note'>> = {},
  ): ShopItem => {
    const required = finite(values[`seniority_unlock_${tab}_${code}`]);
    const requiredMonths = required !== null && required > 0 ? required : null;
    const locked = requiredMonths !== null && ctx.seniorityMonths < requiredMonths;
    const hasCell = terrain === 'water' ? waterFree : landFree;
    const { block, missing } = blockFor(price, locked, count, hasCell, ctx.balance);
    return {
      tab,
      code,
      name: def.name,
      icon: def.icon,
      note: extra.note ?? def.note,
      price,
      growHours: extra.growHours ?? null,
      cycleHours: extra.cycleHours ?? null,
      terrain,
      seasonal: extra.seasonal ?? false,
      seasonName: extra.seasonName ?? null,
      requiredMonths,
      requiredLabel: requiredMonths !== null ? requiredMonthsLabel(requiredMonths) : null,
      unlockedBySeniority: requiredMonths !== null && !locked,
      block,
      missing,
    };
  };

  switch (tab) {
    case 'animal':
      return FARM_SPECIES.map((s) =>
        make(s, ANIMAL_DEFS[s], finite(values[`animal_price_${s}`]), s === 'fish' ? 'water' : 'land', {
          cycleHours: s === 'horse' ? null : finite(values[`produce_cycle_${s}`]),
          note:
            s === 'horse' && finite(values['horse_bonus_per_horse']) !== null
              ? `Không cho sản phẩm · +${values['horse_bonus_per_horse']}% giá bán mỗi con`
              : ANIMAL_DEFS[s].note,
        }),
      );
    case 'seed':
      return SEED_ORDER.map((k) =>
        make(k, PLANT_DEFS[k], finite(values[`seed_price_${k}`]), 'land', {
          growHours: finite(values[`grow_total_${k}`]),
        }),
      );
    case 'boost':
      return (Object.keys(BOOST_DEFS) as BoostCode[]).map((code) => {
        const def = BOOST_DEFS[code];
        const item = make(code, def, finite(values[def.priceKey]) ?? def.defaultPrice, 'land');
        // "Hết ô trống" ở đây nghĩa là không có đối tượng dùng được.
        const hasTarget = boostTargets(code, ctx.state, ctx.values).length > 0;
        if (!hasTarget && (item.block === null || item.block === 'insufficient_seeds')) {
          return { ...item, block: 'no_free_cell' as const };
        }
        if (hasTarget && item.block === 'no_free_cell') {
          return { ...item, block: item.missing > 0 ? ('insufficient_seeds' as const) : null };
        }
        return item;
      });
    case 'decor': {
      const catalog: readonly DecorCatalogEntry[] =
        ctx.decorCatalog && ctx.decorCatalog.length > 0
          ? ctx.decorCatalog
          : DECOR_GROUPS.slice(0, 7).map((g) => ({ kind: g, group: g, label: DECOR_DEFS[g].name }));
      return catalog
        .filter((d) => d.group !== 'seasonal' || ctx.seasonTheme !== null)
        .map((d) => {
          const def = DECOR_DEFS[d.group];
          const icon = DECOR_KIND_ICON[d.kind] ?? def.icon;
          return make(d.kind, { ...def, name: d.label, icon }, finite(values[`decor_price_${d.group}`]), 'land', {
            seasonal: d.group === 'seasonal',
            seasonName: d.group === 'seasonal' ? ctx.seasonName : null,
            // Biến thể cụ thể (`d.kind !== d.group`) hiện mô tả riêng của chính nó nếu
            // khác tên hiển thị (`d.label`), KHÔNG lặp lại tên NHÓM (`def.name`) — trước
            // đây ghép `${def.name} · ${def.note}` khiến "Cối xay gió" (kind `well_windmill`,
            // group `well`) hiện nhầm "Giếng nước · Điểm nhấn trang trí".
            note: d.group === 'seasonal' ? `Chỉ bán trong dịp ${ctx.seasonName ?? 'lễ hiện tại'}` : def.note,
          });
        });
    }
  }
}

/** Thông báo tiếng Việt cho lý do chặn mua. */
export function blockMessage(item: ShopItem, count: ShopGroupCount): string | null {
  switch (item.block) {
    case null:
      return null;
    case 'no_price':
      return 'Chưa tải được bảng giá. Vui lòng tải lại nông trại.';
    case 'seniority_locked':
      return `Mở khoá khi đạt thâm niên ${item.requiredLabel ?? ''}.`;
    case 'limit_reached': {
      const group =
        item.tab === 'animal' ? 'vật nuôi' : item.tab === 'seed' ? 'cây trồng' : item.tab === 'boost' ? 'vật phẩm hỗ trợ' : 'vật phẩm trang trí';
      return `Đã đạt giới hạn ${group}: ${count.current}/${count.max ?? '?'}.`;
    }
    case 'no_free_cell':
      if (item.tab === 'boost') {
        return item.code === 'growth_potion'
          ? 'Chưa có vật nuôi nào dùng được thuốc (ngựa không cho sản phẩm; vật nuôi đầy sản phẩm cần thu hoạch trước).'
          : 'Chưa có cây nào cần phân bón siêu cấp (cây đã chín thì hãy thu hoạch).';
      }
      return item.terrain === 'water'
        ? 'Ao nước không còn ô trống. Hãy mở rộng vùng ao hoặc di chuyển bớt cá.'
        : 'Không còn ô đất trống. Hãy mở rộng vùng đất để có thêm chỗ.';
    case 'insufficient_seeds':
      return `Còn thiếu ${formatSeeds(item.missing)} Hạt OCB. Check-in hằng ngày, thu hoạch và bán sản phẩm để kiếm thêm.`;
  }
}
