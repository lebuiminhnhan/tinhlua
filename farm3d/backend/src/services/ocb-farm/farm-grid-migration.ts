/**
 * OCB Farm — nâng cấp lưới đất từ 13×15 (cũ) lên 20×25 (US-7, US-8 — bản
 * nâng cấp Cinema).
 *
 * `migrateGridTo20x25` là hàm thuần, idempotent, dùng cho cơ chế lazy
 * migration: mỗi khi đọc một `Legacy_Grid_Farm` (nông trại tạo trước bản
 * nâng cấp này, không có `grid_version` hoặc `grid_version < 2`), hàm sẽ
 * bổ sung các vùng đất mới từ `EXPANSION_PLOTS_V2` để đạt đủ lưới 20×25 ô,
 * đồng thời đặt `grid_version: CURRENT_GRID_VERSION` lên state.
 *
 * Nguyên tắc bất biến (giống `ensurePlotLayout` trong `farm-plot-layout.ts`):
 * - KHÔNG đổi bất kỳ vùng đất đã có (giữ nguyên `id`, `unlocked`, `cells`,
 *   `terrain`) — chỉ bổ sung vùng còn thiếu.
 * - KHÔNG đổi `animals`, `plants`, `decors`, `storage`, `tree`,
 *   `badges_shown`, `counters`, hoặc bất kỳ field nào khác ngoài
 *   `plots`/`grid_version`.
 * - Không throw — mọi trường hợp dữ liệu bất thường (thiếu `plots` hợp lệ,
 *   thiếu vùng khởi đầu) đều trả nguyên `state`, giữ đúng tinh thần phòng
 *   thủ của `ensurePlotLayout`.
 *
 * _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_
 */

import type { FarmStateJson } from '../../types/ocb-farm.types';
import { EXPANSION_PLOTS_V2 } from './farm-plot-layout';

/** Phiên bản lưới hiện tại — 2 là lưới 20×25 (CELL_SIZE mới). */
export const CURRENT_GRID_VERSION = 2;

/**
 * Mở rộng `state.plots` của một Legacy_Grid_Farm (lưới 13×15 cũ, không có
 * `grid_version` hoặc `grid_version < CURRENT_GRID_VERSION`) để đạt đủ lưới
 * 20×25 ô. Trả nguyên `state` (cùng tham chiếu) khi đã ở phiên bản hiện tại
 * hoặc khi dữ liệu không hợp lệ để migrate.
 */
export function migrateGridTo20x25(state: FarmStateJson): FarmStateJson {
  // Idempotent: state đã ở phiên bản hiện tại (hoặc cao hơn) — không làm gì.
  if ((state.grid_version ?? 1) >= CURRENT_GRID_VERSION) return state;

  // Phòng thủ: dữ liệu bất thường — không throw, trả nguyên state.
  if (!state || !Array.isArray(state.plots)) return state;
  const ids = new Set(state.plots.map((plot) => plot.id));
  if (!ids.has(1)) return state;

  // Chỉ bổ sung vùng còn thiếu, không chạm ô đã bị chiếm bởi vùng hiện có.
  const used = new Set(state.plots.flatMap((plot) => plot.cells));
  const missing = EXPANSION_PLOTS_V2.filter(
    (plot) => !ids.has(plot.id) && plot.cells.every((cell) => !used.has(cell)),
  );

  const plots = [...state.plots, ...missing.map((plot) => ({ ...plot, cells: [...plot.cells] }))].sort(
    (a, b) => a.id - b.id,
  );

  return { ...state, grid_version: CURRENT_GRID_VERSION, plots };
}
