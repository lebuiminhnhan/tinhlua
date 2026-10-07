import { DestroyRef, Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Mesh, Object3D } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import {
  DecorKind,
  FARM_QUALITIES,
  FarmAssetManifest,
  FarmFixtureAssetKey,
  FarmGlbAssetEntry,
  FarmQuality,
  FarmSpecies,
  PLANT_STAGES,
  PlantKind,
  PlantStage,
} from '../models/ocb-farm.model';
import {
  FarmLoadItemDef,
  FarmLoadTracker,
} from '../components/loading-overlay/load-progress';
import {
  DEFAULT_FALLBACK_COLOR,
  createFallbackBox,
  disposeFallbackBoxes,
  normalizeFallbackColor,
} from '../scene/geometry/fallback-box';
import { disposeObject3D } from '../scene/geometry/dispose';
import { stylizeMaterials } from '../scene/farm-palette';

/**
 * OCB Farm — nạp tài nguyên 3D (US-36, US-39).
 *
 * - Manifest (`assets/ocb-farm/asset-manifest.json`) là nguồn chân lý duy nhất: service
 *   không biết đường dẫn GLB nào ngoài manifest. Mã không khai báo trong manifest thì
 *   không nạp (`loadAll` bỏ qua, báo trong `skipped`) và không render (`createInstance` → `null`).
 * - Nạp GLTF nén Draco theo mức chất lượng (`files[quality]`). Mỗi mã tài nguyên là một
 *   hạng mục tải trong `FarmLoadTracker` (tiến trình riêng 0..1, phần trăm tổng monotonic
 *   trong mỗi `session`). File dùng chung giữa nhiều mã (ví dụ mô hình hạt/mầm) chỉ tải một lần.
 * - Mô hình lỗi → `createInstance` trả khối hộp màu theo `fallback_color` (task 10.10)
 *   và hạng mục nằm trong `failedItems`. `retryFailed()` chỉ tải lại các hạng mục lỗi.
 * - Tích hợp overlay: hoặc dùng tracker riêng của service (signal `phase`/`progress`/
 *   `currentLabel`/`failedItems`/`session`), hoặc truyền `tracker` của component chính vào
 *   `loadAll` để hạng mục mô hình hiện chung một thanh tiến trình. Khi dùng tracker ngoài,
 *   component gọi `tracker.retry()` rồi chuyển các id có `isAssetLoadItemId` sang `runRetriedItems`.
 *
 * Draco decoder: `assets/ocb-farm/draco/` — được `angular.json` chép từ
 * `node_modules/three/examples/jsm/libs/draco/gltf` lúc build (không dùng CDN).
 *
 * _Requirements: US-36, US-39_
 */

// ---------------------------------------------------------------------------
// Mã tài nguyên
// ---------------------------------------------------------------------------

/** Hậu tố biến thể `#<n>` (n ≥ 1) — xem `variants` trong manifest. */
type VariantSuffix = '' | `#${number}`;
export type FarmAnimalAssetKey = `animal:${FarmSpecies}${VariantSuffix}`;
export type FarmPlantAssetKey = `plant:${PlantKind}:${PlantStage}${VariantSuffix}`;
export type FarmDecorAssetKey = `decor:${DecorKind}`;
export type FarmFixtureAssetKeyFull = `fixture:${FarmFixtureAssetKey}`;
/**
 * Mã tài nguyên GLB: `animal:<loài>`, `plant:<loại cây>:<giai đoạn>`, `decor:<mã trang trí>`,
 * `fixture:<mã vật thể cố định>` (nhà kho…, giống Cây OCB nhưng là model GLB thật).
 */
export type FarmAssetKey = FarmAnimalAssetKey | FarmPlantAssetKey | FarmDecorAssetKey | FarmFixtureAssetKeyFull;

export const animalAssetKey = (species: FarmSpecies): FarmAnimalAssetKey => `animal:${species}`;
export const plantAssetKey = (plant: PlantKind, stage: PlantStage): FarmPlantAssetKey =>
  `plant:${plant}:${stage}`;
export const decorAssetKey = (decor: DecorKind): FarmDecorAssetKey => `decor:${decor}`;
export const fixtureAssetKey = (fixture: FarmFixtureAssetKey): FarmFixtureAssetKeyFull =>
  `fixture:${fixture}`;

