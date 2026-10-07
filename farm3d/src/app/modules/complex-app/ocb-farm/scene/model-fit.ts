/**
 * OCB Farm — chuẩn hoá kích thước mô hình theo ô đất.
 *
 * Mô hình CC0 tải về có tỉ lệ rất khác nhau (gà 0.02 đơn vị, hàng rào 5.9 đơn vị…), nên
 * mỗi mã hiển thị được co giãn ĐỀU sao cho:
 * - bề ngang lớn nhất (x/z) = `footprint` × CELL_SIZE,
 * - và chiều cao không vượt `maxHeight` × CELL_SIZE (nếu có),
 * - gốc mô hình = tâm đáy (đặt đúng trên mặt ô, y = 0).
 *
 * Hàm thuần — không phụ thuộc Angular; ma trận tính từ hộp bao ở tư thế gốc (bind pose).
 */
import { Box3, Matrix4, Mesh, Object3D, Vector3 } from 'three';
import { CELL_SIZE } from './farm-scene-math';

export interface ModelFitSpec {
  /** Bề ngang lớn nhất, tính theo cạnh ô (0..1). */
  footprint: number;
  /** Chiều cao tối đa, tính theo cạnh ô. */
  maxHeight?: number;
}

/** Vật nuôi: nhỏ hơn ô để còn chỗ đi lại. */
const ANIMAL_FIT: Readonly<Record<string, ModelFitSpec>> = {
  chicken: { footprint: 0.22, maxHeight: 0.25 },
  fish: { footprint: 0.22, maxHeight: 0.08 },
  sheep: { footprint: 0.34, maxHeight: 0.32 },
  pig: { footprint: 0.32, maxHeight: 0.26 },
  cow: { footprint: 0.44, maxHeight: 0.4 },
  horse: { footprint: 0.46, maxHeight: 0.46 },
  // Free_Roam_Pet (chó/mèo) — kích thước gọn, đi lại tự do toàn lưới.
  dog: { footprint: 0.26, maxHeight: 0.28 },
  cat: { footprint: 0.2, maxHeight: 0.22 },
};

/** Cây ăn quả lớn (tán rộng gần hết ô); hoa nhỏ gọn. */
const FRUIT_TREES = new Set(['banana', 'orange', 'mango']);

const PLANT_STAGE_FIT: Readonly<Record<string, ModelFitSpec>> = {
  seed: { footprint: 0.45, maxHeight: 0.12 },
  sprout: { footprint: 0.3, maxHeight: 0.25 },
};

const DECOR_FIT: Readonly<Record<string, ModelFitSpec>> = {
  // Hàng rào / lối đi phủ trọn một cạnh ô để nối liền nhau.
  fence: { footprint: 1, maxHeight: 0.3 },
  path: { footprint: 1, maxHeight: 0.08 },
  bench: { footprint: 0.55, maxHeight: 0.3 },
  lamp: { footprint: 0.3, maxHeight: 0.9 },
  well: { footprint: 0.65, maxHeight: 0.8 },
  nameplate: { footprint: 0.4, maxHeight: 0.45 },
  seasonal: { footprint: 0.4, maxHeight: 0.35 },
  tree: { footprint: 0.95, maxHeight: 1.6 },
  bush: { footprint: 0.6, maxHeight: 0.45 },
  flowerbed: { footprint: 0.75, maxHeight: 0.35 },
  crop: { footprint: 0.9, maxHeight: 0.3 },
  produce: { footprint: 0.3, maxHeight: 0.22 },
};

/** Mã trang trí cụ thể cần kích thước riêng (ghi đè nhóm). */
const DECOR_KIND_FIT: ReadonlyArray<readonly [RegExp, ModelFitSpec]> = [
  [/^flowerbed_petal/, { footprint: 0.85, maxHeight: 0.06 }],
  [/^lamp_stand$/, { footprint: 0.25, maxHeight: 0.6 }],
  [/^seasonal_pumpkin$/, { footprint: 0.5, maxHeight: 0.35 }],
  // Cối xay gió — công trình cao, chân đế nhỏ hơn 1 ô.
  [/^well_windmill$/, { footprint: 0.7, maxHeight: 1.8 }],
  // Cụm cây rừng — nhiều cây ghép, tán rộng hơn 1 cây đơn.
  [/^tree_grove$/, { footprint: 1.3, maxHeight: 1.7 }],
  // Cây sồi (Esdras Paravizo) — tán thấp và rộng hơn các cây khác trong nhóm `tree`
  // (bounding box gốc: y/max(x,z) ≈ 0.47, ngược với dáng cao vút của `DECOR_FIT.tree`).
  [/^tree_oak_v2$/, { footprint: 1.0, maxHeight: 0.75 }],
];

