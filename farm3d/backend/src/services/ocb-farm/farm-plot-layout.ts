/**
 * OCB Farm — bố cục các vùng đất mở rộng (US-24, BR-10).
 *
 * Nông trại khởi điểm chỉ có vùng 1 (khối 5×5 ô từ `"0,0"` tới `"4,4"`, xem
 * `farm-init.service.ts`). Để có vùng đất "đang khoá kèm giá" cho khu mở rộng,
 * state phải liệt kê sẵn các vùng ở trạng thái `unlocked: false` — khớp các
 * khoá giá `expand_price_plot<n>` đã seed.
 *
 * Bố cục (hàng, cột):
 * - Vùng 2: dải phía đông   — hàng 0..4,  cột 5..6     (kề vùng 1)
 * - Vùng 3: dải phía nam    — hàng 5..6,  cột 0..6     (kề vùng 1, 2)
 * - Vùng 4: dải phía tây    — hàng 0..6,  cột -2..-1   (kề vùng 1, 3)
 * - Vùng 5: dải phía bắc    — hàng -2..-1, cột -2..6   (kề vùng 1, 2, 4)
 * - Vùng 6: dải đông ngoài  — hàng -2..6, cột 7..8     (kề vùng 2, 3, 5)
 * - Vùng 7: AO KHỞI ĐẦU 2×2 (4 ô nước), MẶC ĐỊNH ĐÃ MỞ — để thả cá ngay từ đầu.
 *           Đặt ở dải phía nam (hàng 5..6), cắt ra từ vùng 3 (xem {@link ensureStarterPond}).
 * - Vùng 8: ao mở rộng      — hàng 7..8,  cột 0..3     (nước, kề ao khởi đầu / vùng 3)
 * - Vùng 9: dải nam ngoài   — hàng 7..8,  cột 4..8
 * - Vùng 10: dải đông xa    — hàng -2..8, cột 9..10
 * - Vùng 11: góc tây nam    — hàng 7..8,  cột -4..-1
 * - Vùng 12: dải tây xa     — hàng -2..6, cột -4..-3
 * - Vùng 13: dải bắc xa     — hàng -4..-3, cột -4..10
 * - Vùng 14: ao lớn phía nam — hàng 9..10, cột 0..3    (nước, kề vùng 8)
 *
 * `ensurePlotLayout` là hàm thuần, idempotent: chỉ bổ sung vùng còn thiếu theo
 * `id`, không bao giờ đổi trạng thái mở khoá hay địa hình của vùng đã có. Ngoại
 * lệ duy nhất là cắt 4 ô TRỐNG (không có vật thể) ra làm ao khởi đầu.
 *
 * _Requirements: US-24, BR-10, BR-18_
 */

import type { FarmCellRef, FarmPlot, FarmStateJson } from '../../types/ocb-farm.types';

function block(rowFrom: number, rowTo: number, colFrom: number, colTo: number): string[] {
  const cells: string[] = [];
  for (let row = rowFrom; row <= rowTo; row++) {
    for (let col = colFrom; col <= colTo; col++) {
      cells.push(`${row},${col}`);
    }
  }
  return cells;
}

/** Id vùng ao khởi đầu — miễn phí, đã mở sẵn. */
export const STARTER_POND_ID = 7;
/** Số ô nước tối thiểu của mọi nông trại. */
export const STARTER_POND_CELLS = 4;