export const FARM_ASSET_MANIFEST_URL = 'assets/ocb-farm/asset-manifest.json';
export const FARM_DRACO_DECODER_PATH = 'assets/ocb-farm/draco/';

/** Tiền tố id hạng mục tải của service trong `FarmLoadTracker`. */
const ITEM_PREFIX = 'asset:';
export const FARM_ASSET_MANIFEST_ITEM_ID = `${ITEM_PREFIX}manifest`;

/** Id hạng mục gồm cả mức chất lượng — đổi mức tạo hạng mục mới, không đụng hạng mục cũ. */
export function assetLoadItemId(key: FarmAssetKey, quality: FarmQuality): string {
  return `${ITEM_PREFIX}${quality}:${key}`;
}

export function isAssetLoadItemId(id: string): boolean {
  return id.startsWith(ITEM_PREFIX);
}

function parseItemId(id: string): { key: FarmAssetKey; quality: FarmQuality } | null {
  if (!isAssetLoadItemId(id) || id === FARM_ASSET_MANIFEST_ITEM_ID) return null;
  const rest = id.slice(ITEM_PREFIX.length);
  const sep = rest.indexOf(':');
  const quality = rest.slice(0, sep) as FarmQuality;
  if (sep < 0 || !FARM_QUALITIES.includes(quality)) return null;
  return { key: rest.slice(sep + 1) as FarmAssetKey, quality };
}

// ---------------------------------------------------------------------------
// Đọc manifest — hàm thuần
// ---------------------------------------------------------------------------

function own<T extends object>(obj: T | null | undefined, key: string): unknown {
  return obj && Object.prototype.hasOwnProperty.call(obj, key)
    ? (obj as Record<string, unknown>)[key]
    : undefined;
}

function isGlbEntry(value: unknown): value is FarmGlbAssetEntry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<FarmGlbAssetEntry>;
  return v.source === 'glb' && typeof v.files === 'object' && v.files !== null;
}

/** Tra mục GLB của một mã; mã không khai báo (hoặc sai dạng) → `null`. */
export function resolveManifestAsset(
  manifest: FarmAssetManifest | null,
  key: string,
): FarmGlbAssetEntry | null {
  if (!manifest) return null;
  // Biến thể: `<mã>#<n>` → `variants[n - 1]` của mục gốc.
  const hash = key.indexOf('#');
  if (hash >= 0) {
    const base = resolveManifestAsset(manifest, key.slice(0, hash));
    const n = Number(key.slice(hash + 1));
    const variant = Number.isInteger(n) && n >= 1 ? base?.variants?.[n - 1] : undefined;
    return isGlbEntry(variant) ? variant : null;
  }
  const parts = key.split(':');
  let entry: unknown;
  if (parts[0] === 'animal' && parts.length === 2) {
    entry = own(manifest.animals, parts[1]);
  } else if (parts[0] === 'plant' && parts.length === 3) {
    const plant = own(manifest.plants, parts[1]) as { stages?: object } | undefined;
    entry = own(plant?.stages, parts[2]);
  } else if (parts[0] === 'decor' && parts.length === 2) {
    entry = own(manifest.decors, parts[1]);
  } else if (parts[0] === 'fixture' && parts.length === 2) {
    entry = own(manifest.fixtures, parts[1]);
  }
  return isGlbEntry(entry) ? entry : null;
}

/** Đường dẫn file của mục ở mức chất lượng; thiếu/rỗng → `null`. */
export function assetFileFor(entry: FarmGlbAssetEntry, quality: FarmQuality): string | null {
  const file = own(entry.files, quality);
  return typeof file === 'string' && file.trim().length > 0 ? file : null;
}

export interface FarmManifestAsset {
  key: FarmAssetKey;
  entry: FarmGlbAssetEntry;
}

