/**
 * Giải phóng tài nguyên GPU (geometry, material, texture) của cây đối tượng 3D.
 *
 * Hàm thuần, không phụ thuộc Angular. Dùng khi thay Cây OCB theo mốc mới, dựng lại
 * lưới ô sau khi mở vùng đất, hoặc huỷ khung 3D khi rời route nông trại.
 * Gọi `dispose()` nhiều lần trên cùng một geometry/material (do dùng chung giữa
 * các mesh) là an toàn — hàm khử trùng lặp trước khi giải phóng.
 *
 * _Requirements: US-36, US-39_
 */
import { BufferGeometry, Material, Mesh, Object3D, Texture } from 'three';

function isMeshLike(obj: Object3D): obj is Mesh {
  return 'geometry' in obj && 'material' in obj;
}

function collectTextures(material: Material, out: Set<Texture>): void {
  for (const value of Object.values(material)) {
    if (value instanceof Texture) out.add(value);
  }
}

/** Giải phóng một material hoặc mảng material, kèm mọi texture gắn vào. */
export function disposeMaterial(material: Material | Material[]): void {
  const list = Array.isArray(material) ? material : [material];
  const textures = new Set<Texture>();
  for (const m of list) {
    collectTextures(m, textures);
    m.dispose();
  }
  textures.forEach((t) => t.dispose());
}

/**
 * Duyệt toàn bộ cây con của `root`, giải phóng geometry/material/texture (mỗi thứ
 * đúng một lần) và tuỳ chọn tách `root` khỏi cha.
 */
export function disposeObject3D(root: Object3D, detach = true): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  root.traverse((obj) => {
    if (!isMeshLike(obj)) return;
    if (obj.geometry instanceof BufferGeometry) geometries.add(obj.geometry);
    const mat = obj.material;
    (Array.isArray(mat) ? mat : [mat]).forEach((m) => m && materials.add(m));
  });
  geometries.forEach((g) => g.dispose());
  disposeMaterial([...materials]);
  if (detach) root.removeFromParent();
}