/** Các vùng mở rộng mặc định (đều đang khoá). Vùng 7 (ao khởi đầu) xử lý riêng. */
export const EXPANSION_PLOTS: readonly FarmPlot[] = [
  { id: 2, unlocked: false, terrain: 'land', cells: block(0, 4, 5, 6) },
  { id: 3, unlocked: false, terrain: 'land', cells: block(5, 6, 0, 6) },
  { id: 4, unlocked: false, terrain: 'land', cells: block(0, 6, -2, -1) },
  { id: 5, unlocked: false, terrain: 'land', cells: block(-2, -1, -2, 6) },
  { id: 6, unlocked: false, terrain: 'land', cells: block(-2, 6, 7, 8) },
  { id: 8, unlocked: false, terrain: 'water', cells: block(7, 8, 0, 3) },
  { id: 9, unlocked: false, terrain: 'land', cells: block(7, 8, 4, 8) },
  { id: 10, unlocked: false, terrain: 'land', cells: block(-2, 8, 9, 10) },
  { id: 11, unlocked: false, terrain: 'land', cells: block(7, 8, -4, -1) },
  { id: 12, unlocked: false, terrain: 'land', cells: block(-2, 6, -4, -3) },
  { id: 13, unlocked: false, terrain: 'land', cells: block(-4, -3, -4, 10) },
  { id: 14, unlocked: false, terrain: 'water', cells: block(9, 10, 0, 3) },
];

/**
 * Bố cục các vùng đất mở rộng cho lưới 20×25 ô (US-7, US-8 — bản nâng cấp
 * Cinema). Dùng bởi nông trại mới (`grid_version: 2` ngay khi khởi tạo) và
 * bởi `migrateGridTo20x25` để mở rộng `Legacy_Grid_Farm` (lưới 13×15 cũ).
 *
 * Khung tổng (khớp đúng 20 hàng × 25 cột = 500 ô):
 * - Hàng: từ -7 đến 12 (20 hàng)
 * - Cột: từ -9 đến 15 (25 cột)
 *
 * Vùng 1 (khởi đầu, định nghĩa ở `farm-init.service.ts`, KHÔNG lặp lại ở
 * đây) là khối 5×5 `"0,0"`..`"4,4"`, giữ nguyên vị trí tương đối: góc
 * trên-trái của khung tổng, đúng như vùng 1 cũng là góc trên-trái của bố
 * cục 13×15 cũ (`centerCell = "2,2"` không đổi).
 *
 * Các vùng mở rộng (id 2..18) được thiết kế theo đúng phong cách dải đồng
 * tâm của {@link EXPANSION_PLOTS} (đông/nam/tây/bắc rồi mở rộng ra ngoài),
 * chỉ scale kích thước dải lớn hơn để phủ đúng 500 ô:
 * - Vùng 2: dải phía đông    — hàng 0..4,   cột 5..6     (kề vùng 1)
 * - Vùng 3: dải phía nam     — hàng 5..6,   cột 0..6     (kề vùng 1, 2)
 * - Vùng 4: dải phía tây     — hàng 0..6,   cột -2..-1   (kề vùng 1, 3)
 * - Vùng 5: dải phía bắc     — hàng -2..-1, cột -2..6    (kề vùng 1, 2, 4)
 * - Vùng 6: dải đông ngoài   — hàng -2..6,  cột 7..8     (kề vùng 2, 3, 5)
 * - Vùng 8: ao mở rộng       — hàng 7..8,   cột 0..3     (nước, kề vùng 3)
 * - Vùng 9: dải nam ngoài    — hàng 7..8,   cột 4..8     (kề vùng 6, 8)
 * - Vùng 10: dải đông xa     — hàng -2..8,  cột 9..10    (kề vùng 6, 9)
 * - Vùng 11: góc tây nam     — hàng 7..8,   cột -4..-1   (kề vùng 4, 8)
 * - Vùng 12: dải tây xa      — hàng -2..6,  cột -4..-3   (kề vùng 4, 11)
 * - Vùng 13: dải bắc xa      — hàng -4..-3, cột -4..10   (kề vùng 5, 10, 12)
 * - Vùng 14: ao lớn phía nam — hàng 9..10,  cột 0..3     (nước, kề vùng 8)
 * - Vùng 15: dải nam xa      — hàng 9..10 (cột -4..-1 và 4..10, quanh ao
 *            vùng 14) + hàng 11..12 (toàn bộ cột -4..10) — kề vùng 9, 11,
 *            14, phủ hết phần phía nam còn lại trước khi ra khung ngoài.
 * - Vùng 16: dải bắc xa hơn  — hàng -7..-5, cột -4..10   (kề vùng 13)
 * - Vùng 17: dải đông xa hơn — hàng -7..12, cột 11..15   (kề vùng 10, 13,
 *            15, 16 — trải hết chiều cao khung tổng ở biên đông)
 * - Vùng 18: dải tây xa hơn  — hàng -7..12, cột -9..-5   (kề vùng 12, 13,
 *            15, 16 — trải hết chiều cao khung tổng ở biên tây)
 *
 * Có 2 vùng nước (id 8, 14) tương tự bố cục 13×15 cũ (scale từ vùng 8/14
 * gốc), các vùng còn lại là `land`. Tất cả đều `unlocked: false` (nhân viên
 * phải mở dần qua `EXPAND_PLOT`, trừ ao khởi đầu `STARTER_POND_ID` xử lý
 * riêng như cũ).
 *
 * Tổng số ô: vùng 1 (25) + các vùng id 2..18 ở đây (475) = 500 ô, mỗi ô
 * thuộc đúng 1 vùng (đã tự xác nhận bằng script tạm — xem task 1.1; unit
 * test chính thức ở task 1.2).
 */