/** Liệt kê mọi mục GLB trong manifest (tuỳ chọn chỉ tập tải lần đầu). */
export function listManifestAssets(
  manifest: FarmAssetManifest,
  options: { initialOnly?: boolean } = {},
): FarmManifestAsset[] {
  const out: FarmManifestAsset[] = [];
  const push = (key: FarmAssetKey, entry: unknown): void => {
    if (!isGlbEntry(entry)) return;
    if (!options.initialOnly || entry.initial) out.push({ key, entry });
    // Biến thể ngẫu nhiên (không thuộc tập tải lần đầu trừ khi tự khai báo `initial`).
    (entry.variants ?? []).forEach((variant, i) => {
      if (!isGlbEntry(variant)) return;
      if (options.initialOnly && !variant.initial) return;
      out.push({ key: `${key}#${i + 1}` as FarmAssetKey, entry: variant });
    });
  };
  for (const species of Object.keys(manifest.animals ?? {})) {
    push(`animal:${species}` as FarmAnimalAssetKey, own(manifest.animals, species));
  }
  for (const plant of Object.keys(manifest.plants ?? {})) {
    const stages = (own(manifest.plants, plant) as { stages?: object } | undefined)?.stages;
    for (const stage of PLANT_STAGES) {
      push(`plant:${plant}:${stage}` as FarmPlantAssetKey, own(stages, stage));
    }
  }
  for (const decor of Object.keys(manifest.decors ?? {})) {
    push(`decor:${decor}`, own(manifest.decors, decor));
  }
  for (const fixture of Object.keys(manifest.fixtures ?? {})) {
    push(`fixture:${fixture}` as FarmFixtureAssetKeyFull, own(manifest.fixtures, fixture));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bộ nạp GLTF (có thể thay trong test)
// ---------------------------------------------------------------------------

/** Nạp một file GLB → cảnh gốc. `onProgress` nhận tỉ lệ 0..1 khi biết dung lượng. */
export type FarmGltfLoadFn = (url: string, onProgress: (fraction: number) => void) => Promise<Object3D>;

export interface FarmGltfLoader {
  load: FarmGltfLoadFn;
  dispose(): void;
}

function resolveUrl(path: string): string {
  if (typeof document === 'undefined') return path;
  return new URL(path, document.baseURI).href;
}

/** Bộ nạp mặc định: `GLTFLoader` + `DRACOLoader` (decoder cục bộ, WASM), khởi tạo lười. */
export function createDefaultGltfLoader(): FarmGltfLoader {
  let loaders: Promise<{ gltf: GLTFLoader; draco: DRACOLoader }> | null = null;
  const ensure = () =>
    (loaders ??= Promise.all([
      import('three/examples/jsm/loaders/GLTFLoader.js'),
      import('three/examples/jsm/loaders/DRACOLoader.js'),
    ]).then(([g, d]) => {
      const draco = new d.DRACOLoader();
      draco.setDecoderPath(resolveUrl(FARM_DRACO_DECODER_PATH));
      draco.setDecoderConfig({ type: 'wasm' });
      const gltf = new g.GLTFLoader();
      gltf.setDRACOLoader(draco);
      return { gltf, draco };
    }));

  return {
    async load(url, onProgress) {
      const { gltf } = await ensure();
      const result = await gltf.loadAsync(resolveUrl(url), (event: ProgressEvent) => {
        if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
      });
      // Giữ clip hoạt ảnh (Idle/Walk/Swim…) trên cảnh gốc để vật nuôi chuyển động.
      result.scene.animations = result.animations ?? [];
      return result.scene;
    },
    dispose() {
      void loaders?.then(({ draco }) => draco.dispose());
      loaders = null;
    },
  };
}

export const FARM_GLTF_LOADER = new InjectionToken<FarmGltfLoader>('FARM_GLTF_LOADER', {
  providedIn: 'root',
  factory: createDefaultGltfLoader,
});

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface FarmAssetFailure {
  key: FarmAssetKey;
  label: string;
  quality: FarmQuality;
  error: string;
}

export interface FarmAssetLoadOptions {
  /** Chỉ nạp các mã này (mặc định: toàn bộ manifest, hoặc tập lần đầu nếu `initialOnly`). */
  keys?: readonly string[];
  initialOnly?: boolean;
  /** Tracker của container — hạng mục mô hình được thêm vào tracker này thay cho tracker riêng. */
  tracker?: FarmLoadTracker;
  timeoutMs?: number;
}

export interface FarmAssetLoadResult {
  quality: FarmQuality;
  loaded: FarmAssetKey[];
  failed: FarmAssetKey[];
  /** Mã được yêu cầu nhưng không có trong manifest — không nạp, không render. */
  skipped: string[];
}

interface LoadRequest {
  quality: FarmQuality;
  options: FarmAssetLoadOptions;
}

interface InflightFile {
  promise: Promise<Object3D>;
  listeners: Set<(fraction: number) => void>;
}

const MANIFEST_LABEL = 'Danh mục mô hình 3D';

function errorText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return 'Không tải được mô hình';
}

function cacheKey(quality: FarmQuality, key: string): string {
  return `${quality}|${key}`;
}

@Injectable({ providedIn: 'root' })
export class AssetLoaderService {
  private readonly http = inject(HttpClient);
  private readonly loader = inject(FARM_GLTF_LOADER);

  private readonly ownTracker = new FarmLoadTracker();
  private readonly activeTracker = signal<FarmLoadTracker>(this.ownTracker);

  private readonly _manifest = signal<FarmAssetManifest | null>(null);
  private readonly _quality = signal<FarmQuality>('low');
  private readonly _failures = signal<readonly FarmAssetFailure[]>([]);
  private readonly _version = signal(0);

  /** Cảnh gốc đã nạp, khoá `quality|key` — dùng chung qua `clone()`. */
  private readonly templates = new Map<string, Object3D>();
  /** File đang/đã nạp theo URL — khử trùng lặp file dùng chung giữa nhiều mã. */
  private readonly files = new Map<string, InflightFile>();
  private manifestRequest: Promise<FarmAssetManifest> | null = null;
  private lastRequest: LoadRequest | null = null;

  readonly manifest = this._manifest.asReadonly();
  /** Mức chất lượng của lần nạp gần nhất. */
  readonly quality = this._quality.asReadonly();

  // --- Tiến trình (từ tracker đang dùng) -----------------------------------
  readonly phase = computed(() => this.activeTracker().phase());
  /** Phần trăm 0..100, chỉ tăng hoặc giữ nguyên trong cùng `session`. */
  readonly progress = computed(() => this.activeTracker().percent());
  readonly session = computed(() => this.activeTracker().session());
  readonly currentLabel = computed(() => this.activeTracker().currentLabel());
  readonly timeoutSeconds = computed(() => this.activeTracker().timeoutSeconds());
  /** Hạng mục lỗi dạng của overlay (`FarmLoadItem`) — chỉ gồm hạng mục của service. */
  readonly failedLoadItems = computed(() =>
    this.activeTracker()
      .failedItems()
      .filter((i) => isAssetLoadItemId(i.id)),
  );

  /** Mô hình lỗi ở mức chất lượng hiện tại — hiển thị bằng khối hộp fallback. */
  readonly failedItems = computed(() =>
    this._failures().filter((f) => f.quality === this._quality()),
  );
  readonly hasFailures = computed(() => this.failedItems().length > 0);

  /** Tăng mỗi khi mô hình nạp xong / chuyển sang fallback — khung 3D dựng lại vật thể bị ảnh hưởng. */
  readonly version = this._version.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.dispose());
  }

  // -------------------------------------------------------------------------
  // Manifest
  // -------------------------------------------------------------------------

  /** Nạp manifest (một lần; lỗi thì lần gọi sau thử lại). */
  async loadManifest(): Promise<FarmAssetManifest> {
    const current = this._manifest();
    if (current) return current;
    this.manifestRequest ??= firstValueFrom(
      this.http.get<FarmAssetManifest>(FARM_ASSET_MANIFEST_URL),
    )
      .then((m) => {
        if (!m || typeof m !== 'object' || typeof m.animals !== 'object') {
          throw new Error('Danh mục mô hình 3D không hợp lệ');
        }
        this._manifest.set(m);
        return m;
      })
      .finally(() => {
        this.manifestRequest = null;
      });
    return this.manifestRequest;
  }

  /** Đặt manifest đã có sẵn (ví dụ test hoặc đã nạp ở nơi khác). */
  setManifest(manifest: FarmAssetManifest): void {
    this._manifest.set(manifest);
  }

  /** Mã có khai báo trong manifest không — `false` thì không được render. */
  hasAsset(key: string): boolean {
    return resolveManifestAsset(this._manifest(), key) !== null;
  }

  getEntry(key: string): FarmGlbAssetEntry | null {
    return resolveManifestAsset(this._manifest(), key);
  }

  // -------------------------------------------------------------------------
  // Nạp
  // -------------------------------------------------------------------------

  /**
   * Nạp mô hình ở mức `quality`. Mô hình đã nạp ở mức này được giữ nguyên (không tải lại).
   * Không bao giờ ném lỗi do mô hình — lỗi được ghi vào `failedItems` và thay bằng fallback.
   */
  async loadAll(quality: FarmQuality, options: FarmAssetLoadOptions = {}): Promise<FarmAssetLoadResult> {
    const quality_ = FARM_QUALITIES.includes(quality) ? quality : 'low';
    const tracker = options.tracker ?? this.ownTracker;
    this.activeTracker.set(tracker);
    this._quality.set(quality_);
    this.lastRequest = { quality: quality_, options };

    const result: FarmAssetLoadResult = { quality: quality_, loaded: [], failed: [], skipped: [] };
    if (!this._manifest()) {
      const manifestDef: FarmLoadItemDef = { id: FARM_ASSET_MANIFEST_ITEM_ID, label: MANIFEST_LABEL, critical: true };
      if (options.tracker) tracker.add([manifestDef]);
      else tracker.begin([manifestDef], options.timeoutMs);
      return this.loadManifestThenAssets(quality_, options, tracker, result);
    }
    const pending = this.planAssets(quality_, options, result);
    const defs = this.itemDefs(pending, quality_);
    if (options.tracker) tracker.add(defs);
    else tracker.begin(defs, options.timeoutMs);
    await this.runKeys(pending.map((a) => a.key), quality_, tracker, result);
    return result;
  }

  /** Thử lại chỉ các hạng mục lỗi của lần nạp gần nhất (tracker riêng hoặc tracker ngoài). */
  async retryFailed(): Promise<FarmAssetLoadResult> {
    const tracker = this.activeTracker();
    const ids = tracker
      .failedItems()
      .filter((i) => isAssetLoadItemId(i.id))
      .map((i) => i.id);
    return this.runRetriedItems(tracker.retry(ids));
  }

  /**
   * Chạy lại các id đã được `tracker.retry()` đặt về `pending` (dùng khi container sở hữu
   * tracker). Id không thuộc service bị bỏ qua.
   */
  async runRetriedItems(ids: readonly string[]): Promise<FarmAssetLoadResult> {
    const quality = this._quality();
    const tracker = this.activeTracker();
    const result: FarmAssetLoadResult = { quality, loaded: [], failed: [], skipped: [] };
    const assetIds = ids.filter(isAssetLoadItemId);

    if (assetIds.includes(FARM_ASSET_MANIFEST_ITEM_ID)) {
      const request = this.lastRequest ?? { quality, options: {} };
      return this.loadManifestThenAssets(request.quality, request.options, tracker, result);
    }

    // Chỉ các hạng mục lỗi được gửi vào đây; file lỗi đã tự rời cache nên sẽ tải lại thật,
    // file đang tải dở (quá thời gian chờ) được dùng tiếp, mô hình đã nạp không bị đụng tới.
    const byQuality = new Map<FarmQuality, FarmAssetKey[]>();
    for (const parsed of assetIds.map(parseItemId)) {
      if (!parsed) continue;
      const list = byQuality.get(parsed.quality) ?? [];
      list.push(parsed.key);
      byQuality.set(parsed.quality, list);
    }
    await Promise.all(
      [...byQuality].map(([q, keys]) => {
        const retried = new Set<string>(keys);
        this._failures.update((list) => list.filter((f) => !(f.quality === q && retried.has(f.key))));
        return this.runKeys(keys, q, tracker, result);
      }),
    );
    return result;
  }

  // -------------------------------------------------------------------------
  // Tạo vật thể cho khung 3D
  // -------------------------------------------------------------------------

  /** Cảnh gốc đã nạp (dùng chung — không thêm trực tiếp vào scene). */
  getTemplate(key: string, quality: FarmQuality = this._quality()): Object3D | null {
    return this.templates.get(cacheKey(quality, key)) ?? null;
  }

  /** Mô hình của mã ở mức `quality` đã lỗi → hiển thị khối hộp fallback. */
  isFallback(key: string, quality: FarmQuality = this._quality()): boolean {
    return this._failures().some((f) => f.key === key && f.quality === quality);
  }

  /** Màu khối hộp fallback của mã (theo manifest; không rõ loại → màu mặc định). */
  fallbackColor(key: string): string {
    // Màu sai định dạng ở mục → dùng màu mặc định của manifest (cũng đã chuẩn hoá).
    const fallback = normalizeFallbackColor(this._manifest()?.default_fallback_color, DEFAULT_FALLBACK_COLOR);
    return normalizeFallbackColor(this.getEntry(key)?.fallback_color, fallback);
  }

  /**
   * Vật thể để đặt vào ô:
   * - mã không có trong manifest → `null` (không render);
   * - đã nạp → bản sao (dùng chung geometry/material);
   * - nạp lỗi → khối hộp màu theo loại (`userData.fallback = true`);
   * - chưa nạp xong → `null` (theo dõi `version` để dựng lại).
   */
  createInstance(key: string, quality: FarmQuality = this._quality()): Object3D | null {
    if (!this.hasAsset(key)) return null;
    const template = this.getTemplate(key, quality);
    if (template) {
      const clone = cloneSkinned(template);
      clone.userData['assetKey'] = key;
      return clone;
    }
    if (this.isFallback(key, quality)) {
      const box = createFallbackBox(this.fallbackColor(key));
      box.userData['assetKey'] = key;
      return box;
    }
    return null;
  }

  /** Giải phóng mô hình đã nạp của một mức (ví dụ sau khi đổi chất lượng). */
  releaseQuality(quality: FarmQuality): void {
    const prefix = `${quality}|`;
    for (const [k, obj] of [...this.templates]) {
      if (!k.startsWith(prefix)) continue;
      disposeObject3D(obj);
      this.templates.delete(k);
    }
    const manifest = this._manifest();
    if (manifest) {
      for (const { entry } of listManifestAssets(manifest)) {
        const file = assetFileFor(entry, quality);
        if (file) this.files.delete(file);
      }
    }
    this._failures.update((list) => list.filter((f) => f.quality !== quality));
    this._version.update((v) => v + 1);
  }

  dispose(): void {
    this.ownTracker.dispose();
    for (const obj of this.templates.values()) disposeObject3D(obj);
    this.templates.clear();
    this.files.clear();
    disposeFallbackBoxes();
    this.loader.dispose();
  }

  // -------------------------------------------------------------------------
  // Nội bộ
  // -------------------------------------------------------------------------

  /**
   * Nạp manifest như một hạng mục (quan trọng) của tracker; danh sách mô hình được thêm
   * vào tracker NGAY TRONG hạng mục manifest để lần tải không "xong" giữa chừng.
   */
  private async loadManifestThenAssets(
    quality: FarmQuality,
    options: FarmAssetLoadOptions,
    tracker: FarmLoadTracker,
    result: FarmAssetLoadResult,
  ): Promise<FarmAssetLoadResult> {
    const plan: { pending: FarmManifestAsset[] } = { pending: [] };
    const ok = await tracker.track(FARM_ASSET_MANIFEST_ITEM_ID, async () => {
      await this.loadManifest();
      plan.pending = this.planAssets(quality, options, result);
      tracker.add(this.itemDefs(plan.pending, quality));
    });
    if (!ok) return result;
    await this.runKeys(plan.pending.map((a) => a.key), quality, tracker, result);
    return result;
  }

  private itemDefs(assets: readonly FarmManifestAsset[], quality: FarmQuality): FarmLoadItemDef[] {
    return assets.map((a) => ({ id: assetLoadItemId(a.key, quality), label: `Mô hình ${a.entry.label}` }));
  }

  /**
   * Chọn mô hình cần nạp: lọc theo manifest (mã ngoài manifest → `skipped`), bỏ mô hình
   * đã có ở mức này (→ `loaded`), xoá dấu lỗi cũ của mô hình sắp tải lại.
   */
  private planAssets(
    quality: FarmQuality,
    options: FarmAssetLoadOptions,
    result: FarmAssetLoadResult,
  ): FarmManifestAsset[] {
    const manifest = this._manifest();
    if (!manifest) return [];

    let assets: FarmManifestAsset[];
    if (options.keys) {
      assets = [];
      const seen = new Set<string>();
      for (const key of options.keys) {
        if (seen.has(key)) continue;
        seen.add(key);
        const entry = resolveManifestAsset(manifest, key);
        if (entry) assets.push({ key: key as FarmAssetKey, entry });
        else result.skipped.push(key);
      }
    } else {
      assets = listManifestAssets(manifest, { initialOnly: options.initialOnly });
    }

    // Mô hình đã có ở mức này không cần tải lại.
    const pending = assets.filter((a) => !this.templates.has(cacheKey(quality, a.key)));
    result.loaded.push(...assets.filter((a) => !pending.includes(a)).map((a) => a.key));
    // Hạng mục từng lỗi ở mức này được tải lại trong lần nạp mới.
    const pendingKeys = new Set<string>(pending.map((a) => a.key));
    this._failures.update((list) =>
      list.filter((f) => !(f.quality === quality && pendingKeys.has(f.key))),
    );
    return pending;
  }

  private async runKeys(
    keys: readonly FarmAssetKey[],
    quality: FarmQuality,
    tracker: FarmLoadTracker,
    result: FarmAssetLoadResult,
  ): Promise<void> {
    await Promise.all(
      keys.map(async (key) => {
        const id = assetLoadItemId(key, quality);
        const entry = this.getEntry(key);
        const holder: { obj: Object3D | null } = { obj: null };
        const ok = await tracker.track(id, async () => {
          const file = entry ? assetFileFor(entry, quality) : null;
          if (!file) throw new Error('Thiếu file mô hình cho mức chất lượng này');
          holder.obj = await this.fetchFile(file, (f) => tracker.progress(id, f));
        });
        // Kết quả về muộn (quá thời gian chờ / lần tải mới) bị bỏ qua như tracker.
        if (ok && holder.obj) {
          this.templates.set(cacheKey(quality, key), holder.obj);
          result.loaded.push(key);
        } else {
          const item = tracker.items().find((i) => i.id === id);
          this.recordFailure({
            key,
            label: entry?.label ?? key,
            quality,
            error: item?.error ?? 'Không tải được mô hình',
          });
          result.failed.push(key);
        }
        this._version.update((v) => v + 1);
      }),
    );
  }

  /** Tải một file (dùng chung giữa các mã); mỗi mã nhận bản sao riêng của cảnh gốc. */
  private async fetchFile(url: string, onProgress: (fraction: number) => void): Promise<Object3D> {
    let inflight = this.files.get(url);
    if (!inflight) {
      // Đăng ký listener TRƯỚC khi gọi bộ nạp để không lỡ sự kiện tiến trình đầu tiên.
      const listeners = new Set<(fraction: number) => void>([onProgress]);
      const promise = this.loader
        .load(url, (f) => listeners.forEach((l) => l(f)))
        .then((scene) => {
          prepareTemplate(scene);
          return scene;
        });
      inflight = { promise, listeners };
      this.files.set(url, inflight);
      // Lỗi → bỏ khỏi cache để lần sau tải lại.
      promise.catch(() => {
        if (this.files.get(url) === inflight) this.files.delete(url);
      });
    }
    inflight.listeners.add(onProgress);
    try {
      const scene = await inflight.promise;
      // Mỗi mã giữ cây đối tượng riêng (geometry/material vẫn dùng chung). SkeletonUtils
      // gắn lại xương cho SkinnedMesh — `clone(true)` sẽ trỏ về xương của cảnh gốc.
      return cloneSkinned(scene);
    } catch (err: unknown) {
      throw new Error(errorText(err));
    } finally {
      inflight.listeners.delete(onProgress);
    }
  }

  private recordFailure(failure: FarmAssetFailure): void {
    this._failures.update((list) => [
      ...list.filter((f) => !(f.key === failure.key && f.quality === failure.quality)),
      failure,
    ]);
  }
}

/** Bật đổ bóng + chỉnh màu theo bảng màu nông trại (ấm, tươi kiểu pixel-farm) cho mô hình vừa nạp. */
function prepareTemplate(root: Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      stylizeMaterials(obj.material);
    }
  });
}
