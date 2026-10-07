/**
 * OCB Farm — Free_Roam_Pet (chó/mèo) — vật nuôi thuần hiển thị, di chuyển tự do
 * khắp toàn bộ Farm_Grid đã mở khóa, không gắn với một ô cố định (khác
 * Anchored_Animal). Hàm thuần, không phụ thuộc Angular/three.js nên test được
 * trực tiếp.
 *
 * Free_Roam_Pet KHÔNG có id server, không có sản phẩm thu hoạch, không tham gia
 * bất kỳ lệnh kinh tế nào, và không được lưu trong `state.animals` — xem
 * `FarmFreeRoamSpecies` trong `../models/ocb-farm.model.ts`.
 *
 * _Requirements: 4.1, 4.2, 4.4, 4.5_
 */
import type { FarmCellRef, FarmFreeRoamSpecies, FarmPlot } from '../models/ocb-farm.model';
import { FARM_FREE_ROAM_SPECIES } from '../models/ocb-farm.model';
import { parseCell } from './farm-scene-math';
import { stableHash } from './farm-asset-provider';

/** Một Free_Roam_Pet đã sinh — vị trí hiển thị hiện tại, không dùng cho occupancy. */
export interface FreeRoamPetSpawn {
  /** Sinh cục bộ, ví dụ `pet:dog:0` — ổn định trong phiên, không phải id server. */
  id: string;
  species: FarmFreeRoamSpecies;
  /** Vị trí hiển thị hiện tại — KHÔNG dùng cho occupancy. */
  cell: FarmCellRef;
}

/** Số lượng sinh ra cho mỗi loài — mặc định 1 chó + 1 mèo. */
export interface FreeRoamPetConfig {
  countPerSpecies: number;
}

export const DEFAULT_FREE_ROAM_PET_CONFIG: FreeRoamPetConfig = { countPerSpecies: 1 };

/** Sinh một RNG tất định (LCG 32-bit) từ một seed số nguyên. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // Numerical Recipes LCG — đủ tốt cho rải cảnh vật tất định, không cần an toàn mật mã.
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/** Mọi ô `unlocked === true && terrain === 'land'`, khác `excludeCell` (nếu có). */
function eligibleLandCells(
  plots: readonly FarmPlot[],
  excludeCell: FarmCellRef | null,
): FarmCellRef[] {
  const cells: FarmCellRef[] = [];
  for (const plot of plots) {
    if (!plot.unlocked || plot.terrain !== 'land') continue;
    for (const cell of plot.cells) {
      if (excludeCell !== null && cell === excludeCell) continue;
      cells.push(cell);
    }
  }
  return cells;
}

/** Chọn một phần tử tất định từ danh sách không rỗng theo `rand() => [0, 1)`. */
function pickOne<T>(items: readonly T[], rand: () => number): T {
  const idx = Math.min(items.length - 1, Math.floor(rand() * items.length));
  return items[idx];
}

/**
 * Spawn ban đầu của mọi Free_Roam_Pet — tất định theo seed `stableHash(\`${userId}|pet\`)`
 * để vị trí ban đầu ổn định qua các lần tải lại trong cùng phiên nông trại của một nhân
 * viên, nhưng khác nhau giữa các nhân viên khác nhau (AC 4.1).
 *
 * Chọn ô trong số các ô `unlocked === true && terrain === 'land'`, khác `centerCell`.
 * Trả về mảng rỗng khi không có ô hợp lệ nào (chưa mở vùng đất nào).
 */
export function initialFreeRoamPets(
  plots: readonly FarmPlot[],
  centerCell: FarmCellRef | null,
  userId: number,
  config: FreeRoamPetConfig = DEFAULT_FREE_ROAM_PET_CONFIG,
): FreeRoamPetSpawn[] {
  const candidates = eligibleLandCells(plots, centerCell);
  if (candidates.length === 0) return [];

  const rand = seededRandom(stableHash(`${userId}|pet`));
  const spawns: FreeRoamPetSpawn[] = [];
  for (const species of FARM_FREE_ROAM_SPECIES) {
    for (let i = 0; i < config.countPerSpecies; i++) {
      spawns.push({
        id: `pet:${species}:${i}`,
        species,
        cell: pickOne(candidates, rand),
      });
    }
  }
  return spawns;
}

/**
 * Ô đích kế tiếp cho một Free_Roam_Pet đang di chuyển — bất kỳ ô `unlocked === true &&
 * terrain === 'land'` nào trên toàn lưới, khác `centerCell` (AC 4.2, AC 4.5). Không giới
 * hạn vùng lân cận (khác Roam_Radius của Anchored_Animal).
 *
 * `occupiedCells` — ô mà một vật nuôi khác (Anchored_Animal hoặc Free_Roam_Pet khác) đang
 * đứng hoặc đang di chuyển tới tại thời điểm chọn đích; các ô này bị loại khỏi ứng viên để
 * hai con vật không bao giờ chọn cùng một ô làm đích (tránh chồng lấp hiển thị). Nếu loại
 * hết ứng viên hợp lệ do occupancy, hàm nới lại — bỏ qua `occupiedCells` — để vẫn luôn trả
 * một ô hợp lệ khi còn ô đất mở khoá (ưu tiên không đứng yên hơn là tránh va chạm tuyệt đối).
 *
 * Trả `null` khi không có ô hợp lệ nào (kể cả khi bỏ qua `occupiedCells`).
 */
export function nextFreeRoamTarget(
  plots: readonly FarmPlot[],
  centerCell: FarmCellRef | null,
  rand: () => number = Math.random,
  occupiedCells: readonly FarmCellRef[] = [],
): FarmCellRef | null {
  const candidates = eligibleLandCells(plots, centerCell);
  if (candidates.length === 0) return null;
  if (occupiedCells.length === 0) return pickOne(candidates, rand);

  const free = candidates.filter((cell) => !occupiedCells.includes(cell));
  return pickOne(free.length > 0 ? free : candidates, rand);
}

/** Xác nhận một chuỗi là `FarmCellRef` hợp lệ theo quy ước `"hàng,cột"` (tiện cho test). */
export function isParsableCell(cell: FarmCellRef): boolean {
  return parseCell(cell) !== null;
}
