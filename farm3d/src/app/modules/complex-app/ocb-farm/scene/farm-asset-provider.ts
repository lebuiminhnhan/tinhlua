/**
 * Điểm nối hẹp giữa `FarmSceneService` (11.1) và `AssetLoaderService` (11.2).
 *
 * Khung 3D không biết GLTF/Draco hay đường dẫn file: nó chỉ hỏi "mã hiển thị X ở mức
 * chất lượng Y gồm những mảnh mesh nào" và dựng `InstancedMesh` cho từng mảnh.
 * `AssetLoaderService` cung cấp bằng token `FARM_ASSET_PROVIDER` (hoặc gọi
 * `FarmSceneService.setAssetProvider`).
 *
 * _Requirements: US-36, US-39_
 */
import { InjectionToken, Signal } from '@angular/core';
import type { BufferGeometry, Material, Matrix4, Object3D } from 'three';
import type {
  DecorKind,
  FarmFixtureAssetKey,
  FarmQuality,
  FarmSpecies,
  PlantKind,
  PlantStage,
} from '../models/ocb-farm.model';

/** Mã hiển thị của một nhóm vật thể dùng chung mô hình (một nhóm = một bộ InstancedMesh). */
/** Hậu tố biến thể ngẫu nhiên `#<n>` (n ≥ 1) — xem `variants` trong manifest. */
type VariantSuffix = '' | `#${number}`;

export type FarmRenderKey =
  | `animal:${FarmSpecies}${VariantSuffix}`
  | `plant:${PlantKind}:${PlantStage}${VariantSuffix}`
  | `decor:${DecorKind}`;

/** Bỏ hậu tố biến thể: `animal:cow#2` → `animal:cow`. */
export function baseRenderKey(key: string): string {
  const i = key.indexOf('#');
  return i < 0 ? key : key.slice(0, i);
}

/** Băm chuỗi ổn định (FNV-1a 32-bit) — chọn biến thể / rải cảnh vật tất định. */
export function stableHash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Chọn ngẫu nhiên (tất định theo `id`) giữa bản gốc và `variantCount` biến thể.
 * Cùng một vật thể luôn ra cùng một dáng; vật thể khác nhau ra dáng khác nhau.
 */
export function pickVariant<K extends string>(key: K, id: string, variantCount: number): K {
  if (variantCount <= 0) return key;
  const n = stableHash(`${id}|${key}`) % (variantCount + 1);
  return (n === 0 ? key : `${key}#${n}`) as K;
}

export type FarmRenderCategory = 'animal' | 'plant' | 'decor';

export function animalRenderKey(species: FarmSpecies): FarmRenderKey {
  return `animal:${species}`;
}

export function plantRenderKey(kind: PlantKind, stage: PlantStage): FarmRenderKey {
  return `plant:${kind}:${stage}`;
}

export function decorRenderKey(kind: DecorKind): FarmRenderKey {
  return `decor:${kind}`;
}

export function renderCategoryOf(key: FarmRenderKey): FarmRenderCategory {
  return key.slice(0, key.indexOf(':')) as FarmRenderCategory;
}

/**
 * Một mảnh mesh của mô hình. Mô hình GLTF nhiều mesh → nhiều mảnh, mỗi mảnh thành một
 * `InstancedMesh`. `matrix` là biến đổi cục bộ của mảnh so với gốc mô hình (gốc = tâm đáy,
 * đặt trên mặt ô).
 */
export interface FarmMeshPart {
  geometry: BufferGeometry;
  material: Material | Material[];
  matrix?: Matrix4;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

export interface FarmResolvedAsset {
  parts: readonly FarmMeshPart[];
  /** `true` khi là khối hộp fallback (mô hình tải lỗi / chưa tải xong). */
  fallback: boolean;
}

export interface FarmAssetProvider {
  /**
   * Trả mesh cho `key` ở mức `quality`.
   * - `null`: mã không khai báo trong manifest → khung 3D KHÔNG render vật thể đó.
   * - Geometry/material thuộc quyền sở hữu của provider: khung 3D không `dispose()` chúng.
   */
  resolve(key: FarmRenderKey, quality: FarmQuality): FarmResolvedAsset | null;
  /**
   * Cảnh gốc có xương + clip hoạt ảnh (`animations`) của mã — khung 3D tạo bản sao riêng
   * cho từng vật nuôi để chạy `AnimationMixer`. `null` khi chưa tải xong / lỗi / không có
   * mô hình (khung 3D dùng `resolve` như cũ). Tuỳ chọn.
   */
  animatedTemplate?(key: FarmRenderKey, quality: FarmQuality): Object3D | null;
  /** Số biến thể ngẫu nhiên khai báo cho mã gốc (0 khi không có). Tuỳ chọn. */
  variantCount?(key: FarmRenderKey): number;
  /** Mô hình thật của mã đã tải xong ở mức `quality`. Tuỳ chọn. */
  isLoaded?(key: FarmRenderKey, quality: FarmQuality): boolean;
  /**
   * Tăng mỗi khi có hạng mục tải xong / lỗi / thử lại — khung 3D đọc để dựng lại
   * nhóm instancing tương ứng. Tuỳ chọn.
   */
  readonly revision?: Signal<number>;
  /**
   * Cảnh gốc của một vật thể cố định (`manifest.fixtures`, ví dụ nhà kho) — khác vật nuôi
   * / cây / trang trí, fixture không nhân bản qua `InstancedMesh` (chỉ một bản, giống Cây
   * OCB) nên khung 3D thêm trực tiếp vào scene bằng bản sao của cảnh gốc này.
   * `null` khi mã không có trong manifest / đang tải / lỗi (khung 3D dùng khối hộp
   * fallback theo `fallback_color` của mục fixture). Tuỳ chọn — chưa có provider thì
   * khung 3D không dựng fixture.
   */
  fixtureTemplate?(key: FarmFixtureAssetKey, quality: FarmQuality): Object3D | null;
}

export const FARM_ASSET_PROVIDER = new InjectionToken<FarmAssetProvider>('FARM_ASSET_PROVIDER');
