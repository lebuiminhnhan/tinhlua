/**
 * OCB Farm — hàm thuần cho khung 3D: quy đổi ô ↔ toạ độ thế giới, góc camera
 * isometric, giới hạn phóng to/nhỏ. Không phụ thuộc Angular hay WebGL nên test được
 * trực tiếp.
 *
 * Quy ước toạ độ: ô `"hàng,cột"` → tâm ô tại `x = cột × CELL_SIZE`, `z = hàng × CELL_SIZE`,
 * mặt đất ở `y = 0`.
 *
 * _Requirements: US-9, US-36, US-38, BR-1_
 */
import type { FarmCellRef, FarmPlot, FarmStateJson } from '../models/ocb-farm.model';

/**
 * Cạnh một ô đất (đơn vị thế giới). Ô rộng 20 đơn vị để mô hình được chuẩn hoá theo tỉ lệ
 * ô (`scene/model-fit.ts`) và vật nuôi có chỗ đi lại trong ô của mình.
 * Mọi kích thước hình học khác (phiến đất, dấu hiệu, hạt mưa, cây OCB…) được thiết kế theo
 * "đơn vị ô" rồi nhân với hằng số này.
 */
export const CELL_SIZE = 20;

/** Góc nâng isometric chuẩn: atan(1/√2) ≈ 35.264°. */
export const ISO_ELEVATION = Math.atan(1 / Math.SQRT2);
/** Góc phương vị gốc (45°) — mỗi nút xoay cộng/trừ 90°. */
export const ISO_BASE_AZIMUTH = Math.PI / 4;

export const MIN_ZOOM = 0.5;
/**
 * Trần cứng của mức phóng. Mức thực tế còn bị chặn theo kích thước nông trại
 * (`FarmSceneService.maxZoom`, khung nhìn tối thiểu ~1.2 ô) để xem rõ từng vật nuôi.
 */
export const MAX_ZOOM = 40;

export interface CellCoord {
  row: number;
  col: number;
}

export interface GridBounds {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}

/** Hướng xoay camera theo 4 nút (mỗi lần 90°). */
export type FarmRotateDirection = 'cw' | 'ccw';

/** Chỉ số góc quay 0..3 (0°, 90°, 180°, 270° cộng vào góc gốc). */
export type QuarterTurn = 0 | 1 | 2 | 3;

const CELL_PATTERN = /^\s*(-?\d+)\s*,\s*(-?\d+)\s*$/;

/** Đọc `"hàng,cột"`; chuỗi sai định dạng → `null` (không render, không đoán). */
export function parseCell(ref: FarmCellRef): CellCoord | null {
  const match = CELL_PATTERN.exec(ref);
  if (!match) return null;
  return { row: Number(match[1]), col: Number(match[2]) };
}

export function formatCell(coord: CellCoord): FarmCellRef {
  return `${coord.row},${coord.col}`;
}

/** Tâm ô trên mặt đất. */
export function cellToWorld(coord: CellCoord): { x: number; z: number } {
  return { x: coord.col * CELL_SIZE, z: coord.row * CELL_SIZE };
}

/** Ô chứa điểm (x, z) trên mặt đất. */
export function worldToCell(x: number, z: number): CellCoord {
  return { row: Math.round(z / CELL_SIZE), col: Math.round(x / CELL_SIZE) };
}

/**
 * Ô trung tâm của Cây OCB — cùng quy ước với backend `farm-grid.centerCell`:
 * ô đầu tiên của vùng đất số 1.
 */
export function centerCellOf(plots: readonly FarmPlot[]): FarmCellRef | null {
  return plots.find((p) => p.id === 1)?.cells[0] ?? null;
}

/** Biên lưới phủ mọi ô của mọi vùng (kể cả vùng chưa mở). `null` khi không có ô hợp lệ. */
export function gridBounds(plots: readonly FarmPlot[]): GridBounds | null {
  let bounds: GridBounds | null = null;
  for (const plot of plots) {
    for (const ref of plot.cells) {
      const c = parseCell(ref);
      if (!c) continue;
      if (!bounds) {
        bounds = { minRow: c.row, maxRow: c.row, minCol: c.col, maxCol: c.col };
      } else {
        bounds.minRow = Math.min(bounds.minRow, c.row);
        bounds.maxRow = Math.max(bounds.maxRow, c.row);
        bounds.minCol = Math.min(bounds.minCol, c.col);
        bounds.maxCol = Math.max(bounds.maxCol, c.col);
      }
    }
  }
  return bounds;
}

/** Chữ ký địa hình — đổi khi mở vùng/đổi ô, dùng để quyết định có dựng lại lưới hay không. */
export function terrainSignature(plots: readonly FarmPlot[]): string {
  return plots
    .map((p) => `${p.id}:${p.terrain}:${p.unlocked ? 1 : 0}:${p.cells.join(';')}`)
    .join('|');
}

/** Chữ ký Cây OCB — đổi khi lên mốc hoặc thêm nhánh. */
export function treeSignature(state: Pick<FarmStateJson, 'tree' | 'plots'>): string {
  return `${state.tree.milestone}:${state.tree.branches}:${centerCellOf(state.plots) ?? ''}`;
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Chuyển chỉ số góc quay theo hướng nút bấm. */
export function nextQuarterTurn(current: QuarterTurn, direction: FarmRotateDirection): QuarterTurn {
  const step = direction === 'cw' ? 1 : 3;
  return ((current + step) % 4) as QuarterTurn;
}

/** Góc phương vị camera (radian) ứng với chỉ số góc quay. */
export function azimuthFor(turn: QuarterTurn): number {
  return ISO_BASE_AZIMUTH + turn * (Math.PI / 2);
}

/**
 * Nội suy góc theo đường ngắn nhất (tránh quay vòng 270° khi đi từ 3 → 0).
 * `t` trong [0, 1].
 */
export function lerpAngle(from: number, to: number, t: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * t;
}

/** Hướng camera nhìn từ target (đơn vị) theo phương vị + góc nâng isometric. */
export function cameraOffset(azimuth: number, distance: number): { x: number; y: number; z: number } {
  const horizontal = Math.cos(ISO_ELEVATION) * distance;
  return {
    x: Math.sin(azimuth) * horizontal,
    y: Math.sin(ISO_ELEVATION) * distance,
    z: Math.cos(azimuth) * horizontal,
  };
}

/**
 * Quy đổi độ dời trên màn hình (px) thành độ dời target trên mặt đất cho camera trực giao
 * isometric: kéo sang phải → cảnh dịch sang phải (target dịch sang trái).
 *
 * @param worldPerPixel số đơn vị thế giới trên mỗi pixel (đã tính zoom)
 */
export function panDelta(
  dxPx: number,
  dyPx: number,
  azimuth: number,
  worldPerPixel: number,
): { x: number; z: number } {
  // Trục "phải" màn hình trên mặt đất và trục "lên" màn hình chiếu xuống mặt đất.
  const rightX = Math.cos(azimuth);
  const rightZ = -Math.sin(azimuth);
  const forwardX = -Math.sin(azimuth);
  const forwardZ = -Math.cos(azimuth);
  // Một pixel dọc trên màn hình ứng với 1/sin(elevation) đơn vị trên mặt đất.
  const vScale = 1 / Math.sin(ISO_ELEVATION);
  const mx = -dxPx * worldPerPixel;
  const my = dyPx * worldPerPixel * vScale;
  return { x: rightX * mx + forwardX * my, z: rightZ * mx + forwardZ * my };
}
