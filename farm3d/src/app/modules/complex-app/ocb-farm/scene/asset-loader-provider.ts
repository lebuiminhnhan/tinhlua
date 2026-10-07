/**
 * Cầu nối `AssetLoaderService` (11.2) → `FarmAssetProvider` của khung 3D (11.1).
 *
 * - Mô hình đã nạp: tách các mesh của cảnh gốc thành `FarmMeshPart[]` (geometry, material
 *   và ma trận cục bộ so với gốc mô hình) để khung 3D dựng `InstancedMesh` cho từng mảnh.
 * - Mô hình lỗi ở mức đang xem: khối hộp fallback màu theo `fallback_color` của loại.
 * - Đang tải: dùng tạm mô hình đã có ở mức chất lượng khác (đổi mức không bị "nháy"),
 *   chưa có mức nào thì dùng khối hộp fallback tại đúng ô.
 * - Mã không có trong manifest → `null` (khung 3D không render).
 * - `revision` = `AssetLoaderService.version` → khung 3D dựng lại khi có hạng mục tải xong / lỗi.
 *
 * Mảnh mesh được cache theo `(quality, key)` và chỉ tính lại khi cảnh gốc đổi (tải lại /
 * giải phóng mức chất lượng), nên mỗi lần khung 3D dựng lại không tạo geometry/material mới.
 * Geometry/material thuộc `AssetLoaderService` (hoặc module `fallback-box`) — không dispose ở đây.
 *
 * _Requirements: US-36, US-39_
 */
import { Provider, Signal } from '@angular/core';
import { Matrix4, Mesh, Object3D } from 'three';
import { FARM_QUALITIES, FarmFixtureAssetKey, FarmQuality } from '../models/ocb-farm.model';
import { AssetLoaderService, fixtureAssetKey } from '../services/asset-loader.service';
import { FARM_ASSET_PROVIDER, FarmAssetProvider, FarmMeshPart, FarmRenderKey, FarmResolvedAsset } from './farm-asset-provider';
import { fallbackBoxParts } from './geometry/fallback-box';
import { fitMatrix, fitSpecFor, modelBounds } from './model-fit';

/** Tách mesh của cảnh gốc thành mảnh cho instancing (ma trận tính theo gốc mô hình). */
export function meshPartsOf(root: Object3D): FarmMeshPart[] {
  // Cảnh gốc không nằm trong scene → `matrixWorld` của mesh chính là biến đổi so với gốc
  // (gồm cả biến đổi riêng của gốc, ví dụ tỉ lệ chuẩn hoá do pipeline đặt).
  root.updateMatrixWorld(true);
  const parts: FarmMeshPart[] = [];
  root.traverse((obj) => {
    if (!(obj instanceof Mesh) || !obj.visible) return;
    parts.push({
      geometry: obj.geometry,
      material: obj.material,
      matrix: new Matrix4().copy(obj.matrixWorld),
      castShadow: obj.castShadow,
      receiveShadow: obj.receiveShadow,
    });
  });
  return parts;
}

interface CacheEntry {
  /** Cảnh gốc sinh ra mảnh; `string` = màu của khối hộp fallback. */
  source: Object3D | string;
  asset: FarmResolvedAsset;
}

export class AssetLoaderFarmProvider implements FarmAssetProvider {
  private readonly cache = new Map<string, CacheEntry>();

  readonly revision: Signal<number>;

  constructor(private readonly loader: AssetLoaderService) {
    this.revision = loader.version;
  }

  resolve(key: FarmRenderKey, quality: FarmQuality): FarmResolvedAsset | null {
    if (!this.loader.hasAsset(key)) {
      this.cache.delete(`${quality}|${key}`);
      return null;
    }
    const cacheId = `${quality}|${key}`;

    const template = this.loader.isFallback(key, quality) ? null : this.templateFor(key, quality);
    if (template) {
      const cached = this.cache.get(cacheId);
      if (cached && cached.source === template) return cached.asset;
      // Chuẩn hoá về kích thước ô (tâm đáy ở gốc) — mô hình nguồn có tỉ lệ rất khác nhau.
      const fit = fitMatrix(modelBounds(template), fitSpecFor(key));
      const parts = meshPartsOf(template).map((p) => ({
        ...p,
        matrix: new Matrix4().multiplyMatrices(fit, p.matrix ?? new Matrix4()),
      }));
      if (parts.length > 0) {
        const asset: FarmResolvedAsset = { parts, fallback: false };
        this.cache.set(cacheId, { source: template, asset });
        return asset;
      }
      // Mô hình rỗng (không có mesh) → coi như lỗi, dùng khối hộp.
    }

    const color = this.loader.fallbackColor(key);
    const cached = this.cache.get(cacheId);
    if (cached && cached.source === color) return cached.asset;
    const box = fallbackBoxParts(color);
    const asset: FarmResolvedAsset = {
      parts: [{ geometry: box.geometry, material: box.material, matrix: box.matrix, castShadow: true, receiveShadow: true }],
      fallback: true,
    };
    this.cache.set(cacheId, { source: box.color, asset });
    return asset;
  }