export const EXPANSION_PLOTS_V2: readonly FarmPlot[] = [
  { id: 2, unlocked: false, terrain: 'land', cells: block(0, 4, 5, 6) },
  { id: 3, unlocked: false, terrain: 'land', cells: block(5, 6, 0, 6) },
  { id: 4, unlocked: false, terrain: 'land', cells: block(0, 6, -2, -1) },
  { id: 5, unlocked: false, terrain: 'land', cells: block(-2, -1, -2, 6) },
  { id: 6, unlocked: false, terrain: 'land', cells: block(-2, 6, 7, 8) },
  { id: 8, unlocked: false, terrain: 'water', cells: block(7, 8, 0, 3) },
  { id: 9, unlocked: false, terrain: 'land', cells: block(7, 8, 4, 8) },
  { id: 10, unlocked: false, terrain: 'land', cells: block(-2, 8, 9, 10) },
  { id: 11, unlocked: false, terrain: 'land', cells: block(7, 8, -4, -1) },
  { id: 12, unlocked: false, terrain: 'land', cells: block(-2, 6, -4, -3) },
  { id: 13, unlocked: false, terrain: 'land', cells: block(-4, -3, -4, 10) },
  { id: 14, unlocked: false, terrain: 'water', cells: block(9, 10, 0, 3) },
  {
    id: 15,
    unlocked: false,
    terrain: 'land',
    cells: [...block(9, 10, -4, -1), ...block(9, 10, 4, 10), ...block(11, 12, -4, 10)],
  },
  { id: 16, unlocked: false, terrain: 'land', cells: block(-7, -5, -4, 10) },
  { id: 17, unlocked: false, terrain: 'land', cells: block(-7, 12, 11, 15) },
  { id: 18, unlocked: false, terrain: 'land', cells: block(-7, 12, -9, -5) },
];

/** Vị trí ao khởi đầu theo thứ tự ưu tiên (khối 2×2 ngay phía nam vùng khởi đầu). */
const STARTER_POND_CANDIDATES: readonly string[][] = [
  block(5, 6, 0, 1),
  block(5, 6, 2, 3),
  block(5, 6, 4, 5),
  block(5, 6, 1, 2),
  block(5, 6, 3, 4),
  block(5, 6, 5, 6),
];
/** Dự phòng khi mọi khối phía nam đều đã có vật thể — ngoài toàn bộ bố cục. */
const STARTER_POND_FALLBACK = block(11, 12, 0, 1);

function occupiedCells(state: FarmStateJson): Set<FarmCellRef> {
  return new Set<FarmCellRef>([
    ...(state.animals ?? []).map((a) => a.cell),
    ...(state.plants ?? []).map((p) => p.cell),
    ...(state.decors ?? []).map((d) => d.cell),
  ]);
}

