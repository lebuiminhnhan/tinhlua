/**
 * OCB Farm — các hàm thuần tính toán kinh tế: giá bán, thưởng ngựa, hoàn
 * tiền, áp dụng thay đổi số dư, và tổng tài sản phục vụ xếp hạng.
 *
 * Không đọc/ghi DB, không có side effect nào khác — `farm-command.service`
 * (task 5.x) gọi các hàm này trong transaction rồi tự ghi kết quả vào
 * `farm_states` / `farm_transactions`. Toàn bộ thông số cân bằng game đọc
 * qua tham số `config` (dạng `Record<string, number>`, khớp
 * `FarmConfigResponse.values` do `farm-config.service` — task 4.1 — cung
 * cấp) để không hardcode số trong module nghiệp vụ.
 *
 * _Requirements: US-9, US-10, US-14, US-15, US-22, US-24, US-28, US-34, BR-9, BR-10, BR-18, BR-19_
 */

import { FarmAnimal, FarmStateJson, StorageKey } from '../../types/ocb-farm.types';

/** Bảng giá bán một đơn vị của mỗi sản phẩm/vật phẩm trong kho (Hạt OCB). */
export type FarmPriceTable = Partial<Record<StorageKey, number>>;

/** Thông số cân bằng game — tra theo khóa, khớp `FarmConfigResponse.values`. */
export type FarmConfigValues = Record<string, number>;

/**
 * Kết quả discriminated dùng cho các hàm có thể thất bại (`applyBalance`) —
 * cho phép caller thu hẹp kiểu bằng `if (result.ok)` thay vì bắt exception.
 */
export type FarmEconomyResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * Giá bán gốc (chưa gồm thưởng ngựa) của `quantity` đơn vị `product`, tra
 * theo `priceTable`. Số nguyên, luôn ≥ 0. `quantity` không hợp lệ (không
 * nguyên hoặc < 0) hoặc `product` chưa có giá trong bảng → trả 0, để caller
 * (thường đã validate `quantity` bằng `INVALID_QUANTITY` trước) không phải
 * xử lý `NaN`.
 *
 * _Requirements: US-22, BR-9_
 */
export function sellPrice(
  product: StorageKey,
  quantity: number,
  priceTable: FarmPriceTable
): number {
  const unitPrice = priceTable[product];
  if (unitPrice === undefined || !Number.isInteger(quantity) || quantity < 0) {
    return 0;
  }
  return unitPrice * quantity;
}

/** `true` khi vật nuôi đang ở trạng thái bình thường (độ no > 0, chưa buồn). */
function isAnimalNormal(animal: FarmAnimal): boolean {
  return animal.fullness > 0;
}

/**
 * Phần thưởng Hạt OCB cộng thêm vào một giao dịch bán, do sở hữu ngựa
 * (US-14): mỗi con ngựa đang ở trạng thái bình thường (không buồn) cộng
 * `horse_bonus_per_horse` phần trăm, tổng tỷ lệ thưởng bị kẹp ở
 * `horse_bonus_max` phần trăm dù có nhiều ngựa hơn mức đạt trần.
 *
 * `horse_bonus_per_horse`/`horse_bonus_max` được lưu trong `farm_config`
 * dưới dạng số phần trăm nguyên (ví dụ `5` nghĩa là 5%, khớp đơn vị `'%
 * giá bán'` khai trong `20261001_010_seed_farm_config.sql`) — chia 100 ở
 * đây để ra đúng hệ số nhân, không coi `5` là 500%.
 *
 * Ngựa đang buồn (`fullness === 0`) không được tính. Không có ngựa nào ở
 * trạng thái bình thường → trả 0.
 *
 * Kết quả được làm tròn xuống (`Math.floor`) để tổng số Hạt OCB nhận được
 * luôn là số nguyên.
 *
 * _Requirements: US-14, BR-9_
 */
export function horseBonus(
  sellAmount: number,
  horses: FarmAnimal[],
  config: FarmConfigValues
): number {
  const bonusPerHorsePercent = config['horse_bonus_per_horse'] ?? 0;
  const bonusMaxPercent = config['horse_bonus_max'] ?? 0;

  const normalHorseCount = horses.filter(isAnimalNormal).length;
  if (normalHorseCount === 0 || sellAmount <= 0) {
    return 0;
  }

  const bonusRatio = Math.min(bonusPerHorsePercent * normalHorseCount, bonusMaxPercent) / 100;
  return Math.floor(sellAmount * bonusRatio);
}

