/**
 * OCB Farm — cảnh vật ngẫu nhiên rải trên lưới (thuần hiển thị).
 *
 * Mỗi ô nhận vài khóm cỏ, sỏi, hoa dại (ô đất) hoặc lá súng (ô nước) đặt sát MÉP ô để không
 * che vật thể ở giữa ô. "Ngẫu nhiên" nhưng tất định theo mã ô → cùng nông trại luôn trông
 * giống nhau giữa các lần tải, nông trại khác nhau trông khác nhau. Ô chưa mở rậm cỏ hơn
 * (đất hoang), ô Cây OCB không rải.
 *
 * 4 `InstancedMesh` (cỏ, sỏi, hoa, lá súng) → 4 draw call bất kể diện tích. Không nằm
 * trong nhóm chọn ô: raycast trúng cảnh vật bị bỏ qua.
 */
import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
} from 'three';
import type { FarmCellRef, FarmPlot } from '../../models/ocb-farm.model';
import { CELL_SIZE, cellToWorld, parseCell } from '../farm-scene-math';
import { FARM_PALETTE } from '../farm-palette';
import { collectTerrainCells, WATER_SURFACE_Y } from './plot-grid.geometry';

export const FARM_SCATTER_NAME = 'farm-scatter';

const S = CELL_SIZE;
const GRASS_COLORS = [FARM_PALETTE.grassDark, FARM_PALETTE.leaf, FARM_PALETTE.grassLight, FARM_PALETTE.leafLight];
const WILD_GRASS_COLORS = ['#8F8A4A', '#A3964F', FARM_PALETTE.grassDark];
const FLOWER_COLORS = [FARM_PALETTE.white, FARM_PALETTE.yellow, FARM_PALETTE.pink, FARM_PALETTE.purple, FARM_PALETTE.red];
const PEBBLE_COLORS = [FARM_PALETTE.stoneLight, FARM_PALETTE.stoneDark, '#A39A8A'];

/** Bộ sinh số giả ngẫu nhiên Mulberry32 — tất định theo hạt giống. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cellSeed(cell: FarmCellRef): number {
  let h = 2166136261;
  for (let i = 0; i < cell.length; i++) {
    h ^= cell.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

interface Placement {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotY: number;
  color: string;
}

/** Điểm gần mép ô (bán kính 0.3..0.46 cạnh ô) để không đè vật thể giữa ô. */
function edgePoint(rand: () => number, cx: number, cz: number): { x: number; z: number } {
  const a = rand() * Math.PI * 2;
  const r = (0.3 + rand() * 0.16) * S;
  return { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r };
}

function pick<T>(rand: () => number, list: readonly T[]): T {
  return list[Math.floor(rand() * list.length) % list.length];
}

function instanced(
  geometry: ConeGeometry | DodecahedronGeometry | IcosahedronGeometry | CylinderGeometry,
  items: readonly Placement[],
  name: string,
  shadow: boolean,
): InstancedMesh | null {
  if (items.length === 0) {
    geometry.dispose();
    return null;
  }
  const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, flatShading: true });
  const mesh = new InstancedMesh(geometry, material, items.length);
  mesh.name = name;
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  const dummy = new Object3D();
  const color = new Color();
  items.forEach((p, i) => {
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, p.rotY, 0);
    dummy.scale.setScalar(p.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, color.set(p.color));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Dựng nhóm cảnh vật ngẫu nhiên cho toàn bộ lưới. Giải phóng bằng `disposeObject3D`. */
export function buildFarmScatter(plots: readonly FarmPlot[], centerCell: FarmCellRef | null): Group {
  const group = new Group();
  group.name = FARM_SCATTER_NAME;
  const { land, water } = collectTerrainCells(plots);
  const grass: Placement[] = [];
  const pebbles: Placement[] = [];
  const flowers: Placement[] = [];
  const pads: Placement[] = [];

  for (const info of land) {
    if (info.cell === centerCell) continue;
    const coord = parseCell(info.cell);
    if (!coord) continue;
    const { x: cx, z: cz } = cellToWorld(coord);
    const rand = seededRandom(cellSeed(info.cell));
    const baseY = info.unlocked ? 0 : -0.03 * S;
    const tufts = info.unlocked ? 1 + Math.floor(rand() * 3) : 3 + Math.floor(rand() * 4);
    for (let i = 0; i < tufts; i++) {
      const p = edgePoint(rand, cx, cz);
      grass.push({
        ...p,
        y: baseY,
        scale: S * (0.7 + rand() * 0.6),
        rotY: rand() * Math.PI,
        color: pick(rand, info.unlocked ? GRASS_COLORS : WILD_GRASS_COLORS),
      });
    }
    if (rand() < (info.unlocked ? 0.25 : 0.45)) {
      const p = edgePoint(rand, cx, cz);
      pebbles.push({ ...p, y: baseY, scale: S * (0.6 + rand() * 0.8), rotY: rand() * Math.PI, color: pick(rand, PEBBLE_COLORS) });
    }
    const flowerCount = info.unlocked ? (rand() < 0.45 ? 1 + Math.floor(rand() * 2) : 0) : rand() < 0.2 ? 1 : 0;
    for (let i = 0; i < flowerCount; i++) {
      const p = edgePoint(rand, cx, cz);
      flowers.push({ ...p, y: baseY + 0.055 * S, scale: S * (0.8 + rand() * 0.5), rotY: 0, color: pick(rand, FLOWER_COLORS) });
      // Thân hoa = một khóm cỏ nhỏ ngay dưới bông.
      grass.push({ ...p, y: baseY, scale: S * 0.55, rotY: rand() * Math.PI, color: FARM_PALETTE.leaf });
    }
  }

  for (const info of water) {
    const coord = parseCell(info.cell);
    if (!coord) continue;
    const { x: cx, z: cz } = cellToWorld(coord);
    const rand = seededRandom(cellSeed(info.cell) ^ 0x9e3779b9);
    if (rand() < 0.6) {
      const p = edgePoint(rand, cx, cz);
      pads.push({ ...p, y: WATER_SURFACE_Y + 0.004 * S, scale: S * (0.8 + rand() * 0.5), rotY: rand() * Math.PI * 2, color: pick(rand, [FARM_PALETTE.leaf, FARM_PALETTE.grassDark]) });
      if (rand() < 0.4) flowers.push({ ...p, y: WATER_SURFACE_Y + 0.02 * S, scale: S * 0.9, rotY: 0, color: FARM_PALETTE.pink });
    }
  }

  // Hình học theo "đơn vị ô" (scale = CELL_SIZE × hệ số ngẫu nhiên).
  const tuft = new ConeGeometry(0.03, 0.09, 5);
  tuft.translate(0, 0.045, 0);
  const pebble = new DodecahedronGeometry(0.028, 0);
  pebble.scale(1, 0.55, 1);
  const flower = new IcosahedronGeometry(0.018, 0);
  const pad = new CylinderGeometry(0.06, 0.06, 0.004, 9);

  for (const mesh of [
    instanced(tuft, grass, `${FARM_SCATTER_NAME}-grass`, false),
    instanced(pebble, pebbles, `${FARM_SCATTER_NAME}-pebbles`, true),
    instanced(flower, flowers, `${FARM_SCATTER_NAME}-flowers`, false),
    instanced(pad, pads, `${FARM_SCATTER_NAME}-lilypads`, false),
  ]) {
    if (mesh) group.add(mesh);
  }
  return group;
}
