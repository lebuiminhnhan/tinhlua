/**
 * OCB Farm — nhóm lệnh kho, bán và mở rộng đất: `SELL_PRODUCT`, `EXPAND_PLOT`.
 *
 * Mọi handler ở đây THUẦN theo đúng chữ ký `FarmCommandHandler<C>` (xem
 * `types.ts`): không đọc/ghi DB, không gọi `tick()` (state truyền vào đã
 * được `farm-command.service.ts` tick tới `ctx.now` trước khi dispatch) —
 * chỉ nhận `state` đã tick + `payload` + `ctx` rồi trả `success()`/`fail()`.
 *
 * `SELL_PRODUCT` chốt giá bằng `sellPrice()`/`horseBonus()` của
 * `farm-economy.ts` dùng `ctx.config` tại thời điểm xác nhận (US-22, AC "giá
 * bán được chốt theo giá tại thời điểm xác nhận") — không có đường nào cho
 * client tự gửi giá. `EXPAND_PLOT` dùng `canExpandPlot()` của `farm-grid.ts`
 * để kiểm tra kề vùng đã mở (US-24) — không tự suy luận adjacency ở đây.
 *
 * _Requirements: US-21, US-22, US-24, US-28, BR-9, BR-10_
 */

import { canExpandPlot } from '../farm-grid';
import { horseBonus, sellPrice, FarmPriceTable } from '../farm-economy';
import { FarmAnimal, FarmPlot, FarmStateJson, StorageKey } from '../../../types/ocb-farm.types';
import { FarmCommandHandler, fail, success } from './types';

// ============================================================================
// Tiện ích dùng chung
// ============================================================================

/**
 * Khóa cấu hình giá bán của `product` — `StorageKey` dạng `fruit_<kind>` /
 * `flower_<kind>` bỏ tiền tố để khớp đúng khóa `sell_price_<kind>` đã seed
 * trong `20261001_013_seed_farm_config_sell_price.sql` (ví dụ
 * `fruit_banana` → `sell_price_banana`); sản phẩm vật nuôi (`egg`, `milk`,
 * ...) giữ nguyên tên vì không có tiền tố.
 */
function sellPriceConfigKey(product: StorageKey): string {
  const bareName = product.startsWith('fruit_')
    ? product.slice('fruit_'.length)
    : product.startsWith('flower_')
      ? product.slice('flower_'.length)
      : product;
  return `sell_price_${bareName}`;
}

/** Dựng `FarmPriceTable` chỉ cho đúng một `product` — `sellPrice()` chỉ cần tra một khóa mỗi lần gọi. */
function singleProductPriceTable(product: StorageKey, config: Record<string, number>): FarmPriceTable {
  const unitPrice = config[sellPriceConfigKey(product)];
  return unitPrice === undefined ? {} : { [product]: unitPrice };
}

/** Tên hiển thị tiếng Việt của vùng đất — dùng cho `note` của dòng sổ `expand_plot`. */
function plotLabel(plotId: number): string {
  return `vùng đất số ${plotId}`;
}

/** Khóa cấu hình giá mở rộng của `plotId` — khớp `expand_price_plot<n>` đã seed. */
function expandPriceConfigKey(plotId: number): string {
  return `expand_price_plot${plotId}`;
}

// ============================================================================
// SELL_PRODUCT (US-21, US-22, US-28, BR-9)
// ============================================================================

