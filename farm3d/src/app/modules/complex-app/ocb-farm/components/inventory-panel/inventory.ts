import {
  ANIMAL_PRODUCT_KEYS,
  FLOWER_PLANT_KINDS,
  FRUIT_PLANT_KINDS,
  FarmAnimal,
  StorageKey,
} from '../../models/ocb-farm.model';
import { PRODUCT_ICONS, PRODUCT_LABELS } from '../offline-summary-dialog/offline-summary';

/**
 * OCB Farm — hàm thuần cho kho và bán sản phẩm (task 13.2, không phụ thuộc Angular).
 *
 * Công thức khớp backend `farm-economy.ts` (`sellPrice`, `horseBonus`) và
 * `economy.commands.ts` (`SELL_PRODUCT`): giá gốc = đơn giá × số lượng; thưởng ngựa =
 * `floor(giá gốc × min(horse_bonus_per_horse × số ngựa bình thường, horse_bonus_max) / 100)`.
 * Ở đây chỉ để xem trước — server chốt giá tại thời điểm xác nhận.
 *
 * _Requirements: US-13, US-14, US-20, US-22_
 */

/** Thứ tự hiển thị trong kho: sản phẩm vật nuôi → quả → hoa. */
export const INVENTORY_ORDER: readonly StorageKey[] = [
  ...ANIMAL_PRODUCT_KEYS,
  ...FRUIT_PLANT_KINDS.map((k) => `fruit_${k}` as const),
  ...FLOWER_PLANT_KINDS.map((k) => `flower_${k}` as const),
];

/** Khoá cấu hình giá bán: `fruit_banana` → `sell_price_banana`, `egg` → `sell_price_egg`. */
export function sellPriceConfigKey(product: StorageKey): string {
  const bare = product.replace(/^(fruit_|flower_)/, '');
  return `sell_price_${bare}`;
}

export function unitPriceOf(product: StorageKey, values: Record<string, number> | null): number | null {
  const v = values?.[sellPriceConfigKey(product)];
  return v !== undefined && Number.isFinite(v) && v >= 0 ? v : null;
}

export type HorseBonusReason = 'active' | 'no_horse' | 'all_sad' | 'not_configured';

export interface HorseBonusInfo {
  /** Tỷ lệ thưởng áp dụng (%), đã kẹp theo trần. */
  percent: number;
  normalHorses: number;
  sadHorses: number;
  /** Đã chạm trần `horse_bonus_max`. */
  capped: boolean;
  maxPercent: number;
  reason: HorseBonusReason;
}

/** Thưởng ngựa: chỉ ngựa đang bình thường (độ no > 0) được tính, tổng kẹp ở trần (US-14). */
export function horseBonusInfo(
  animals: readonly FarmAnimal[],
  values: Record<string, number> | null,
): HorseBonusInfo {
  const per = Math.max(0, values?.['horse_bonus_per_horse'] ?? 0);
  const max = Math.max(0, values?.['horse_bonus_max'] ?? 0);
  const horses = animals.filter((a) => a.species === 'horse');
  const normalHorses = horses.filter((h) => h.fullness > 0).length;
  const sadHorses = horses.length - normalHorses;
  const raw = per * normalHorses;
  const percent = Math.min(raw, max);
  let reason: HorseBonusReason = 'active';
  if (horses.length === 0) reason = 'no_horse';
  else if (normalHorses === 0) reason = 'all_sad';
  else if (percent <= 0) reason = 'not_configured';
  return { percent: reason === 'active' ? percent : 0, normalHorses, sadHorses, capped: normalHorses > 0 && raw >= max && max > 0, maxPercent: max, reason };
}

/** Lý do không có thưởng ngựa (US-14) — `null` khi đang có thưởng. */
export function horseBonusReasonText(info: HorseBonusInfo): string | null {
  switch (info.reason) {
    case 'active':
      return null;
    case 'no_horse':
      return 'Không có thưởng ngựa vì nông trại chưa có con ngựa nào. Mua ngựa ở cửa hàng để tăng giá bán.';
    case 'all_sad':
      return 'Không có thưởng ngựa vì tất cả ngựa đang buồn (đói). Cho ngựa ăn để nhận lại thưởng.';
    case 'not_configured':
      return 'Không có thưởng ngựa vì tỷ lệ thưởng hiện đang bằng 0 theo cấu hình.';
  }
}

export interface SellBreakdown {
  base: number;
  bonus: number;
  total: number;
}

export function sellBreakdown(unitPrice: number, quantity: number, bonusPercent: number): SellBreakdown {
  if (!Number.isInteger(quantity) || quantity < 0 || unitPrice < 0) return { base: 0, bonus: 0, total: 0 };
  const base = unitPrice * quantity;
  const bonus = base > 0 && bonusPercent > 0 ? Math.floor((base * bonusPercent) / 100) : 0;
  return { base, bonus, total: base + bonus };
}

export interface InventoryRow {
  key: StorageKey;
  label: string;
  icon: string;
  quantity: number;
  unitPrice: number | null;
  /** Ước tính nếu bán toàn bộ loại này (gồm thưởng ngựa) — `null` khi chưa có giá. */
  estimate: SellBreakdown | null;
}

/** Các loại sản phẩm đang có (> 0) theo thứ tự cố định. */
export function buildInventoryRows(
  storage: Partial<Record<StorageKey, number>> | null | undefined,
  values: Record<string, number> | null,
  bonusPercent: number,
): InventoryRow[] {
  if (!storage) return [];
  const known = new Set<string>(INVENTORY_ORDER);
  const keys = [
    ...INVENTORY_ORDER,
    ...(Object.keys(storage) as StorageKey[]).filter((k) => !known.has(k)),
  ];
  const rows: InventoryRow[] = [];
  for (const key of keys) {
    const quantity = storage[key] ?? 0;
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    const unitPrice = unitPriceOf(key, values);
    rows.push({
      key,
      label: PRODUCT_LABELS[key] ?? key,
      icon: PRODUCT_ICONS[key] ?? 'bi bi-box',
      quantity,
      unitPrice,
      estimate: unitPrice === null ? null : sellBreakdown(unitPrice, quantity, bonusPercent),
    });
  }
  return rows;
}

/** Tổng ước tính nếu bán toàn bộ kho (mỗi loại một lượt bán, như server tính). */
export function inventoryTotal(rows: readonly InventoryRow[]): SellBreakdown {
  return rows.reduce<SellBreakdown>(
    (acc, r) =>
      r.estimate
        ? { base: acc.base + r.estimate.base, bonus: acc.bonus + r.estimate.bonus, total: acc.total + r.estimate.total }
        : acc,
    { base: 0, bonus: 0, total: 0 },
  );
}

export type QuantityCheck = { ok: true; value: number } | { ok: false; message: string };

/** Số lượng bán hợp lệ: số nguyên trong [1, đang có] (US-22). */
export function validateSellQuantity(raw: string | number, max: number): QuantityCheck {
  const range = `Số lượng bán phải là số nguyên từ 1 đến ${max}.`;
  if (max < 1) return { ok: false, message: 'Kho không còn sản phẩm này.' };
  const text = String(raw).trim();
  if (!/^-?\d+$/.test(text)) return { ok: false, message: range };
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) return { ok: false, message: range };
  return { ok: true, value };
}