/**
 * Bảo đảm có ao khởi đầu 2×2 đã mở (vùng 7). Chọn khối ứng viên đầu tiên mà:
 * - không chạm vùng khởi đầu (vùng 1) và không chạm ô nước khác,
 * - không có vật thể nào đang đứng trên đó.
 * Các ô được cắt khỏi vùng đang sở hữu (thường là vùng 3 đang khoá — chưa thể có vật
 * thể; nếu vùng 3 đã mở thì chỉ lấy ô trống). Không có khối hợp lệ → đặt ở vị trí dự phòng.
 */
export function ensureStarterPond(state: FarmStateJson): FarmStateJson {
  if (state.plots.some((p) => p.id === STARTER_POND_ID)) return state;
  const occupied = occupiedCells(state);
  const owner = new Map<FarmCellRef, FarmPlot>();
  for (const plot of state.plots) for (const cell of plot.cells) owner.set(cell, plot);

  const usable = (cells: readonly string[]): boolean =>
    cells.every((cell) => {
      const p = owner.get(cell);
      return !occupied.has(cell) && (!p || (p.id !== 1 && p.terrain === 'land'));
    });

  const chosen =
    STARTER_POND_CANDIDATES.find(usable) ??
    (STARTER_POND_FALLBACK.every((c) => !owner.has(c)) ? STARTER_POND_FALLBACK : null);
  if (!chosen) return state;

  const taken = new Set(chosen);
  const plots = state.plots
    .map((plot) => (plot.cells.some((c) => taken.has(c)) ? { ...plot, cells: plot.cells.filter((c) => !taken.has(c)) } : plot))
    // Vùng bị cắt hết ô (không xảy ra với bố cục chuẩn) thì bỏ, tránh vùng rỗng.
    .filter((plot) => plot.cells.length > 0);
  plots.push({ id: STARTER_POND_ID, unlocked: true, terrain: 'water', cells: [...chosen] });
  return { ...state, plots };
}

/**
 * Bổ sung các vùng mở rộng còn thiếu — trả lại chính `state` khi không thiếu
 * vùng nào.
 *
 * `expansionPlots` mặc định là {@link EXPANSION_PLOTS} (bố cục 13×15 cũ) để
 * mọi lời gọi hiện có (migration lazy cho `Legacy_Grid_Farm` trong
 * `farm-state.repository.ts`) không đổi hành vi. Khởi tạo nông trại mới
 * (`farm-init.service.ts`, US-7, US-8 — bản nâng cấp Cinema) truyền
 * {@link EXPANSION_PLOTS_V2} để dựng thẳng lưới 20×25 ngay từ đầu, không cần
 * qua bước `migrateGridTo20x25` (nông trại mới không có gì để migrate).
 */
export function ensurePlotLayout(
  state: FarmStateJson,
  expansionPlots: readonly FarmPlot[] = EXPANSION_PLOTS,
): FarmStateJson {
  if (!state || !Array.isArray(state.plots)) return state;
  const ids = new Set(state.plots.map((plot) => plot.id));
  // Chỉ bổ sung cho nông trại có vùng khởi đầu chuẩn (vùng 1).
  if (!ids.has(1)) return state;

  let next = state;
  const used = new Set(next.plots.flatMap((plot) => plot.cells));
  const missing = expansionPlots.filter(
    (plot) => !ids.has(plot.id) && plot.cells.every((cell) => !used.has(cell)),
  );
  if (missing.length > 0) {
    next = {
      ...next,
      plots: [...next.plots, ...missing.map((plot) => ({ ...plot, cells: [...plot.cells] }))],
    };
  }
  next = ensureStarterPond(next);
  if (next === state) return state;
  return { ...next, plots: [...next.plots].sort((a, b) => a.id - b.id) };
}
