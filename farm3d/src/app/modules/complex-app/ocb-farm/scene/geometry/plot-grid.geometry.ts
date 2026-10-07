/**
 * Lưới ô đất và mặt nước ao, sinh theo kích thước ô và danh sách vùng đất (US-24, BR-18).
 *
 * - Ô đất (`land`): một `InstancedMesh` phiến dẹt cho mọi ô → 1 draw call; màu theo từng
 *   ô: vùng đã mở xen kẽ hai sắc xanh (dễ nhìn lưới), vùng chưa mở màu đất nâu và thấp hơn
 *   một chút, ô trung tâm (Cây OCB) màu riêng.
 * - Ô nước (`water`): đáy ao + mặt nước trong suốt, đặt ĐÚNG trên các ô địa hình `water`.
 *   Ô xuất hiện ở cả vùng đất và vùng nước thì thuộc về ao (cá chỉ vào ao — BR-18), nên
 *   không bao giờ có phiến đất dưới mặt nước.
 * - `userData.cells[instanceId]` lưu mã ô để chọn ô bằng raycast.
 *
 * Kích thước ô lấy từ `CELL_SIZE` (cùng quy ước với `cellToWorld`) để lưới khớp vị trí
 * vật thể. Hàm thuần, không phụ thuộc Angular. Giải phóng bằng `disposeObject3D`.
 *
 * _Requirements: US-9, US-24, BR-18_
 */
import {
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
} from 'three';
import type { FarmCellRef, FarmPlot, FarmTerrain } from '../../models/ocb-farm.model';
import { CELL_SIZE, cellToWorld, parseCell } from '../farm-scene-math';
import { FARM_PALETTE } from '../farm-palette';

export interface TerrainCellInfo {
  cell: FarmCellRef;
  plotId: number;
  terrain: FarmTerrain;
  unlocked: boolean;
}

export interface PlotGridOptions {
  landColor?: string;
  landAltColor?: string;
  lockedColor?: string;
  waterColor?: string;
  /** Mã ô trung tâm (Cây OCB) — tô màu riêng để phân biệt. */
  centerCell?: FarmCellRef | null;
  centerColor?: string;
}

/** Tên object để service tìm lại mesh dùng cho raycast. */
export const TERRAIN_GROUP_NAME = 'farm-terrain';
export const TERRAIN_LAND_NAME = 'farm-terrain-land';
export const TERRAIN_WATER_NAME = 'farm-terrain-water';
export const TERRAIN_POND_NAME = 'farm-pond';
export const TERRAIN_POND_BED_NAME = 'farm-pond-bed';

// Kích thước theo "đơn vị ô" × CELL_SIZE.
export const TILE_HEIGHT = 0.12 * CELL_SIZE;
const TILE_GAP = 0.04 * CELL_SIZE;
/** Ô chưa mở thấp hơn mặt đất đã mở để nhìn ra ranh giới vùng. */
export const LOCKED_TILE_DROP = 0.03 * CELL_SIZE;
export const WATER_SURFACE_Y = -0.03 * CELL_SIZE;
/** Độ trong suốt mặt nước. */
export const WATER_OPACITY = 0.7;

export const TERRAIN_SOIL_NAME = 'farm-terrain-soil';
/** Lớp cỏ trên cùng chiếm phần này của chiều cao phiến; phần dưới là đất nâu (lộ ở cạnh). */
const GRASS_LAYER = 0.35;

export const PLOT_GRID_DEFAULT_COLORS = {
  land: FARM_PALETTE.grass,
  landAlt: FARM_PALETTE.grassAlt,
  locked: FARM_PALETTE.lockedGrass,
  center: FARM_PALETTE.centerGrass,
  water: FARM_PALETTE.water,
  pondBed: FARM_PALETTE.pondBed,
  waterLockedTint: '#9FB8C4',
  soil: FARM_PALETTE.soil,
  soilLocked: FARM_PALETTE.soilDark,
} as const;

/**
 * Tách ô theo địa hình, khử trùng lặp và bỏ mã ô sai định dạng. Ô nằm trong vùng `water`
 * không bao giờ nằm trong danh sách `land`.
 */
export function collectTerrainCells(plots: readonly FarmPlot[]): {
  land: TerrainCellInfo[];
  water: TerrainCellInfo[];
} {
  const water: TerrainCellInfo[] = [];
  const waterSet = new Set<FarmCellRef>();
  for (const plot of plots) {
    if (plot.terrain !== 'water') continue;
    for (const cell of plot.cells) {
      if (waterSet.has(cell) || !parseCell(cell)) continue;
      waterSet.add(cell);
      water.push({ cell, plotId: plot.id, terrain: 'water', unlocked: plot.unlocked });
    }
  }
  const land: TerrainCellInfo[] = [];
  const landSet = new Set<FarmCellRef>();
  for (const plot of plots) {
    if (plot.terrain !== 'land') continue;
    for (const cell of plot.cells) {
      if (landSet.has(cell) || waterSet.has(cell) || !parseCell(cell)) continue;
      landSet.add(cell);
      land.push({ cell, plotId: plot.id, terrain: 'land', unlocked: plot.unlocked });
    }
  }
  return { land, water };
}

/** Dựng lưới ô đất + ao. Mặt trên phiến đất đã mở ở `y = 0`. */
export function buildPlotGrid(plots: readonly FarmPlot[], options: PlotGridOptions = {}): Group {
  const group = new Group();
  group.name = TERRAIN_GROUP_NAME;
  const { land, water } = collectTerrainCells(plots);

  if (land.length > 0) group.add(buildLandTiles(land, options), buildSoilBase(land));
  if (water.length > 0) group.add(buildPondWater(water, options.waterColor));
  return group;
}