const sellProduct: FarmCommandHandler<'SELL_PRODUCT'> = (state, payload, ctx) => {
  const { product, quantity, expected_quantity } = payload;

  if (!Number.isInteger(quantity) || quantity < 1) {
    return fail('INVALID_QUANTITY', 'Số lượng bán phải là số nguyên lớn hơn hoặc bằng 1.', {
      quantity,
    });
  }

  const currentQuantity = state.storage[product] ?? 0;

  if (currentQuantity <= 0) {
    return fail('PRODUCT_NOT_IN_STORAGE', 'Kho không có sản phẩm này.', { product });
  }

  // Số lượng client thấy lúc mở kho lệch với số lượng hiện tại — đã bán ở
  // thiết bị khác hoặc đã thay đổi theo cách khác (US-22, AC "từ chối lượt
  // bán đó, làm mới số lượng hiển thị"). Kiểm tra TRƯỚC khoảng [1, hiện có]
  // để thông báo đúng lý do thực sự (dữ liệu đã đổi) thay vì lẫn với lỗi
  // "vượt số lượng cho phép".
  if (
    typeof expected_quantity === 'number' &&
    Number.isInteger(expected_quantity) &&
    expected_quantity !== currentQuantity
  ) {
    return fail(
      'QUANTITY_CHANGED',
      'Số lượng trong kho đã thay đổi (có thể đã bán ở thiết bị khác), vui lòng tải lại kho.',
      { expected_quantity, current_quantity: currentQuantity },
    );
  }

  if (quantity > currentQuantity) {
    return fail(
      'INVALID_QUANTITY',
      `Số lượng bán phải trong khoảng từ 1 đến ${currentQuantity} (số lượng đang có).`,
      { quantity, current_quantity: currentQuantity },
    );
  }

  const priceTable = singleProductPriceTable(product, ctx.config);
  const baseAmount = sellPrice(product, quantity, priceTable);

  const horses: FarmAnimal[] = state.animals.filter((animal) => animal.species === 'horse');
  const bonusAmount = horseBonus(baseAmount, horses, ctx.config);
  const totalAmount = baseAmount + bonusAmount;

  const storage = { ...state.storage, [product]: currentQuantity - quantity };

  return success(
    { ...state, storage },
    {
      seedsDelta: totalAmount,
      // Đúng MỘT bản ghi sổ cho tổng số Hạt OCB nhận được (US-22, AC "mỗi
      // lượt bán thành công tạo đúng một bản ghi") — phần tách giá gốc/thưởng
      // ngựa để hiển thị UI nằm trong `notices[0].data` (US-14), không tách
      // thành hai dòng sổ.
      ledgerLines: [
        {
          kind: 'sell_product',
          amount: totalAmount,
          refType: 'product',
          refId: product,
          note: `Bán ${quantity} ${product}`,
        },
      ],
      notices: [
        {
          code: 'SELL_PRODUCT_BREAKDOWN',
          level: 'success',
          message:
            bonusAmount > 0
              ? `Bán thành công: ${baseAmount} Hạt OCB (giá gốc) + ${bonusAmount} Hạt OCB (thưởng ngựa) = ${totalAmount} Hạt OCB.`
              : `Bán thành công: ${totalAmount} Hạt OCB.`,
          data: { product, quantity, base_amount: baseAmount, horse_bonus_amount: bonusAmount, total_amount: totalAmount },
        },
      ],
    },
  );
};

// ============================================================================
// EXPAND_PLOT (US-24, BR-10)
// ============================================================================

const expandPlot: FarmCommandHandler<'EXPAND_PLOT'> = (state, payload, ctx) => {
  const { plot_id } = payload;

  const placement = canExpandPlot(state, plot_id);
  if (!placement.ok) {
    return fail(placement.reason, expandPlotMessage(placement.reason, state, plot_id));
  }

  const price = ctx.config[expandPriceConfigKey(plot_id)];
  if (price === undefined) {
    return fail('INVALID_CELL', 'Vùng đất này chưa có giá mở rộng được cấu hình.', { plot_id });
  }

  if (ctx.seeds < price) {
    return fail(
      'INSUFFICIENT_SEEDS',
      `Không đủ Hạt OCB để mở rộng vùng đất này. Còn thiếu ${price - ctx.seeds} Hạt OCB.`,
      { required: price, current_balance: ctx.seeds, missing: price - ctx.seeds },
    );
  }

  const plots: FarmPlot[] = state.plots.map((plot) =>
    plot.id === plot_id ? { ...plot, unlocked: true } : plot,
  );

  return success(
    { ...state, plots },
    {
      seedsDelta: -price,
      ledgerLines: [
        {
          kind: 'expand_plot',
          amount: -price,
          refType: 'plot',
          refId: String(plot_id),
          note: `Mở rộng ${plotLabel(plot_id)}`,
        },
      ],
    },
  );
};

function expandPlotMessage(reason: string, state: FarmStateJson, plotId: number): string {
  switch (reason) {
    case 'PLOT_ALREADY_UNLOCKED':
      return 'Vùng đất này đã được mở, không bị trừ tiền lần hai.';
    case 'PLOT_NOT_ADJACENT': {
      const adjacentLockedId = findAdjacentLockedPlotHint(state, plotId);
      return adjacentLockedId !== null
        ? `Vùng đất này chưa kề vùng đã mở, hãy mở ${plotLabel(adjacentLockedId)} trước.`
        : 'Vùng đất này chưa kề với phần nông trại đã mở.';
    }
    case 'INVALID_CELL':
      return 'Không tìm thấy vùng đất này.';
    default:
      return 'Không thể mở rộng vùng đất này.';
  }
}

/**
 * Gợi ý vùng đất cần mở trước — vùng khóa có id nhỏ nhất, vì bảng giá
 * `expand_price_plot<n>` tăng dần theo đúng thứ tự mở (US-24, AC "nêu rõ
 * vùng cần mở trước"). Trả `null` khi không còn vùng khóa nào khác (không
 * nên xảy ra cùng với `PLOT_NOT_ADJACENT`, nhưng giữ an toàn kiểu).
 */
function findAdjacentLockedPlotHint(state: FarmStateJson, excludePlotId: number): number | null {
  const lockedPlots = state.plots.filter((plot) => !plot.unlocked && plot.id !== excludePlotId);
  if (lockedPlots.length === 0) return null;
  return Math.min(...lockedPlots.map((plot) => plot.id));
}

// ============================================================================
// Đăng ký — export để `command-registry.ts` spread vào `COMMAND_REGISTRY`
// ============================================================================

export const ECONOMY_COMMAND_HANDLERS = {
  SELL_PRODUCT: sellProduct,
  EXPAND_PLOT: expandPlot,
};