/**
 * Số Hạt OCB hoàn lại khi bán một vật nuôi hoặc cây trồng đã mua với giá
 * `purchasePrice`, theo tỷ lệ hoàn tiền `resell_ratio` trong cấu hình
 * (US-15). `resell_ratio` được lưu dưới dạng số phần trăm nguyên (ví dụ
 * `50` nghĩa là 50%, khớp đơn vị `'% giá mua'` khai trong
 * `20261001_010_seed_farm_config.sql`) — chia 100 ở đây để ra đúng hệ số
 * nhân, không coi `50` là 5000%. Kết quả làm tròn xuống, luôn ≥ 0 (BR-9) —
 * `purchasePrice` âm (dữ liệu hỏng) được kẹp về 0 thay vì trả số âm.
 *
 * _Requirements: US-15, BR-9_
 */
export function refund(purchasePrice: number, config: FarmConfigValues): number {
  const resellRatioPercent = config['resell_ratio'] ?? 0;
  const safePurchasePrice = Math.max(purchasePrice, 0);
  return Math.floor(safePurchasePrice * (resellRatioPercent / 100));
}

/**
 * Áp dụng thay đổi `delta` (dương là cộng, âm là trừ) vào `currentBalance`,
 * chặn số dư âm TRƯỚC KHI xem như đã áp dụng (BR-9): nếu
 * `currentBalance + delta < 0`, trả `{ ok: false }` và KHÔNG có số dư mới
 * nào được trả về — caller không được phép commit thay đổi trong trường
 * hợp này, đảm bảo không có giao dịch nửa vời làm âm số dư.
 *
 * Đây là hàm thuần — không tự ném exception — để `farm-command.service`
 * xử lý bằng `if (result.ok)` rồi trả HTTP 422 (`INSUFFICIENT_SEEDS` hoặc
 * `ADMIN_ADJUST_NEGATIVE_BALANCE` tùy ngữ cảnh) khi thất bại.
 *
 * _Requirements: BR-9_
 */
export function applyBalance(
  currentBalance: number,
  delta: number
): FarmEconomyResult<number> {
  const nextBalance = currentBalance + delta;
  if (nextBalance < 0) {
    return { ok: false, reason: 'NEGATIVE_BALANCE' };
  }
  return { ok: true, value: nextBalance };
}

/**
 * Tổng tài sản của một nông trại, dùng cho tiêu chí `assets` của bảng xếp
 * hạng (US-28): Hạt OCB hiện có + giá bán (chưa gồm thưởng ngựa) của toàn
 * bộ sản phẩm đang trong kho + giá mua của toàn bộ vật nuôi, cây trồng và
 * vùng đất đã mở khóa đang sở hữu.
 *
 * `purchasePrices` tra giá mua theo loài vật nuôi / loại cây / id vùng đất
 * (`plot:{id}`) — khóa nào không có trong bảng thì đóng góp 0 vào tổng
 * (không chặn tính toán vì thiếu một mục giá không nên làm hỏng cả bảng
 * xếp hạng).
 *
 * _Requirements: US-28, BR-9_
 */
export function totalAssets(
  state: FarmStateJson,
  seeds: number,
  config: {
    sellPriceTable: FarmPriceTable;
    animalPurchasePrice: Partial<Record<string, number>>;
    plantPurchasePrice: Partial<Record<string, number>>;
    plotExpandPrice: Partial<Record<number, number>>;
  }
): number {
  const storageValue = Object.entries(state.storage).reduce((sum, [key, quantity]) => {
    const unitPrice = config.sellPriceTable[key as StorageKey] ?? 0;
    return sum + unitPrice * (quantity ?? 0);
  }, 0);

  const animalsValue = state.animals.reduce((sum, animal) => {
    return sum + (config.animalPurchasePrice[animal.species] ?? 0);
  }, 0);

  const plantsValue = state.plants.reduce((sum, plant) => {
    return sum + (config.plantPurchasePrice[plant.kind] ?? 0);
  }, 0);

  const unlockedPlotsValue = state.plots
    .filter((plot) => plot.unlocked)
    .reduce((sum, plot) => sum + (config.plotExpandPrice[plot.id] ?? 0), 0);

  return seeds + storageValue + animalsValue + plantsValue + unlockedPlotsValue;
}
