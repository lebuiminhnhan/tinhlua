/**
 * OCB Farm — Anchored_Animal roam quanh Anchor_Cell (6 loài hiện có: gà, cá, cừu, heo,
 * bò, ngựa). Hàm thuần, không phụ thuộc Angular/three.js nên test được trực tiếp.
 *
 * Khác `free-roam-pet.ts` (chó/mèo, di chuyển tới bất kỳ ô mở nào trên toàn lưới),
 * Anchored_Animal chỉ được phép hiển thị di chuyển quanh `Anchor_Cell` của chính nó
 * (ô đã đặt qua lệnh server) — nếu điểm đích ứng viên rơi vào ô chưa mở khoá, sai địa
 * hình so với loài (cá chỉ ô nước, các loài khác chỉ ô đất), hoặc là `Anchor_Cell` của
 * một Anchored_Animal/thực thể khác, thì vật nuôi đứng yên tại `homeCell` (Anchor_Cell
 * của chính nó) thay vì di chuyển tới đó.
 *
 * Bất biến quan trọng: hàm này KHÔNG bao giờ đổi `Anchor_Cell` dùng cho occupancy/lệnh
 * nghiệp vụ (`FarmAnimalSpawn.cell` ở `farm-animal-layer.ts` tiếp tục là Anchor_Cell
 * thuần) — chỉ tính toạ độ thế giới để hiển thị roam.
 *
 * _Requirements: 5.1, 5.2, 5.3, 5.4_
 */
import type { FarmCellRef, FarmPlot, FarmSpecies } from '../models/ocb-farm.model';
import { cellToWorld, formatCell, parseCell, worldToCell } from './farm-scene-math';

/** Địa hình hợp lệ cho một loài: cá chỉ ở ô nước, các loài khác chỉ ở ô đất (BR-18). */
function terrainFor(species: FarmSpecies): 'land' | 'water' {
  return species === 'fish' ? 'water' : 'land';
}

/** Tra cứu plot chứa một ô cụ thể — `null` khi ô không thuộc plot nào. */
function plotContaining(plots: readonly FarmPlot[], cell: FarmCellRef): FarmPlot | null {
  for (const plot of plots) {
    if (plot.cells.includes(cell)) return plot;
  }
  return null;
}

/**
 * Một ô hợp lệ để một Anchored_Animal của `species` hiển thị di chuyển tới: đã mở khoá,
 * cùng loại địa hình với loài, và không bị `occupiedByOthers` chiếm (AC 5.2, AC 5.4).
 *
 * `occupiedByOthers` nên gồm cả Anchor_Cell của các thực thể khác VÀ ô mà vật nuôi khác
 * hiện đang đứng/đang di chuyển tới (vị trí hiển thị hiện tại) — để hai con vật không bao
 * giờ cùng chọn một ô làm đích roam, kể cả khi cả hai đang lệch khỏi Anchor_Cell của mình.
 */
function isRoamableCell(
  cell: FarmCellRef,
  plots: readonly FarmPlot[],
  species: FarmSpecies,
  occupiedByOthers: readonly FarmCellRef[],
): boolean {
  const plot = plotContaining(plots, cell);
  if (!plot || !plot.unlocked || plot.terrain !== terrainFor(species)) return false;
  return !occupiedByOthers.includes(cell);
}

/**
 * Giới hạn (clamp) một điểm đích ứng viên hiển thị cho Anchored_Animal: quy đổi
 * `(candidateX, candidateZ)` sang ô gần nhất; nếu ô đó không hợp lệ (chưa mở khoá, sai
 * địa hình so với `species`, hoặc nằm trong `occupiedByOthers` — ô một thực thể khác
 * đang chiếm, kể cả Anchor_Cell hoặc vị trí roam hiện tại của nó) thì trả về toạ độ thế
 * giới của `homeCell` (đứng yên tại anchor); ngược lại trả nguyên `(candidateX,
 * candidateZ)` không đổi.
 *
 * `homeCell` chính là Anchor_Cell của vật nuôi — hàm này không đổi và không trả về
 * Anchor_Cell, chỉ trả toạ độ thế giới dùng cho hiển thị (AC 5.1, 5.2, 5.3, 5.4).
 */
export function clampRoamTarget(
  homeCell: FarmCellRef,
  candidateX: number,
  candidateZ: number,
  plots: readonly FarmPlot[],
  species: FarmSpecies,
  occupiedByOthers: readonly FarmCellRef[],
): { x: number; z: number } {
  const candidateCoord = worldToCell(candidateX, candidateZ);
  const candidateCell = formatCell(candidateCoord);

  if (isRoamableCell(candidateCell, plots, species, occupiedByOthers)) {
    return { x: candidateX, z: candidateZ };
  }

  const homeCoord = parseCell(homeCell);
  if (!homeCoord) return { x: candidateX, z: candidateZ };
  return cellToWorld(homeCoord);
}