const DEFAULT_FIT: ModelFitSpec = { footprint: 0.6, maxHeight: 0.8 };

/** Vật thể cố định (`fixture:*`) — công trình, lớn hơn 1 ô (footprint > 1) để trông đúng tỉ lệ. */
const FIXTURE_FIT: Readonly<Record<string, ModelFitSpec>> = {
  warehouse: { footprint: 1.6, maxHeight: 1.4 },
};

/** Quy tắc kích thước theo mã hiển thị (`animal:cow`, `plant:mango:grown`, `decor:fence`, `fixture:warehouse`). */
export function fitSpecFor(key: string): ModelFitSpec {
  // Biến thể (`#n`) dùng cùng quy tắc với bản gốc.
  const hash = key.indexOf('#');
  const [category, kind = '', stage = ''] = (hash < 0 ? key : key.slice(0, hash)).split(':');
  if (category === 'animal') return ANIMAL_FIT[kind] ?? { footprint: 0.35, maxHeight: 0.35 };
  if (category === 'fixture') return FIXTURE_FIT[kind] ?? { footprint: 1.4, maxHeight: 1.2 };
  if (category === 'decor') {
    const special = DECOR_KIND_FIT.find(([re]) => re.test(kind));
    if (special) return special[1];
    return DECOR_FIT[kind] ?? DECOR_FIT[kind.split('_')[0]] ?? DEFAULT_FIT;
  }
  if (category === 'plant') {
    const byStage = PLANT_STAGE_FIT[stage];
    if (byStage) return byStage;
    return FRUIT_TREES.has(kind)
      ? { footprint: 0.8, maxHeight: 1.1 }
      : { footprint: 0.5, maxHeight: 0.5 };
  }
  return DEFAULT_FIT;
}

/**
 * Hộp bao của mọi mesh nhìn thấy (theo `matrixWorld` so với gốc). Dùng hộp bao của
 * geometry thay vì đỉnh đã skin → ổn định với mô hình có xương trước khi skeleton cập nhật.
 */
export function modelBounds(root: Object3D): Box3 {
  root.updateMatrixWorld(true);
  const box = new Box3();
  const tmp = new Box3();
  root.traverse((obj) => {
    if (!(obj instanceof Mesh) || !obj.visible) return;
    const geometry = obj.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingBox) return;
    tmp.copy(geometry.boundingBox).applyMatrix4(obj.matrixWorld);
    box.union(tmp);
  });
  return box;
}

/** Tỉ lệ đều để hộp `size` khớp quy tắc `spec`. Hộp rỗng/suy biến → 1. */
export function fitScale(size: Vector3, spec: ModelFitSpec): number {
  const horizontal = Math.max(size.x, size.z);
  const candidates: number[] = [];
  if (horizontal > 1e-6) candidates.push((spec.footprint * CELL_SIZE) / horizontal);
  if (spec.maxHeight !== undefined && size.y > 1e-6) candidates.push((spec.maxHeight * CELL_SIZE) / size.y);
  if (candidates.length === 0) return 1;
  const scale = Math.min(...candidates);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/**
 * Ma trận chuẩn hoá: dời tâm đáy hộp bao về gốc rồi co giãn đều theo `spec`.
 * Nhân TRƯỚC ma trận cục bộ của từng mảnh (`N × local`).
 */
export function fitMatrix(box: Box3, spec: ModelFitSpec): Matrix4 {
  if (box.isEmpty()) return new Matrix4();
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const s = fitScale(size, spec);
  return new Matrix4()
    .makeScale(s, s, s)
    .multiply(new Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));
}

/** Kích thước sau chuẩn hoá (đơn vị thế giới) — dùng cho hộp chạm vô hình của vật nuôi. */
export function fittedSize(box: Box3, spec: ModelFitSpec): Vector3 {
  if (box.isEmpty()) return new Vector3(spec.footprint * CELL_SIZE, spec.footprint * CELL_SIZE, spec.footprint * CELL_SIZE);
  const size = box.getSize(new Vector3());
  return size.multiplyScalar(fitScale(size, spec));
}
