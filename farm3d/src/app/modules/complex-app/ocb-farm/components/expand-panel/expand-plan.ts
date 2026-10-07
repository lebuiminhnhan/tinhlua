import type { FarmCellRef, FarmPlot, FarmStateJson, FarmTerrain } from '../../models/ocb-farm.model';
import type { FarmSnapshot } from '../../services/farm-state.store';
import { formatSeeds } from '../shop-panel/shop-catalog';

/**
 * OCB Farm — kế hoạch mở rộng vùng đất (thuần, không phụ thuộc Angular).
 *
 * Phản chiếu đúng quy tắc server (`farm-grid.ts#canExpandPlot`, `economy.commands.ts`
 * `EXPAND_PLOT`): vùng đích phải đang khoá, có ít nhất một ô liền cạnh (trên/dưới/
 * trái/phải) một ô của vùng đã mở, và giá lấy từ khoá cấu hình `expand_price_plot<id>`.
 * Server vẫn là nơi kiểm tra cuối cùng — ở đây để niêm yết giá cho mọi vùng khoá và
 * chặn sớm thao tác chắc chắn bị từ chối.
 *
 * _Requirements: US-24_
 */

export type ExpandBlockReason =
  /** Chưa có giá cấu hình cho vùng này. */
  | 'no_price'
  /** Vùng chưa kề phần nông trại đã mở. */
  | 'not_adjacent'
  /** Thiếu Hạt OCB. */
  | 'insufficient_seeds';

export interface ExpandPlotItem {
  id: number;
  label: string;
  terrain: FarmTerrain;
  cellCount: number;
  price: number | null;
  adjacent: boolean;
  block: ExpandBlockReason | null;
  /** Số Hạt OCB còn thiếu (0 khi đủ hoặc chưa có giá). */
  missing: number;
  /** Vùng nên mở trước khi vùng này chưa kề phần đã mở. */
  requiredFirstId: number | null;
}

export interface ExpandSummary {
  total: number;
  unlocked: number;
  allUnlocked: boolean;
}

/** Khoá cấu hình giá mở vùng — khớp `expand_price_plot<n>` đã seed (backend). */
export function expandPriceKey(plotId: number): string {
  return `expand_price_plot${plotId}`;
}

/** Nhãn tiếng Việt của vùng đất — khớp nhãn server dùng trong thông báo và sổ thu chi. */
export function plotLabel(plotId: number): string {
  return `Vùng đất số ${plotId}`;
}

function neighbours(cell: FarmCellRef): FarmCellRef[] {
  const m = /^(-?\d+),(-?\d+)$/.exec(cell);
  if (!m) return [];
  const r = Number(m[1]);
  const c = Number(m[2]);
  return [`${r - 1},${c}`, `${r + 1},${c}`, `${r},${c - 1}`, `${r},${c + 1}`];
}

function touches(plot: FarmPlot, cells: ReadonlySet<FarmCellRef>): boolean {
  return plot.cells.some((cell) => neighbours(cell).some((n) => cells.has(n)));
}

function cellSet(plots: readonly FarmPlot[]): Set<FarmCellRef> {
  return new Set(plots.flatMap((p) => p.cells));
}

/** Vùng `plotId` đang khoá và kề phần đã mở (giống `canExpandPlot` của server). */
export function isPlotExpandable(state: FarmStateJson | null, plotId: number): boolean {
  const target = state?.plots.find((p) => p.id === plotId);
  if (!state || !target || target.unlocked) return false;
  return touches(target, cellSet(state.plots.filter((p) => p.unlocked)));
}

/**
 * Vùng cần mở trước cho một vùng chưa kề: ưu tiên vùng khoá đã kề phần mở VÀ kề vùng
 * đích (mở xong là tới được), sau đó vùng khoá đã kề phần mở có id nhỏ nhất.
 */
export function requiredFirstPlot(state: FarmStateJson | null, plotId: number): number | null {
  const target = state?.plots.find((p) => p.id === plotId);
  if (!state || !target || target.unlocked) return null;
  const openCells = cellSet(state.plots.filter((p) => p.unlocked));
  if (touches(target, openCells)) return null;
  const reachable = state.plots
    .filter((p) => !p.unlocked && p.id !== plotId && touches(p, openCells))
    .sort((a, b) => a.id - b.id);
  const targetCells = new Set(target.cells);
  return (reachable.find((p) => touches(p, targetCells)) ?? reachable[0])?.id ?? null;
}

export function expandSummary(state: FarmStateJson | null): ExpandSummary {
  const plots = state?.plots ?? [];
  const unlocked = plots.filter((p) => p.unlocked).length;
  return { total: plots.length, unlocked, allUnlocked: plots.length > 0 && unlocked === plots.length };
}

/** Danh sách vùng đang khoá (theo id tăng dần) kèm giá và lý do chặn. */
export function buildExpandPlots(
  state: FarmStateJson | null,
  values: Record<string, number> | null,
  balance: number,
): ExpandPlotItem[] {
  if (!state) return [];
  const openCells = cellSet(state.plots.filter((p) => p.unlocked));
  return state.plots
    .filter((p) => !p.unlocked)
    .sort((a, b) => a.id - b.id)
    .map((plot) => {
      const raw = values?.[expandPriceKey(plot.id)];
      const price = raw !== undefined && Number.isFinite(raw) ? raw : null;
      const adjacent = touches(plot, openCells);
      const missing = price === null ? 0 : Math.max(0, price - balance);
      const block: ExpandBlockReason | null =
        price === null ? 'no_price' : !adjacent ? 'not_adjacent' : missing > 0 ? 'insufficient_seeds' : null;
      return {
        id: plot.id,
        label: plotLabel(plot.id),
        terrain: plot.terrain,
        cellCount: plot.cells.length,
        price,
        adjacent,
        block,
        missing,
        requiredFirstId: adjacent ? null : requiredFirstPlot(state, plot.id),
      };
    });
}

/** Thông báo tiếng Việt cho lý do chặn mở vùng. */
export function expandBlockMessage(item: ExpandPlotItem): string | null {
  switch (item.block) {
    case null:
      return null;
    case 'no_price':
      return 'Vùng đất này chưa có giá mở rộng. Vui lòng tải lại nông trại hoặc liên hệ quản trị.';
    case 'not_adjacent':
      return item.requiredFirstId !== null
        ? `${item.label} chưa kề phần nông trại đã mở. Hãy mở ${plotLabel(item.requiredFirstId)} trước.`
        : `${item.label} chưa kề phần nông trại đã mở.`;
    case 'insufficient_seeds':
      return `Còn thiếu ${formatSeeds(item.missing)} Hạt OCB để mở ${item.label}. Check-in hằng ngày, thu hoạch và bán sản phẩm để kiếm thêm.`;
  }
}

/** Cập nhật lạc quan: mở vùng và trừ đúng giá. Store tự hoàn tác khi server từ chối / lỗi lưu. */
export function unlockPlotPatch(plotId: number, price: number): (s: FarmSnapshot) => FarmSnapshot {
  return (s) => ({
    state: { ...s.state, plots: s.state.plots.map((p) => (p.id === plotId ? { ...p, unlocked: true } : p)) },
    balance: s.balance - price,
  });
}
