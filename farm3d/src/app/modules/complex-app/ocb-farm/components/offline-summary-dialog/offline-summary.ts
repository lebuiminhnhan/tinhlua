import type {
  FarmOfflineSummary,
  FarmSpecies,
  FarmStateJson,
  PlantKind,
  StorageKey,
} from '../../models/ocb-farm.model';

/**
 * OCB Farm — hàm thuần cho bảng tổng kết offline (US-23).
 * Tách khỏi component để test không cần TestBed.
 */

export const PRODUCT_LABELS: Readonly<Record<StorageKey, string>> = {
  egg: 'Trứng',
  milk: 'Sữa',
  wool: 'Len',
  fish: 'Cá tươi',
  manure: 'Phân hữu cơ',
  fruit_banana: 'Chuối',
  fruit_orange: 'Cam',
  fruit_mango: 'Xoài',
  flower_sunflower: 'Hoa hướng dương',
  flower_daisy: 'Hoa cúc',
  flower_rose: 'Hoa hồng',
};

export const PRODUCT_ICONS: Readonly<Record<StorageKey, string>> = {
  egg: 'bi bi-egg',
  milk: 'bi bi-cup-straw',
  wool: 'bi bi-cloud',
  fish: 'bi bi-water',
  manure: 'bi bi-recycle',
  fruit_banana: 'bi bi-basket',
  fruit_orange: 'bi bi-basket',
  fruit_mango: 'bi bi-basket',
  flower_sunflower: 'bi bi-flower1',
  flower_daisy: 'bi bi-flower2',
  flower_rose: 'bi bi-flower3',
};

export const SPECIES_LABELS: Readonly<Record<FarmSpecies, string>> = {
  chicken: 'Gà',
  fish: 'Cá',
  sheep: 'Cừu',
  pig: 'Heo',
  cow: 'Bò',
  horse: 'Ngựa',
};

export const PLANT_LABELS: Readonly<Record<PlantKind, string>> = {
  banana: 'Cây chuối',
  orange: 'Cây cam',
  mango: 'Cây xoài',
  sunflower: 'Hoa hướng dương',
  daisy: 'Hoa cúc',
  rose: 'Hoa hồng',
};

export interface OfflineSummaryRow {
  key: StorageKey;
  label: string;
  icon: string;
  quantity: number;
  capped: boolean;
}

export interface CappedEntityRow {
  id: string;
  label: string;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Độ dài vắng mặt dạng "2 ngày 3 giờ", "1 giờ 5 phút", "45 phút", "dưới 1 phút". */
export function formatAwayDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < MINUTE_MS) return 'dưới 1 phút';
  const days = Math.floor(ms / DAY_MS);
  const hours = Math.floor((ms % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((ms % HOUR_MS) / MINUTE_MS);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} ngày`);
  if (hours > 0) parts.push(`${hours} giờ`);
  // Vắng nhiều ngày thì bỏ phút cho gọn.
  if (minutes > 0 && days === 0) parts.push(`${minutes} phút`);
  return parts.join(' ');
}

/** Các dòng sản phẩm có số lượng > 0, sắp theo số lượng giảm dần. */
export function offlineSummaryRows(summary: FarmOfflineSummary | null): OfflineSummaryRow[] {
  if (!summary) return [];
  return summary.items
    .filter((i) => Number.isFinite(i.quantity) && i.quantity > 0)
    .map((i) => ({
      key: i.key,
      label: PRODUCT_LABELS[i.key] ?? i.key,
      icon: PRODUCT_ICONS[i.key] ?? 'bi bi-box',
      quantity: i.quantity,
      capped: i.capped,
    }))
    .sort((a, b) => b.quantity - a.quantity);
}

/** Chỉ hiển thị bảng tổng kết khi thực sự có sản phẩm tích lũy (US-23). */
export function hasOfflineAccumulation(summary: FarmOfflineSummary | null): boolean {
  return offlineSummaryRows(summary).length > 0;
}

/** Đối tượng đã đạt trần tích lũy, gắn tên loài/cây và ô đất từ `state`. */
export function cappedEntityRows(
  summary: FarmOfflineSummary | null,
  state: FarmStateJson | null,
): CappedEntityRow[] {
  if (!summary) return [];
  const animals = new Map((state?.animals ?? []).map((a) => [a.id, a]));
  const plants = new Map((state?.plants ?? []).map((p) => [p.id, p]));
  return summary.capped_entity_ids.map((id) => {
    const animal = animals.get(id);
    if (animal) return { id, label: `${SPECIES_LABELS[animal.species]} (ô ${animal.cell})` };
    const plant = plants.get(id);
    if (plant) return { id, label: `${PLANT_LABELS[plant.kind]} (ô ${plant.cell})` };
    return { id, label: 'Đối tượng đã bị di chuyển hoặc bán' };
  });
}
