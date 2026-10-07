/**
 * Khối hộp fallback — hình đại diện khi mô hình thật tải lỗi (US-39).
 *
 * Hàm thuần, không phụ thuộc Angular. Màu lấy theo `fallback_color` của loại vật thể
 * trong manifest tài nguyên. Hình học dùng chung một `BoxGeometry` đơn vị cho mọi khối
 * (scale theo `size`), material dùng chung theo màu — nên nhiều khối cùng loại không
 * tạo thêm tài nguyên GPU. `userData.fallback = true` để nhận diện.
 *
 * Lưu ý: geometry/material dùng chung — KHÔNG gọi `disposeObject3D` trên từng khối;
 * gọi `disposeFallbackBoxes()` một lần khi huỷ khung 3D.
 *
 * _Requirements: US-39_
 */
import { BoxGeometry, Color, Matrix4, Mesh, MeshStandardMaterial } from 'three';
import { CELL_SIZE } from '../farm-scene-math';

export interface FallbackBoxSize {
  width: number;
  height: number;
  depth: number;
}

/** Kích thước mặc định: 60% cạnh một ô đất. */
export const FALLBACK_BOX_DEFAULT_SIZE: Readonly<FallbackBoxSize> = {
  width: 0.6 * CELL_SIZE,
  height: 0.6 * CELL_SIZE,
  depth: 0.6 * CELL_SIZE,
};

/** Khớp `default_fallback_color` của manifest — dùng khi không xác định được loại. */
export const DEFAULT_FALLBACK_COLOR = '#B0B0B0';
const DEFAULT_COLOR = DEFAULT_FALLBACK_COLOR;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * Màu fallback theo nhóm vật thể khi CHƯA có manifest (khung 3D dựng trước khi manifest
 * tải xong). Có manifest thì luôn dùng `fallbackColorFromManifest`.
 */
export const FALLBACK_CATEGORY_COLORS = {
  animal: '#FFB74D',
  plant: '#66BB6A',
  decor: '#A1887F',
} as const;

let sharedGeometry: BoxGeometry | null = null;
const materials = new Map<string, MeshStandardMaterial>();

/** Chuẩn hoá màu `#RRGGBB`; giá trị không hợp lệ → màu mặc định. */
export function normalizeFallbackColor(color: string | null | undefined, fallback = DEFAULT_COLOR): string {
  if (typeof color === 'string' && HEX_COLOR.test(color)) return color.toUpperCase();
  return HEX_COLOR.test(fallback) ? fallback.toUpperCase() : DEFAULT_COLOR;
}

function geometry(): BoxGeometry {
  if (!sharedGeometry) {
    sharedGeometry = new BoxGeometry(1, 1, 1);
    // Đáy khối nằm trên mặt ô (y = 0) thay vì tâm khối.
    sharedGeometry.translate(0, 0.5, 0);
  }
  return sharedGeometry;
}

function material(color: string): MeshStandardMaterial {
  let mat = materials.get(color);
  if (!mat) {
    mat = new MeshStandardMaterial({ color: new Color(color), roughness: 0.9, metalness: 0 });
    mat.name = `fallback-${color}`;
    materials.set(color, mat);
  }
  return mat;
}

/** Tạo một khối hộp fallback màu theo loại; đáy khối nằm ở y = 0. */
export function createFallbackBox(
  color: string | null | undefined,
  size: Readonly<FallbackBoxSize> = FALLBACK_BOX_DEFAULT_SIZE,
): Mesh {
  const hex = normalizeFallbackColor(color);
  const mesh = new Mesh(geometry(), material(hex));
  mesh.scale.set(size.width, size.height, size.depth);
  mesh.name = 'fallback-box';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData['fallback'] = true;
  mesh.userData['fallbackColor'] = hex;
  return mesh;
}

/**
 * Mảnh mesh của khối hộp fallback cho `InstancedMesh` (khung 3D). Geometry/material dùng
 * chung với `createFallbackBox` — người gọi KHÔNG `dispose()` chúng. `matrix` chứa tỉ lệ
 * kích thước (geometry là hộp đơn vị, đáy ở y = 0).
 */
export interface FallbackBoxParts {
  geometry: BoxGeometry;
  material: MeshStandardMaterial;
  matrix: Matrix4;
  color: string;
}

export function fallbackBoxParts(
  color: string | null | undefined,
  size: Readonly<FallbackBoxSize> = FALLBACK_BOX_DEFAULT_SIZE,
): FallbackBoxParts {
  const hex = normalizeFallbackColor(color);
  return {
    geometry: geometry(),
    material: material(hex),
    matrix: new Matrix4().makeScale(size.width, size.height, size.depth),
    color: hex,
  };
}

/** Giải phóng geometry/material dùng chung của mọi khối fallback. */
export function disposeFallbackBoxes(): void {
  sharedGeometry?.dispose();
  sharedGeometry = null;
  materials.forEach((m) => m.dispose());
  materials.clear();
}