  /**
   * Cảnh gốc của vật nuôi để dựng riêng từng con (đi lại / bơi). Có clip thì chạy clip,
   * không có clip (mô hình tĩnh) thì lớp vật nuôi chuyển động thủ tục.
   * `null` nếu lỗi / chưa tải / không phải vật nuôi.
   */
  animatedTemplate(key: FarmRenderKey, quality: FarmQuality): Object3D | null {
    if (!key.startsWith('animal:')) return null;
    if (!this.loader.hasAsset(key) || this.loader.isFallback(key, quality)) return null;
    return this.templateFor(key, quality);
  }

  variantCount(key: FarmRenderKey): number {
    return this.loader.getEntry(key)?.variants?.length ?? 0;
  }

  /** Mô hình thật đã sẵn sàng (không phải khối hộp) — biến thể chưa tải thì dùng bản gốc. */
  isLoaded(key: FarmRenderKey, quality: FarmQuality): boolean {
    return this.loader.hasAsset(key) && !this.loader.isFallback(key, quality) && this.templateFor(key, quality) !== null;
  }

  /**
   * Cảnh gốc của một vật thể cố định (nhà kho…), đã chuẩn hoá kích thước theo ô
   * (`fitMatrix`, giống vật nuôi/trang trí) — khung 3D thêm trực tiếp bản sao này vào
   * scene, không qua `InstancedMesh`. `null` khi mã chưa khai báo / đang tải / lỗi.
   * Vật thể cố định chỉ dựng một lần (`FarmSceneService.syncWarehouse`) nên không cần
   * cache riêng cho bản đã chuẩn hoá — mỗi lần gọi tính lại `fitMatrix` trên cảnh gốc
   * (đã cache ở `templateFor`), chi phí không đáng kể.
   */
  fixtureTemplate(key: FarmFixtureAssetKey, quality: FarmQuality): Object3D | null {
    const assetKey = fixtureAssetKey(key);
    if (!this.loader.hasAsset(assetKey) || this.loader.isFallback(assetKey, quality)) return null;
    const template = this.templateFor(assetKey, quality);
    if (!template) return null;
    const fit = fitMatrix(modelBounds(template), fitSpecFor(assetKey));
    const fitted = template.clone();
    fitted.applyMatrix4(fit);
    fitted.updateMatrixWorld(true);
    return fitted;
  }

  /** Mô hình ở đúng mức; chưa có thì mượn mức gần nhất đã nạp. */
  private templateFor(key: FarmRenderKey | ReturnType<typeof fixtureAssetKey>, quality: FarmQuality): Object3D | null {
    const exact = this.loader.getTemplate(key, quality);
    if (exact) return exact;
    const idx = FARM_QUALITIES.indexOf(quality);
    const others = [...FARM_QUALITIES].sort(
      (a, b) => Math.abs(FARM_QUALITIES.indexOf(a) - idx) - Math.abs(FARM_QUALITIES.indexOf(b) - idx),
    );
    for (const q of others) {
      if (q === quality) continue;
      const t = this.loader.getTemplate(key, q);
      if (t) return t;
    }
    return null;
  }
}

/** Đăng ký `FARM_ASSET_PROVIDER` từ `AssetLoaderService` (đặt trong `providers` của host khung 3D). */
export function provideAssetLoaderFarmProvider(): Provider {
  return {
    provide: FARM_ASSET_PROVIDER,
    useFactory: (loader: AssetLoaderService) => new AssetLoaderFarmProvider(loader),
    deps: [AssetLoaderService],
  };
}