function buildLandTiles(land: readonly TerrainCellInfo[], options: PlotGridOptions): InstancedMesh {
  const dummy = new Object3D();
  const size = CELL_SIZE - TILE_GAP;
  // Chỉ lớp cỏ trên cùng; phần đất bên dưới là `buildSoilBase`.
  const grassHeight = TILE_HEIGHT * GRASS_LAYER;
  const geometry = new BoxGeometry(size, grassHeight, size);
  geometry.translate(0, -grassHeight / 2, 0);
  // Màu thật nằm ở instanceColor; material trắng để không nhuộm thêm.
  const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  const mesh = new InstancedMesh(geometry, material, land.length);
  mesh.name = TERRAIN_LAND_NAME;
  mesh.receiveShadow = true;

  const c = PLOT_GRID_DEFAULT_COLORS;
  const base = new Color(options.landColor ?? c.land);
  const alt = new Color(options.landAltColor ?? c.landAlt);
  const locked = new Color(options.lockedColor ?? c.locked);
  const center = new Color(options.centerColor ?? c.center);

  land.forEach((info, i) => {
    const coord = parseCell(info.cell)!;
    const { x, z } = cellToWorld(coord);
    dummy.position.set(x, info.unlocked ? 0 : -LOCKED_TILE_DROP, z);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    const color =
      info.cell === options.centerCell
        ? center
        : !info.unlocked
          ? locked
          : (coord.row + coord.col) % 2 === 0
            ? base
            : alt;
    mesh.setColorAt(i, color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.userData['cells'] = [...land];
  return mesh;
}

/** Khối đất nâu dưới lớp cỏ (lộ ra ở mép ô như bờ đất). Không dùng để raycast. */
function buildSoilBase(land: readonly TerrainCellInfo[]): InstancedMesh {
  const dummy = new Object3D();
  const size = CELL_SIZE - TILE_GAP * 0.5;
  const height = TILE_HEIGHT * (1 - GRASS_LAYER);
  const geometry = new BoxGeometry(size, height, size);
  geometry.translate(0, -TILE_HEIGHT * GRASS_LAYER - height / 2, 0);
  const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  const mesh = new InstancedMesh(geometry, material, land.length);
  mesh.name = TERRAIN_SOIL_NAME;
  mesh.receiveShadow = true;
  const soil = new Color(PLOT_GRID_DEFAULT_COLORS.soil);
  const soilLocked = new Color(PLOT_GRID_DEFAULT_COLORS.soilLocked);
  land.forEach((info, i) => {
    const { x, z } = cellToWorld(parseCell(info.cell)!);
    dummy.position.set(x, info.unlocked ? 0 : -LOCKED_TILE_DROP, z);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, info.unlocked ? soil : soilLocked);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Mặt nước ao trong suốt + đáy ao, đúng theo các ô địa hình `water` được truyền vào. */
export function buildPondWater(
  waterCells: readonly TerrainCellInfo[],
  color: string = PLOT_GRID_DEFAULT_COLORS.water,
): Group {
  const group = new Group();
  group.name = TERRAIN_POND_NAME;
  const cells = waterCells.filter((c) => c.terrain === 'water' && parseCell(c.cell) !== null);
  if (cells.length === 0) return group;
  const dummy = new Object3D();

  const bedGeometry = new BoxGeometry(CELL_SIZE, TILE_HEIGHT, CELL_SIZE);
  bedGeometry.translate(0, -TILE_HEIGHT * 1.5, 0);
  const bedMaterial = new MeshStandardMaterial({ color: PLOT_GRID_DEFAULT_COLORS.pondBed, roughness: 1 });
  const bed = new InstancedMesh(bedGeometry, bedMaterial, cells.length);
  bed.name = TERRAIN_POND_BED_NAME;
  bed.receiveShadow = true;

  const surfaceGeometry = new PlaneGeometry(CELL_SIZE, CELL_SIZE);
  surfaceGeometry.rotateX(-Math.PI / 2);
  const surfaceMaterial = new MeshStandardMaterial({
    color: new Color(color),
    transparent: true,
    opacity: WATER_OPACITY,
    roughness: 0.15,
    metalness: 0.1,
    // Không ghi depth để vật thể dưới nước (cá) vẫn hiện xuyên qua mặt nước.
    depthWrite: false,
  });
  const surface = new InstancedMesh(surfaceGeometry, surfaceMaterial, cells.length);
  surface.name = TERRAIN_WATER_NAME;
  surface.renderOrder = 1;

  const lockedTint = new Color(PLOT_GRID_DEFAULT_COLORS.waterLockedTint);
  const open = new Color('#FFFFFF');
  cells.forEach((info, i) => {
    const { x, z } = cellToWorld(parseCell(info.cell)!);
    dummy.position.set(x, 0, z);
    dummy.updateMatrix();
    bed.setMatrixAt(i, dummy.matrix);
    dummy.position.y = WATER_SURFACE_Y;
    dummy.updateMatrix();
    surface.setMatrixAt(i, dummy.matrix);
    surface.setColorAt(i, info.unlocked ? open : lockedTint);
  });
  bed.instanceMatrix.needsUpdate = true;
  surface.instanceMatrix.needsUpdate = true;
  if (surface.instanceColor) surface.instanceColor.needsUpdate = true;
  bed.computeBoundingSphere();
  surface.computeBoundingSphere();
  surface.userData['cells'] = [...cells];

  group.add(bed, surface);
  return group;
}
