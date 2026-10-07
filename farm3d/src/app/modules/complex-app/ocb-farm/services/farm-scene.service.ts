import {
  DestroyRef,
  Injectable,
  NgZone,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  BasicShadowMap,
  Color,
  DirectionalLight,
  Euler,
  Group,
  HemisphereLight,
  InstancedMesh,
  type Intersection,
  Material,
  Matrix4,
  Object3D,
  OrthographicCamera,
  PCFShadowMap,
  PCFSoftShadowMap,
  Quaternion,
  Raycaster,
  SRGBColorSpace,
  Scene,
  type ShadowMapType,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type {
  DecorRotation,
  FarmCellRef,
  FarmEntityKind,
  FarmFixtureAssetKey,
  FarmPlot,
  FarmQuality,
  FarmStateJson,
  FarmTerrain,
} from '../models/ocb-farm.model';
import { CinemaBounds, CinemaState, cinemaBoundsFromPlots, cinemaCameraAt, nextCinemaSegment } from '../scene/cinema-camera';
import { FreeRoamPetSpawn, initialFreeRoamPets } from '../scene/free-roam-pet';
import {
  FARM_ASSET_PROVIDER,
  FarmAssetProvider,
  FarmMeshPart,
  FarmRenderCategory,
  FarmRenderKey,
  FarmResolvedAsset,
  animalRenderKey,
  baseRenderKey,
  decorRenderKey,
  pickVariant,
  stableHash,
  plantRenderKey,
  renderCategoryOf,
} from '../scene/farm-asset-provider';
import {
  CELL_SIZE,
  MAX_ZOOM,
  FarmRotateDirection,
  GridBounds,
  QuarterTurn,
  azimuthFor,
  cameraOffset,
  cellToWorld,
  centerCellOf,
  clampZoom,
  gridBounds,
  lerpAngle,
  nextQuarterTurn,
  panDelta,
  parseCell,
  terrainSignature,
  treeSignature,
} from '../scene/farm-scene-math';
import type { FarmEnvironmentInput } from '../scene/farm-environment';
import { DecorLightSpot, FarmEnvironmentFx } from '../scene/farm-environment-fx';
import {
  FarmEffectKind,
  FarmEntityMarker,
  FarmEntityMarkerLayer,
} from '../scene/entity-markers';
import { FarmAnimalLayer, FarmAnimalSpawn } from '../scene/farm-animal-layer';
import { disposeObject3D } from '../scene/geometry/dispose';
import { buildFarmScatter } from '../scene/geometry/farm-scatter.geometry';
import { FALLBACK_CATEGORY_COLORS, fallbackBoxParts } from '../scene/geometry/fallback-box';
import {
  OCB_TREE_NAME,
  type OcbTreeBranchInfo,
  buildOcbTree,
  ocbTreeBranchAt,
} from '../scene/geometry/ocb-tree.geometry';
import {
  TERRAIN_LAND_NAME,
  TERRAIN_WATER_NAME,
  TerrainCellInfo,
  buildPlotGrid,
} from '../scene/geometry/plot-grid.geometry';
import { FarmRenderParams, FarmShadowMode, QualityService } from './quality.service';

/**
 * OCB Farm — khung render 3D (task 11.1).
 *
 * - `OrthographicCamera` góc isometric cố định (góc nâng ≈ 35.26°); kéo để di chuyển,
 *   cuộn/chụm để phóng to nhỏ, `rotate('cw' | 'ccw')` xoay 90° cho 4 nút xoay.
 * - Lưới ô đất + ao nước dựng từ `state.plots` (module `scene/geometry`), chỉ dựng lại khi
 *   địa hình đổi (mở vùng mới).
 * - Vật nuôi / cây / trang trí gom theo mã hiển thị (`FarmRenderKey`) → mỗi mảnh mesh của
 *   một mã là một `InstancedMesh` → số draw call tỉ lệ theo số loại, không theo số vật thể.
 * - Cây OCB cố định ở ô trung tâm, không nằm trong nhóm vật thể; `pickAt` trả về
 *   `{ kind: 'tree', immutable: true }` để UI không mở thao tác di chuyển/bán/xoá (BR-1).
 * - Mô hình lấy qua `FarmAssetProvider` (token `FARM_ASSET_PROVIDER`, do
 *   `AssetLoaderService` cung cấp). Chưa có provider → khối hộp fallback theo loại.
 * - Mức chất lượng đọc từ `QualityService.renderParams` và áp tại chỗ (pixel ratio, bóng
 *   đổ, bộ mô hình LOD) — không dựng lại cảnh. `antialias` chỉ áp khi `init`.
 *
 * - Ngày/đêm, thời tiết, chủ đề dịp lễ nằm ở `scene/farm-environment-fx.ts`; service chỉ
 *   chuyển tiếp qua `setEnvironment()` + cập nhật mỗi khung (task 11.4).
 *
 * Phạm vi: service theo component (`providers: [FarmSceneService]` ở host khung 3D) vì mỗi
 * khung 3D sở hữu một WebGL context riêng; `dispose()` tự gọi khi host bị huỷ.
 *
 * _Requirements: US-9, US-36, US-38, BR-1_
 */

// ---------------------------------------------------------------------------
// Kiểu công khai
// ---------------------------------------------------------------------------

export interface FarmSceneInitOptions {
  /** Gắn sẵn cử chỉ chuột/cảm ứng (kéo, cuộn, chụm, chạm). Mặc định `true`. */
  controls?: boolean;
  /** Giữ buffer để chụp ảnh nông trại (task 11.4). Mặc định `false`. */
  preserveDrawingBuffer?: boolean;
}

export interface FarmEntityPick {
  kind: 'entity';
  entityKind: FarmEntityKind;
  id: string;
  cell: FarmCellRef;
}

/** Cây OCB — chỉ xem, không có thao tác di chuyển/bán/xoá (BR-1). */
export interface FarmTreePick {
  kind: 'tree';
  cell: FarmCellRef;
  immutable: true;
  /** Có khi chạm đúng một nhánh lớn — UI hiển thị năm gắn bó thứ mấy (US-6). */
  branch?: OcbTreeBranchInfo;
}

export interface FarmCellPick {
  kind: 'cell';
  cell: FarmCellRef;
  plotId: number;
  terrain: FarmTerrain;
  unlocked: boolean;
}

/** Vật thể cố định (nhà kho…) — giống Cây OCB: chỉ xem/mở panel riêng, không di chuyển/bán/xoá. */
export interface FarmFixturePick {
  kind: 'fixture';
  fixtureKind: FarmFixtureAssetKey;
  cell: FarmCellRef;
  immutable: true;
}

export type FarmPickResult = FarmEntityPick | FarmTreePick | FarmCellPick | FarmFixturePick;

export interface FarmSceneTap {
  pick: FarmPickResult | null;
  clientX: number;
  clientY: number;
  /** Tăng dần mỗi lần chạm — để `effect` phân biệt hai lần chạm cùng một ô. */
  seq: number;
}

/** Tuỳ chọn hiển thị Cây OCB ngoài `state.tree` (US-6, US-7). */
export interface FarmTreeRenderOptions {
  /** Năm vào làm — mỗi nhánh biết năm dương lịch nó tượng trưng khi bấm vào. */
  joinYear: number | null;
  /** Ra hoa kết quả suốt ngày kỷ niệm. */
  blooming: boolean;
  /** Số quả khi ra hoa (`anniversary_fruit_count`). */
  fruitCount?: number;
}

/** Thao tác cho phép trên vật được chọn — Cây OCB luôn bị khoá (BR-1). */
export function canManipulate(pick: FarmPickResult | null): pick is FarmEntityPick {
  return pick?.kind === 'entity';
}

// ---------------------------------------------------------------------------
// Nội bộ
// ---------------------------------------------------------------------------

interface EntityRef {
  entityKind: FarmEntityKind;
  id: string;
  cell: FarmCellRef;
  x: number;
  z: number;
  rotationY: number;
}

interface InstanceBatch {
  key: FarmRenderKey;
  asset: FarmResolvedAsset;
  meshes: InstancedMesh[];
  capacity: number;
  refs: EntityRef[];
  /** Biên độ đung đưa trước gió (radian); 0 = đứng yên. */
  sway: number;
  /** Chỉ số mảnh (trong `asset.parts`) tự quay liên tục quanh trục Z — `null` = không có. */
  spinPartIndex: number | null;
}

/**
 * Mảnh tự quay liên tục (khác "sway" lắc toàn thân) — ví dụ cánh quạt cối xay gió.
 *
 * Mô hình nguồn (`Tower Windmill`) có 2 NODE glTF (tháp, cánh quạt) nhưng node tháp có
 * 7 primitive (vật liệu khác nhau) → GLTFLoader tách thành 7 `Mesh` con riêng, node cánh
 * quạt chỉ có 1 primitive → 1 `Mesh`. `meshPartsOf()` traverse theo đúng thứ tự này nên
 * cánh quạt là mảnh thứ **8** (index 7: 7 mảnh tháp trước, cánh quạt sau cùng), KHÔNG phải
 * index theo thứ tự node glTF gốc (0 = tháp, 1 = cánh quạt). Xác nhận bằng cách đếm
 * primitive của từng mesh trong file (`node.meshes[i].primitives.length`).
 * Trả `null` khi mã không có mảnh tự quay.
 */
function spinPartIndexFor(renderKey: FarmRenderKey): number | null {
  const key = baseRenderKey(renderKey);
  return key === 'decor:well_windmill' ? 7 : null;
}

/** Tốc độ quay cánh quạt (rad/giây). */
const WINDMILL_SPIN_SPEED = 1.4;
/**
 * Tâm trục cánh quạt trong không gian cục bộ GỐC của mesh "Blades" (toạ độ thô trong
 * file glTF, trước khi `meshPartsOf()` áp `matrixWorld`) — đo từ bounding box POSITION
 * của mesh (`x≈[-3.95, 3.98]`, `y≈[3.43, 11.38]`, `z≈[1.24, 1.77]`): mặt phẳng cánh quạt
 * song song XY (trục quay = Z cục bộ) nhưng KHÔNG đối xứng qua gốc (0,0,0) — tâm thật ở
 * trung điểm bounding box. Xoay bằng `makeRotationZ` không dịch tâm sẽ quay quanh gốc
 * (0,0,0), làm cánh quạt "văng" lệch khỏi trục thật — phải dịch về tâm trước khi xoay rồi
 * dịch ngược lại.
 */
const WINDMILL_BLADES_PIVOT = new Vector3(0.014, 7.404, 1.506);

/**
 * Biên độ đung đưa theo giai đoạn cây — cây lớn lắc nhẹ, mầm/hoa lắc nhiều hơn.
 * Chỉ áp cho vật thể instancing tĩnh (`decor:*`, `plant:*`) — KHÔNG áp cho `animal:*` (có
 * hoạt ảnh xương, render riêng qua `FarmAnimalLayer`, không bao giờ qua `instancedBatchFor`).
 * Export để `farm-scene.service.spec.ts` xác nhận trực tiếp (task 11.3/11.4).
 */
export function swayAmplitude(renderKey: FarmRenderKey): number {
  const key = baseRenderKey(renderKey);
  if (key.startsWith('decor:')) {
    // Cây cảnh / bụi / khóm hoa trang trí cũng đung đưa.
    const group = key.slice(6).split('_')[0];
    if (group === 'tree') return 0.025;
    if (group === 'bush') return 0.04;
    if (group === 'flowerbed' && !key.includes('petal')) return 0.06;
    return 0;
  }
  if (renderCategoryOf(renderKey) !== 'plant') return 0;
  const stage = key.split(':')[2];
  if (stage === 'seed') return 0;
  if (stage === 'sprout') return 0.09;
  const kind = key.split(':')[1];
  const tree = kind === 'banana' || kind === 'orange' || kind === 'mango';
  return tree ? 0.035 : 0.07;
}

/** Chưa có manifest/provider → màu theo nhóm vật thể (module `fallback-box`). */
const FALLBACK_COLORS: Readonly<Record<FarmRenderCategory, string>> = FALLBACK_CATEGORY_COLORS;

const SHADOW_TYPES: Record<FarmShadowMode, ShadowMapType> = {
  none: BasicShadowMap,
  pcf: PCFShadowMap,
  'pcf-soft': PCFSoftShadowMap,
};

/** Khoảng cách camera tới target — chỉ cần đủ xa để không cắt cảnh (camera trực giao). */
const CAMERA_DISTANCE = 60 * CELL_SIZE;
/** Biên lề quanh lưới khi tính khung nhìn và giới hạn kéo (đơn vị ô). */
const VIEW_MARGIN = 2;
/** Bước thời gian tối đa mỗi khung (giây) — tránh vật nuôi "nhảy" sau khi tab ẩn. */
const MAX_FRAME_DT = 0.1;
/** Cây OCB lớn gấp 3 kích thước gốc. */
const OCB_TREE_SCALE = 3;
/**
 * Ô cố định của Nhà kho — góc đối diện Cây OCB trong vùng khởi đầu (khối 5×5 `"0,0".."4,4"`),
 * luôn mở sẵn, không trùng ô trung tâm. Vật thể cố định giống Cây OCB: luôn có mặt, không
 * mua/bán/di chuyển/xoá, không nằm trong `state.decors`. Click vào mở panel kho (US-22).
 */
const WAREHOUSE_CELL: FarmCellRef = '4,4';
const WAREHOUSE_KEY: FarmFixtureAssetKey = 'warehouse';
export const WAREHOUSE_OBJECT_NAME = 'ocb-farm-warehouse';
/** Phóng tối đa tới khi khung nhìn còn ~1.2 ô theo chiều dọc (một con bò gần nửa màn hình). */
const MIN_VIEW_CELLS = 1.2;
/** Mức phóng tối đa tối thiểu (nông trại nhỏ). */
const DEFAULT_MAX_ZOOM = 8;
const ROTATE_DURATION_MS = 280;
/** Kéo quá ngưỡng này (px) thì không còn là chạm. */
const TAP_SLOP_PX = 6;
const TAP_MAX_MS = 500;
const WHEEL_ZOOM_SPEED = 0.0015;
const MIN_FRUSTUM = 6;

const DEG_TO_RAD = Math.PI / 180;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function decorRotationRad(rotation: DecorRotation): number {
  return rotation * DEG_TO_RAD;
}

@Injectable()
export class FarmSceneService {
  private zone = inject(NgZone);
  private quality = inject(QualityService);
  private destroyRef = inject(DestroyRef);

  // --- Signals ---------------------------------------------------------------
  private readonly _provider = signal<FarmAssetProvider | null>(
    inject(FARM_ASSET_PROVIDER, { optional: true }),
  );
  private readonly _ready = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _quarterTurn = signal<QuarterTurn>(0);
  private readonly _zoom = signal(1);
  private readonly _tap = signal<FarmSceneTap | null>(null);

  /** `true` khi renderer đã tạo xong và đang vẽ. */
  readonly ready = this._ready.asReadonly();
  /** Thông báo tiếng Việt khi không khởi tạo được WebGL. */
  readonly error = this._error.asReadonly();
  /** Góc xoay hiện tại 0..3 (×90°) — dùng để đánh dấu nút xoay đang chọn. */
  readonly quarterTurn = this._quarterTurn.asReadonly();
  readonly rotationDegrees = computed(() => this._quarterTurn() * 90);
  readonly zoom = this._zoom.asReadonly();
  private readonly _maxZoom = signal(DEFAULT_MAX_ZOOM);
  /** Mức phóng tối đa hiện tại (tuỳ kích thước nông trại). */
  readonly maxZoom = this._maxZoom.asReadonly();
  /** Lần chạm/nhấp gần nhất trên khung 3D (đã chọn ô / vật thể). */
  readonly lastTap = this._tap.asReadonly();

  // --- three.js -----------------------------------------------------------------
  private renderer: WebGLRenderer | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-5, 5, 5, -5, 0.1, 200 * CELL_SIZE);
  private readonly hemiLight = new HemisphereLight(0xffffff, 0x6d8f4e, 0.9);
  private readonly sunLight = new DirectionalLight(0xffffff, 1.6);
  private readonly entityRoot = new Group();
  /** Vật nuôi có xương + clip — mỗi con một mô hình riêng, đi lại trong ô. */
  private readonly animalLayer = new FarmAnimalLayer();
  private animalSpawns = new Map<string, FarmAnimalSpawn>();
  private lastFrameTime: number | null = null;
  private elapsed = 0;
  private reducedMotion = false;
  private readonly swayBase = new Matrix4();
  private readonly swayRot = new Matrix4();
  private readonly swayOut = new Matrix4();
  private readonly swayEuler = new Euler();
  private terrainGroup: Group | null = null;
  private treeGroup: Group | null = null;
  /** Nhà kho — vật thể cố định, dựng một lần khi có provider (giống Cây OCB, task "nhà kho"). */
  private warehouseGroup: Object3D | null = null;
  private readonly batches = new Map<FarmRenderKey, InstanceBatch>();
  /** Khối hộp fallback theo loại khi chưa có provider (geometry/material dùng chung toàn module). */
  private readonly fallbackAssets = new Map<FarmRenderCategory, FarmResolvedAsset>();
  private readonly raycaster = new Raycaster();
  /** Ngày/đêm, thời tiết, chủ đề dịp lễ — thuần hiển thị (task 11.4). */
  private readonly envFx = new FarmEnvironmentFx(this.scene, this.hemiLight, this.sunLight);
  /** Dấu hiệu trạng thái, vòng chọn, ô đích di chuyển, hiệu ứng thao tác (task 13.6). */
  private markerLayer = new FarmEntityMarkerLayer();
  private markerInput: {
    markers: readonly FarmEntityMarker[];
    selection: FarmCellRef | null;
    moveTargets: readonly FarmCellRef[];
  } = { markers: [], selection: null, moveTargets: [] };

  // --- Trạng thái cảnh ---------------------------------------------------------
  private state: FarmStateJson | null = null;
  private terrainSig = '';
  private treeSig = '';
  private treeOptions: FarmTreeRenderOptions = { joinYear: null, blooming: false };
  private centerCell: FarmCellRef | null = null;
  private bounds: GridBounds | null = null;
  private frustumSize = 10;
  private appliedParams: Readonly<FarmRenderParams> | null = null;

  /**
   * Free_Roam_Pet (chó/mèo) — field riêng, KHÔNG đến từ `state.animals`, khởi tạo một lần
   * trong `syncTerrain()` khi biết `plots`/`centerCell` lần đầu. `setState()` không bao giờ
   * đọc/ghi field này (AC 4.4).
   */
  private freeRoamSpawns: FreeRoamPetSpawn[] = [];
  /** Mã nhân viên — dùng làm seed tất định cho vị trí ban đầu của Free_Roam_Pet (AC 4.1). */
  private userId: number | null = null;

  // --- Camera ------------------------------------------------------------------
  private readonly target = new Vector3();
  private azimuth = azimuthFor(0);
  private rotateAnim: { from: number; to: number; start: number | null } | null = null;
  private cameraDirty = true;

  /**
   * Cinema_Mode — camera tự chuyển động (pan/zoom/rotate) theo kịch bản ngẫu nhiên liên tục,
   * không cần tương tác người dùng (AC 2.1, 2.2). Thuần client-side: không bao giờ gọi
   * `FarmStateStore.dispatch`, không tham chiếu `state`/`version`/`balance` (AC 2.7).
   */
  private cinema: CinemaState | null = null;
  private readonly _cinemaActive = signal(false);
  /** `true` khi Cinema_Mode đang chạy — dùng bởi UI để ẩn panel/HUD và bởi `farm-canvas` để phát `cinemaInterrupted`. */
  readonly cinemaActive = this._cinemaActive.asReadonly();
  /** Gọi khi nhân viên tương tác (chạm/kéo/cuộn) trong lúc Cinema_Mode đang chạy (AC 2.5). */
  private onCinemaInterrupted: (() => void) | null = null;

  // --- Cử chỉ ------------------------------------------------------------------
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private gesture: {
    startX: number;
    startY: number;
    startAt: number;
    moved: boolean;
    pinchDist: number | null;
    midX: number;
    midY: number;
  } | null = null;
  private tapSeq = 0;
  private resizeObserver: ResizeObserver | null = null;
  private readonly cleanups: Array<() => void> = [];

  constructor() {
    // Đổi mức chất lượng → áp tại chỗ (pixel ratio, bóng đổ); không dựng lại cảnh.
    effect(() => {
      const params = this.quality.renderParams();
      untracked(() => this.applyRenderParams(params));
    });

    // Provider đổi / có hạng mục tải xong / đổi bộ LOD → dựng lại nhóm instancing.
    effect(() => {
      const provider = this._provider();
      provider?.revision?.();
      void this.quality.renderParams().lod;
      untracked(() => this.rebuildEntities(true));
    });

    this.destroyRef.onDestroy(() => this.dispose());
  }

  // =============================================================================
  // Vòng đời
  // =============================================================================

  /**
   * Gắn khung 3D vào `canvas`. Trả `false` (và đặt `error`) khi trình duyệt không tạo
   * được WebGL context. Gọi lại sau `dispose()` được.
   */
  init(canvas: HTMLCanvasElement, options: FarmSceneInitOptions = {}): boolean {
    if (this.renderer) this.dispose();
    const params = this.quality.renderParams();

    try {
      this.renderer = new WebGLRenderer({
        canvas,
        antialias: params.antialias,
        alpha: false,
        powerPreference: params.tier === 'low' ? 'low-power' : 'high-performance',
        preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
      });
    } catch (err: unknown) {
      console.warn('[ocb-farm] Không khởi tạo được WebGL.', err);
      this.renderer = null;
      this._error.set('Trình duyệt không hỗ trợ đồ hoạ 3D (WebGL). Vui lòng thử trình duyệt khác hoặc bật tăng tốc phần cứng.');
      return false;
    }

    this.canvas = canvas;
    this._error.set(null);
    this.reducedMotion =
      typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.animalLayer.setReducedMotion(this.reducedMotion);
    this.lastFrameTime = null;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setClearColor(new Color('#8FD3F5'), 1);
    this.setupSceneGraph();
    this.appliedParams = null;
    this.applyRenderParams(params);
    this.envFx.reapply();

    if (this.state) this.syncAll(this.state);
    this.resetView();
    this.observeResize(canvas);
    if (options.controls ?? true) this.attachControls(canvas);

    this.zone.runOutsideAngular(() => {
      this.renderer?.setAnimationLoop((time) => this.frame(time));
    });
    this._ready.set(true);
    return true;
  }

  /** Huỷ renderer, listener và toàn bộ tài nguyên GPU do khung 3D tạo ra. */
  dispose(): void {
    this.renderer?.setAnimationLoop(null);
    this.cleanups.splice(0).forEach((fn) => fn());
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.pointers.clear();
    this.gesture = null;

    for (const batch of this.batches.values()) this.disposeBatch(batch);
    this.batches.clear();
    this.animalLayer.clear();
    this.animalSpawns.clear();
    this.freeRoamSpawns = [];
    // Geometry/material fallback dùng chung (module `fallback-box`) — không giải phóng ở đây.
    this.fallbackAssets.clear();
    if (this.terrainGroup) disposeObject3D(this.terrainGroup);
    if (this.treeGroup) disposeObject3D(this.treeGroup);
    if (this.warehouseGroup) disposeObject3D(this.warehouseGroup);
    this.terrainGroup = null;
    this.treeGroup = null;
    this.warehouseGroup = null;
    this.terrainSig = '';
    this.treeSig = '';
    this.sunLight.shadow.map?.dispose();
    this.envFx.dispose();
    this.markerLayer.dispose();
    this.markerLayer = new FarmEntityMarkerLayer();

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    }
    this.renderer = null;
    this.canvas = null;
    this.appliedParams = null;
    this.quality.resetFpsTracking();
    this._ready.set(false);
  }

  // =============================================================================
  // Dữ liệu
  // =============================================================================

  /** Đồng bộ cảnh theo state hiển thị của `FarmStateStore` (gọi trong `effect` của host). */
  setState(state: FarmStateJson | null): void {
    this.state = state;
    if (!this.renderer) return;
    if (state) {
      this.syncAll(state);
    } else {
      this.clearContent();
    }
  }

  /** Năm vào làm + trạng thái ra hoa kết quả của Cây OCB; chỉ dựng lại cây khi đổi. */
  setTreeOptions(options: FarmTreeRenderOptions): void {
    const prev = this.treeOptions;
    if (
      prev.joinYear === options.joinYear &&
      prev.blooming === options.blooming &&
      prev.fruitCount === options.fruitCount
    ) {
      return;
    }
    this.treeOptions = { ...options };
    if (this.renderer && this.state) this.syncTree(this.state);
  }

  /** Thay nguồn mô hình (khi không cung cấp qua token `FARM_ASSET_PROVIDER`). */
  setAssetProvider(provider: FarmAssetProvider | null): void {
    this._provider.set(provider);
  }

  /**
   * Áp tham số chất lượng tại chỗ. Tự gọi theo `QualityService.renderParams`; public để
   * host có thể ép áp lại (ví dụ sau khi khôi phục context).
   */
  applyRenderParams(params: Readonly<FarmRenderParams>): void {
    const renderer = this.renderer;
    if (!renderer) return;
    const prev = this.appliedParams;
    this.appliedParams = params;
    // Hạt mưa / dịp lễ và đèn trang trí theo giới hạn của mức chất lượng.
    this.envFx.setQuality(params);

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    renderer.setPixelRatio(Math.min(dpr, params.maxPixelRatio));

    const shadowsChanged =
      !prev ||
      prev.shadows.enabled !== params.shadows.enabled ||
      prev.shadows.mode !== params.shadows.mode ||
      prev.shadows.mapSize !== params.shadows.mapSize;

    if (shadowsChanged) {
      renderer.shadowMap.enabled = params.shadows.enabled;
      renderer.shadowMap.type = SHADOW_TYPES[params.shadows.mode];
      this.sunLight.castShadow = params.shadows.enabled;
      if (params.shadows.enabled) {
        this.sunLight.shadow.mapSize.set(params.shadows.mapSize, params.shadows.mapSize);
      }
      // Map cũ sai kích thước → giải phóng để renderer cấp lại.
      this.sunLight.shadow.map?.dispose();
      this.sunLight.shadow.map = null;
      // Shader phải biên dịch lại khi bật/tắt bóng.
      this.scene.traverse((obj) => {
        const material = (obj as Partial<{ material: Material | Material[] }>).material;
        if (!material) return;
        (Array.isArray(material) ? material : [material]).forEach((m) => (m.needsUpdate = true));
      });
    }
    this.handleResize();
  }

  // =============================================================================
  // Camera
  // =============================================================================

  /** Xoay camera 90° (4 nút xoay). Góc nâng isometric giữ nguyên. */
  rotate(direction: FarmRotateDirection): void {
    const next = nextQuarterTurn(this._quarterTurn(), direction);
    this._quarterTurn.set(next);
    this.rotateAnim = { from: this.azimuth, to: azimuthFor(next), start: null };
  }

  /** Đặt thẳng góc xoay (ví dụ nút "về hướng mặc định"). */
  setQuarterTurn(turn: QuarterTurn): void {
    this._quarterTurn.set(turn);
    this.rotateAnim = { from: this.azimuth, to: azimuthFor(turn), start: null };
  }

  /** Kéo cảnh theo độ dời màn hình (px CSS). */
  panBy(dxPx: number, dyPx: number): void {
    const height = this.canvas?.clientHeight || 1;
    const worldPerPixel = this.frustumSize / this._zoom() / height;
    const d = panDelta(dxPx, dyPx, this.azimuth, worldPerPixel);
    this.target.x += d.x;
    this.target.z += d.z;
    this.clampTarget();
    this.cameraDirty = true;
  }

  /** Nhân mức phóng với `factor` (> 1 là phóng to), có chặn trên/dưới. */
  zoomBy(factor: number): void {
    this.setZoom(this._zoom() * factor);
  }

  /**
   * Phóng quanh một điểm trên màn hình (con trỏ chuột / tâm hai ngón): điểm dưới con trỏ
   * đứng yên → cuộn chuột vào đúng con vật là phóng tới con vật đó.
   */
  zoomAt(factor: number, clientX: number, clientY: number): void {
    const canvas = this.canvas;
    const before = this._zoom();
    this.setZoom(before * factor);
    const after = this._zoom();
    if (!canvas || after === before) return;
    const rect = canvas.getBoundingClientRect();
    const height = rect.height || 1;
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    // Điểm ở độ lệch p so với tâm = target − panDelta(p, wpp) → giữ điểm đó cố định.
    const dWpp = this.frustumSize / height / after - this.frustumSize / height / before;
    const d = panDelta(dx, dy, this.azimuth, dWpp);
    this.target.x += d.x;
    this.target.z += d.z;
    this.clampTarget();
    this.cameraDirty = true;
  }

  setZoom(zoom: number): void {
    const next = Math.min(this._maxZoom(), clampZoom(zoom));
    if (next === this._zoom()) return;
    this._zoom.set(next);
    this.camera.zoom = next;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Mức phóng tối đa theo kích thước nông trại: phóng tới khi khung nhìn chỉ còn khoảng
   * {@link MIN_VIEW_CELLS} ô theo chiều dọc — đủ gần để xem rõ từng vật nuôi, dù nông trại
   * đã mở rộng to (khung nhìn mặc định phủ cả lưới nên nông trại càng to càng cần phóng nhiều).
   */
  private updateMaxZoom(): void {
    const fit = this.frustumSize / (MIN_VIEW_CELLS * CELL_SIZE);
    this._maxZoom.set(Math.min(MAX_ZOOM, Math.max(DEFAULT_MAX_ZOOM, fit)));
    if (this._zoom() > this._maxZoom()) this.setZoom(this._maxZoom());
  }

  /** Về giữa nông trại, mức phóng mặc định. Góc xoay giữ nguyên. */
  resetView(): void {
    const center = this.centerCell ? parseCell(this.centerCell) : null;
    if (center) {
      const { x, z } = cellToWorld(center);
      this.target.set(x, 0, z);
    } else if (this.bounds) {
      this.target.set(
        ((this.bounds.minCol + this.bounds.maxCol) / 2) * CELL_SIZE,
        0,
        ((this.bounds.minRow + this.bounds.maxRow) / 2) * CELL_SIZE,
      );
    } else {
      this.target.set(0, 0, 0);
    }
    this.setZoom(1);
    this.cameraDirty = true;
  }

  // =============================================================================
  // Cinema_Mode
  // =============================================================================

  /** Biên lưới (chỉ ô đã mở khóa) dùng để sinh target ngẫu nhiên cho Cinema_Mode (AC 2.2, 2.3). */
  private cinemaBoundsFromUnlockedPlots(): CinemaBounds | null {
    return cinemaBoundsFromPlots(this.state?.plots ?? []);
  }

  /**
   * Bật Cinema_Mode: camera tự chuyển động liên tục (pan/zoom/rotate) theo kịch bản ngẫu
   * nhiên, không cần tương tác người dùng (AC 2.1, 2.2). Không làm gì nếu chưa có lưới đất
   * (`this.bounds === null`) hoặc không có vùng đất đã mở (bounds rỗng).
   */
  enterCinemaMode(): void {
    if (!this.bounds) return;
    const bounds = this.cinemaBoundsFromUnlockedPlots();
    if (!bounds) return;
    const nowMs = performance.now();
    this.cinema = {
      segment: nextCinemaSegment(bounds, DEFAULT_MAX_ZOOM * 0.5, this._maxZoom(), null, nowMs),
      startedAtMs: nowMs,
    };
    this._cinemaActive.set(true);
  }

  /** Tắt Cinema_Mode: dừng Cinema_Camera_Controller, camera giữ nguyên vị trí hiện tại (AC 2.6). */
  exitCinemaMode(): void {
    this.cinema = null;
    this._cinemaActive.set(false);
  }

  /** Container đăng ký callback phát khi nhân viên tương tác trong lúc Cinema_Mode đang chạy (AC 2.5). */
  setCinemaInterruptedHandler(handler: (() => void) | null): void {
    this.onCinemaInterrupted = handler;
  }

  /** Mã nhân viên — seed tất định cho vị trí ban đầu của Free_Roam_Pet (AC 4.1). Gọi trước `setState()`. */
  setUserId(userId: number | null): void {
    this.userId = userId;
  }

  // =============================================================================
  // Chọn ô / vật thể
  // =============================================================================

  /** Raycast tại toạ độ màn hình (clientX/clientY). `null` khi chạm vào khoảng trống. */
  pickAt(clientX: number, clientY: number): FarmPickResult | null {
    const canvas = this.canvas;
    if (!canvas || !this.renderer) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const ndc = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.updateCamera();
    this.raycaster.setFromCamera(ndc, this.camera);

    const targets: Object3D[] = [this.entityRoot];
    if (this.treeGroup) targets.push(this.treeGroup);
    if (this.warehouseGroup) targets.push(this.warehouseGroup);
    if (this.terrainGroup) targets.push(this.terrainGroup);
    const hits = this.raycaster.intersectObjects(targets, true);

    // Vật nuôi có hoạt ảnh: hộp chạm vô hình đi theo từng con — ưu tiên nếu gần hơn.
    const animalHit = this.animalLayer.pick(this.raycaster);
    if (animalHit && (hits.length === 0 || animalHit.distance <= hits[0].distance + CELL_SIZE * 0.05)) {
      const spawn = this.animalSpawns.get(animalHit.id);
      if (spawn) return { kind: 'entity', entityKind: 'animal', id: spawn.id, cell: spawn.cell };
    }

    for (const hit of hits) {
      const obj = hit.object;
      const batchKey = obj.userData['batchKey'] as FarmRenderKey | undefined;
      if (batchKey && hit.instanceId !== undefined) {
        const ref = this.batches.get(batchKey)?.refs[hit.instanceId];
        if (ref) return { kind: 'entity', entityKind: ref.entityKind, id: ref.id, cell: ref.cell };
        continue;
      }
      if (this.isTreeObject(obj) && this.centerCell) {
        // Tán Cây OCB lớn (×3) phủ lên các ô lân cận: nếu tia còn trúng một vật thể phía
        // dưới tán thì ưu tiên vật thể đó để vẫn chọn được vật nuôi / cây quanh gốc.
        const below = this.entityBelow(hits, hit);
        if (below) return below;
        const branch = ocbTreeBranchAt(obj, hit.instanceId);
        return branch
          ? { kind: 'tree', cell: this.centerCell, immutable: true, branch }
          : { kind: 'tree', cell: this.centerCell, immutable: true };
      }
      if (this.isWarehouseObject(obj)) {
        return { kind: 'fixture', fixtureKind: WAREHOUSE_KEY, cell: WAREHOUSE_CELL, immutable: true };
      }
      if ((obj.name === TERRAIN_LAND_NAME || obj.name === TERRAIN_WATER_NAME) && hit.instanceId !== undefined) {
        const cells = obj.userData['cells'] as TerrainCellInfo[] | undefined;
        const info = cells?.[hit.instanceId];
        if (!info) continue;
        if (info.cell === this.centerCell) return { kind: 'tree', cell: info.cell, immutable: true };
        return {
          kind: 'cell',
          cell: info.cell,
          plotId: info.plotId,
          terrain: info.terrain,
          unlocked: info.unlocked,
        };
      }
    }
    return null;
  }

  /** Vật thể (instancing) trúng tia sau `after` — dùng khi tán Cây OCB che phía trên. */
  private entityBelow(hits: readonly Intersection[], after: Intersection): FarmEntityPick | null {
    for (const hit of hits.slice(hits.indexOf(after) + 1)) {
      const batchKey = hit.object.userData['batchKey'] as FarmRenderKey | undefined;
      if (!batchKey || hit.instanceId === undefined) continue;
      const ref = this.batches.get(batchKey)?.refs[hit.instanceId];
      if (ref) return { kind: 'entity', entityKind: ref.entityKind, id: ref.id, cell: ref.cell };
    }
    return null;
  }

  /** Ô trung tâm của Cây OCB (không nhận vật thể khác, không có thao tác). */
  treeCell(): FarmCellRef | null {
    return this.centerCell;
  }

  /** Số draw call của khung hình gần nhất (kiểm tra ngân sách hiệu năng). */
  drawCalls(): number {
    return this.renderer?.info.render.calls ?? 0;
  }

  /** Vẽ ngay một khung hình (dùng trước khi chụp ảnh `canvas.toBlob`). */
  renderNow(): void {
    if (!this.renderer) return;
    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Ngày/đêm, thời tiết, chủ đề dịp lễ (task 11.4). Thuần hiển thị — `phase` đã áp khoá
   * cảnh ở phía gọi; không đụng tới state trò chơi.
   */
  setEnvironment(input: FarmEnvironmentInput): void {
    this.envFx.setInput(input);
  }

  /**
   * Dấu hiệu trạng thái trên vật thể (sẵn sàng thu hoạch / thiếu nước + tạm dừng / buồn),
   * vòng chọn và ô đích hợp lệ khi di chuyển (task 13.6). Thuần hiển thị, không raycast.
   */
  setEntityMarkers(markers: readonly FarmEntityMarker[]): void {
    this.markerInput = { ...this.markerInput, markers };
    this.markerLayer.setMarkers(markers);
  }

  setSelection(cell: FarmCellRef | null): void {
    const changed = cell !== this.markerInput.selection;
    this.markerInput = { ...this.markerInput, selection: cell };
    this.markerLayer.setSelection(cell);
    // Được chọn → vật nuôi bật nảy nhẹ "chào" người chơi.
    if (cell && changed && this.renderer) this.animalLayer.reactAt(cell, 'poke');
  }

  setMoveTargets(cells: readonly FarmCellRef[]): void {
    this.markerInput = { ...this.markerInput, moveTargets: cells };
    this.markerLayer.setMoveTargets(cells);
  }

  /** Hiệu ứng ngắn sau thao tác thành công (cho ăn / tưới / thu hoạch). */
  playEffect(cell: FarmCellRef, kind: FarmEffectKind): void {
    if (!this.renderer) return;
    this.markerLayer.playEffect(cell, kind);
    // Vật nuôi ở ô đó nhảy cẫng / xoay vòng vui mừng (cho ăn, thu hoạch).
    if (kind !== 'water') this.animalLayer.reactAt(cell, kind === 'harvest' ? 'harvest' : 'happy');
  }

  /**
   * Chụp khung hình hiện tại vào một canvas 2D ngoài luồng (US-41). Vẽ và sao chép trong
   * cùng một lượt nên không cần `preserveDrawingBuffer`. Góc nhìn giữ nguyên.
   * `null` khi khung 3D chưa sẵn sàng.
   */
  captureFrame(): HTMLCanvasElement | null {
    const renderer = this.renderer;
    if (!renderer || typeof document === 'undefined') return null;
    this.renderNow();
    const source = renderer.domElement;
    if (source.width === 0 || source.height === 0) return null;
    const out = document.createElement('canvas');
    out.width = source.width;
    out.height = source.height;
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0);
    return out;
  }

  // =============================================================================
  // Dựng cảnh
  // =============================================================================

  private setupSceneGraph(): void {
    if (!this.scene.children.includes(this.hemiLight)) {
      this.scene.add(this.hemiLight, this.sunLight, this.sunLight.target, this.entityRoot, this.animalLayer.root);
      this.entityRoot.name = 'farm-entities';
      this.sunLight.shadow.bias = -0.0005;
      this.sunLight.shadow.normalBias = 0.02 * CELL_SIZE;
    }
    // Lớp dấu hiệu được tạo lại sau mỗi `dispose()` → gắn lại và áp lại đầu vào gần nhất.
    if (!this.scene.children.includes(this.markerLayer.root)) {
      this.scene.add(this.markerLayer.root);
      const { markers, selection, moveTargets } = this.markerInput;
      this.markerLayer.setMarkers(markers);
      this.markerLayer.setSelection(selection);
      this.markerLayer.setMoveTargets(moveTargets);
    }
  }

  private syncAll(state: FarmStateJson): void {
    this.syncTerrain(state.plots);
    this.syncTree(state);
    this.syncWarehouse();
    this.rebuildEntities(false);
  }

  private clearContent(): void {
    this.envFx.setDecorLights([]);
    for (const batch of this.batches.values()) this.disposeBatch(batch);
    this.batches.clear();
    this.animalLayer.clear();
    this.animalSpawns.clear();
    this.freeRoamSpawns = [];
    if (this.terrainGroup) disposeObject3D(this.terrainGroup);
    if (this.treeGroup) disposeObject3D(this.treeGroup);
    if (this.warehouseGroup) disposeObject3D(this.warehouseGroup);
    this.terrainGroup = null;
    this.treeGroup = null;
    this.warehouseGroup = null;
    this.terrainSig = '';
    this.treeSig = '';
  }

  /**
   * Dựng Nhà kho một lần tại {@link WAREHOUSE_CELL} khi provider đã có mô hình (hoặc khối
   * hộp fallback) — object cố định, không đổi theo state nên không cần chữ ký như terrain/tree.
   * Gọi lại an toàn (bỏ qua nếu đã dựng); provider đổi mẫu (tải xong / đổi mức chất lượng)
   * được effect ở constructor kích hoạt dựng lại qua `rebuildEntities` → nối thêm ở đó.
   */
  private syncWarehouse(): void {
    if (this.warehouseGroup) return;
    const provider = this._provider();
    // `fixtureTemplate` trả bản sao đã chuẩn hoá riêng cho lần gọi này — thêm thẳng vào scene.
    const obj = provider?.fixtureTemplate?.(WAREHOUSE_KEY, this.quality.renderParams().lod);
    if (!obj) return;
    const center = parseCell(WAREHOUSE_CELL);
    if (!center) return;
    obj.name = WAREHOUSE_OBJECT_NAME;
    const { x, z } = cellToWorld(center);
    obj.position.set(x, 0, z);
    obj.updateMatrixWorld(true);
    obj.traverse((o) => (o.matrixAutoUpdate = false));
    this.warehouseGroup = obj;
    this.scene.add(obj);
  }

  private syncTerrain(plots: readonly FarmPlot[]): void {
    const sig = terrainSignature(plots);
    if (sig === this.terrainSig && this.terrainGroup) return;
    this.terrainSig = sig;
    const firstBuild = this.bounds === null;

    if (this.terrainGroup) disposeObject3D(this.terrainGroup);
    this.centerCell = centerCellOf(plots);
    this.bounds = gridBounds(plots);
    this.terrainGroup = buildPlotGrid(plots, { centerCell: this.centerCell });
    // Cỏ, sỏi, hoa dại, lá súng rải ngẫu nhiên (tất định theo ô) cho nông trại sinh động.
    this.terrainGroup.add(buildFarmScatter(plots, this.centerCell));
    this.scene.add(this.terrainGroup);

    // Free_Roam_Pet (chó/mèo) — khởi tạo MỘT LẦN khi biết `plots`/`centerCell` lần đầu
    // (AC 4.1). Field riêng, không đến từ `state.animals`, không bị `setState()` ghi đè.
    if (firstBuild) {
      this.freeRoamSpawns = initialFreeRoamPets(plots, this.centerCell, this.userId ?? 0);
    }

    this.fitFrustumAndShadow();
    if (firstBuild) this.resetView();
    else this.clampTarget();
    this.cameraDirty = true;
  }

  private syncTree(state: FarmStateJson): void {
    const opts = this.treeOptions;
    const sig = `${treeSignature(state)}|${opts.joinYear ?? ''}|${opts.blooming ? 1 : 0}|${opts.fruitCount ?? ''}`;
    if (sig === this.treeSig && this.treeGroup) return;
    this.treeSig = sig;
    if (this.treeGroup) disposeObject3D(this.treeGroup);
    this.treeGroup = null;

    const center = this.centerCell ? parseCell(this.centerCell) : null;
    if (!center) return;
    const tree = buildOcbTree({
      milestone: state.tree.milestone,
      branches: state.tree.branches,
      joinYear: opts.joinYear,
      blooming: opts.blooming,
      ...(opts.fruitCount !== undefined ? { fruitCount: opts.fruitCount } : {}),
    });
    const { x, z } = cellToWorld(center);
    tree.position.set(x, 0, z);
    // Hình học cây dựng theo đơn vị ô → phóng theo cạnh ô, ×3 để Cây OCB là điểm nhấn.
    tree.scale.setScalar(CELL_SIZE * OCB_TREE_SCALE);
    // Cây OCB không bao giờ đổi vị trí → khoá ma trận cho nhẹ.
    tree.updateMatrixWorld(true);
    tree.traverse((obj) => (obj.matrixAutoUpdate = false));
    this.treeGroup = tree;
    this.scene.add(tree);
  }

  /** Gom vật thể theo mã hiển thị và cập nhật `InstancedMesh`. `force` = resolve lại mô hình. */
  private rebuildEntities(force: boolean): void {
    if (!this.renderer) return;
    // Nhà kho chưa dựng được lúc `syncAll` (model chưa tải xong) → thử lại mỗi khi provider
    // báo có hạng mục mới (tải xong / đổi mức chất lượng) — tự bỏ qua nếu đã có.
    this.syncWarehouse();
    const groups = this.groupEntities(this.state);

    for (const [key, batch] of this.batches) {
      if (force || !groups.has(key)) {
        this.disposeBatch(batch);
        this.batches.delete(key);
      }
    }

    this.envFx.setDecorLights(this.decorLightSpots(this.state));

    // Vật nuôi có mô hình xương + clip → lớp hoạt ảnh; còn lại (đang tải / lỗi) → instancing.
    // `roamContext.plots` cho enterMove() gọi clampRoamTarget() khi chọn đích roam mới cho
    // Anchored_Animal (6 loài hiện có). Free_Roam_Pet (chó/mèo) được nối thêm song song với
    // spawn từ `state.animals` — KHÔNG qua `this.animalSpawns` (field đó chỉ map id server →
    // Anchor_Cell cho `pickAt`/menu tương tác, Free_Roam_Pet không có id server, AC 4.4).
    const animated = this.animalLayer.sync(
      [...this.animalSpawns.values(), ...this.freeRoamPetAnimalSpawns()],
      (key) => this.animatedTemplate(key as FarmRenderKey),
      { plots: this.state?.plots ?? [] },
    );
    for (const [key, refs] of [...groups]) {
      if (renderCategoryOf(key) !== 'animal') continue;
      const rest = refs.filter((r) => !animated.has(r.id));
      if (rest.length === refs.length) continue;
      if (rest.length > 0) groups.set(key, rest);
      else groups.delete(key);
    }
    for (const [key, batch] of this.batches) {
      if (!groups.has(key)) {
        this.disposeBatch(batch);
        this.batches.delete(key);
      }
    }

    for (const [key, refs] of groups) {
      let batch = this.batches.get(key);
      if (!batch || batch.capacity < refs.length) {
        if (batch) this.disposeBatch(batch);
        const asset = this.resolveAsset(key);
        if (!asset) {
          // Mã không có trong manifest → không render.
          this.batches.delete(key);
          continue;
        }
        batch = this.createBatch(key, asset, refs.length);
        this.batches.set(key, batch);
      }
      this.writeInstances(batch, refs);
    }
  }

  /**
   * Chuyển `freeRoamSpawns` (chó/mèo) thành `FarmAnimalSpawn` để nối vào danh sách truyền
   * cho `FarmAnimalLayer.sync()` — song song với spawn từ `state.animals`. `cell` ở đây chỉ
   * là vị trí hiển thị ban đầu (không phải Anchor_Cell/occupancy, AC 4.4); `FarmAnimalLayer`
   * tự cập nhật `homeX/homeZ` khi actor tới đích vì `species` thuộc `FARM_FREE_ROAM_SPECIES`.
   */
  private freeRoamPetAnimalSpawns(): FarmAnimalSpawn[] {
    const spawns: FarmAnimalSpawn[] = [];
    for (const pet of this.freeRoamSpawns) {
      const coord = parseCell(pet.cell);
      if (!coord) continue;
      const { x, z } = cellToWorld(coord);
      // `FarmRenderKey` chỉ khai báo `animal:${FarmSpecies}` ở mức kiểu — `dog`/`cat` dùng
      // cùng quy ước mã (`animal:<loài>`) nhưng là nhóm kiểu riêng (`FarmFreeRoamSpecies`,
      // chỉ dùng ở client, không thuộc `state.animals`), nên ép kiểu tại điểm nối hẹp này.
      const key = `animal:${pet.species}` as FarmRenderKey;
      spawns.push({ id: pet.id, cell: pet.cell, species: pet.species, key, x, z });
    }
    return spawns;
  }

  private groupEntities(state: FarmStateJson | null): Map<FarmRenderKey, EntityRef[]> {
    const groups = new Map<FarmRenderKey, EntityRef[]>();
    this.animalSpawns = new Map();
    if (!state) return groups;
    for (const a of state.animals) {
      if (a.cell === this.centerCell) continue;
      const coord = parseCell(a.cell);
      if (!coord) continue;
      const { x, z } = cellToWorld(coord);
      const key = this.variantKey(animalRenderKey(a.species), a.id);
      this.animalSpawns.set(a.id, { id: a.id, cell: a.cell, species: a.species, key, x, z, hungry: a.fullness <= 0 });
    }
    // Hướng ngẫu nhiên (tất định theo id) cho cây — vườn trông tự nhiên hơn.
    const yaw = (id: string): number => ((stableHash(id) % 360) * Math.PI) / 180;
    const push = (key: FarmRenderKey, entityKind: FarmEntityKind, id: string, cell: FarmCellRef, rotationY: number): void => {
      // Ô trung tâm dành riêng cho Cây OCB (BR-1) — không vẽ vật khác đè lên.
      if (cell === this.centerCell) return;
      const coord = parseCell(cell);
      if (!coord) return;
      const { x, z } = cellToWorld(coord);
      const list = groups.get(key);
      const ref: EntityRef = { entityKind, id, cell, x, z, rotationY };
      if (list) list.push(ref);
      else groups.set(key, [ref]);
    };
    for (const a of state.animals) push((this.animalSpawns.get(a.id)?.key as FarmRenderKey | undefined) ?? animalRenderKey(a.species), 'animal', a.id, a.cell, yaw(a.id));
    for (const p of state.plants) push(this.variantKey(plantRenderKey(p.kind, p.stage), p.id), 'plant', p.id, p.cell, yaw(p.id));
    for (const d of state.decors) push(decorRenderKey(d.kind), 'decor', d.id, d.cell, decorRotationRad(d.rotation));
    return groups;
  }

  /** Vị trí vật trang trí là nguồn sáng — bật `PointLight` vào buổi đêm (US-30). */
  private decorLightSpots(state: FarmStateJson | null): DecorLightSpot[] {
    if (!state) return [];
    const spots: DecorLightSpot[] = [];
    for (const d of state.decors) {
      if (!d.is_light || d.cell === this.centerCell) continue;
      const coord = parseCell(d.cell);
      if (coord) spots.push(cellToWorld(coord));
    }
    return spots;
  }

  /**
   * Biến thể ngẫu nhiên (tất định theo id) của mã gốc. Biến thể chưa tải xong → tạm dùng
   * bản gốc (khung 3D dựng lại khi `revision` của provider đổi).
   */
  private variantKey(base: FarmRenderKey, id: string): FarmRenderKey {
    const provider = this._provider();
    const count = provider?.variantCount?.(base) ?? 0;
    if (count === 0) return base;
    const key = pickVariant(base, id, count);
    if (key === base) return key;
    const lod: FarmQuality = this.appliedParams?.lod ?? this.quality.renderParams().lod;
    return provider?.isLoaded && !provider.isLoaded(key, lod) ? base : key;
  }

  private animatedTemplate(key: FarmRenderKey): Object3D | null {
    const provider = this._provider();
    if (!provider?.animatedTemplate) return null;
    const lod: FarmQuality = this.appliedParams?.lod ?? this.quality.renderParams().lod;
    return provider.animatedTemplate(key, lod);
  }

  private resolveAsset(key: FarmRenderKey): FarmResolvedAsset | null {
    const provider = this._provider();
    const lod: FarmQuality = this.appliedParams?.lod ?? this.quality.renderParams().lod;
    if (provider) return provider.resolve(key, lod);

    // Chưa có provider: khối hộp fallback theo loại, dùng chung cho cả loại.
    const category = renderCategoryOf(key);
    let asset = this.fallbackAssets.get(category);
    if (!asset) {
      const box = fallbackBoxParts(FALLBACK_COLORS[category]);
      asset = {
        parts: [{ geometry: box.geometry, material: box.material, matrix: box.matrix, castShadow: true }],
        fallback: true,
      };
      this.fallbackAssets.set(category, asset);
    }
    return asset;
  }

  private createBatch(key: FarmRenderKey, asset: FarmResolvedAsset, needed: number): InstanceBatch {
    // Dư chỗ theo luỹ thừa 2 để thêm vật thể không phải tạo lại buffer mỗi lần.
    const capacity = Math.max(4, 2 ** Math.ceil(Math.log2(Math.max(1, needed))));
    const meshes = asset.parts.map((part: FarmMeshPart) => {
      const mesh = new InstancedMesh(part.geometry, part.material, capacity);
      mesh.name = `farm-batch:${key}`;
      mesh.userData['batchKey'] = key;
      mesh.castShadow = part.castShadow ?? true;
      mesh.receiveShadow = part.receiveShadow ?? false;
      mesh.count = 0;
      this.entityRoot.add(mesh);
      return mesh;
    });
    return { key, asset, meshes, capacity, refs: [], sway: swayAmplitude(key), spinPartIndex: spinPartIndexFor(key) };
  }

  /**
   * Cây đung đưa trước gió: xoay nhẹ quanh gốc (đáy mô hình) theo hai trục, lệch pha theo
   * vị trí để cả vườn không lắc đồng loạt. Vật thể có `spinPartIndex` (ví dụ cánh quạt cối
   * xay gió) tự quay liên tục quanh trục Z của chính mảnh đó, độc lập với lắc toàn thân —
   * áp dụng SAU ma trận "sway" của thân để cánh quạt quay tại đúng vị trí của nó trên tháp.
   * Chỉ ghi lại ma trận instance — không tạo buffer.
   */
  private animateBatches(elapsed: number): void {
    const base = this.swayBase;
    const rot = this.swayRot;
    const out = this.swayOut;
    const spin = new Matrix4();
    const spinRotZ = new Matrix4();
    const spinLocal = new Matrix4();
    const toPivot = new Matrix4().makeTranslation(-WINDMILL_BLADES_PIVOT.x, -WINDMILL_BLADES_PIVOT.y, -WINDMILL_BLADES_PIVOT.z);
    const fromPivot = new Matrix4().makeTranslation(WINDMILL_BLADES_PIVOT.x, WINDMILL_BLADES_PIVOT.y, WINDMILL_BLADES_PIVOT.z);
    const pos = new Vector3();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const one = new Vector3(1, 1, 1);
    for (const batch of this.batches.values()) {
      const animated = batch.sway !== 0 || batch.spinPartIndex !== null;
      if (!animated || batch.refs.length === 0 || batch.asset.fallback) continue;
      batch.refs.forEach((ref, i) => {
        const phase = (ref.x * 0.37 + ref.z * 0.53) % (Math.PI * 2);
        let ax = 0;
        let az = 0;
        if (batch.sway !== 0) {
          // Gió thổi theo cơn: biên độ dao động chậm, nhịp lắc nhanh hơn.
          const gust = 0.65 + 0.35 * Math.sin(elapsed * 0.35 + phase * 0.5);
          ax = Math.sin(elapsed * 1.6 + phase) * batch.sway * gust;
          az = Math.cos(elapsed * 1.25 + phase * 1.3) * batch.sway * 0.6 * gust;
        }
        pos.set(ref.x, 0, ref.z);
        q.setFromAxisAngle(up, ref.rotationY);
        base.compose(pos, q, one);
        rot.makeRotationFromEuler(this.swayEuler.set(ax, 0, az));
        base.multiply(rot);
        batch.meshes.forEach((mesh, partIndex) => {
          const local = batch.asset.parts[partIndex]?.matrix ?? null;
          let effectiveLocal = local;
          if (partIndex === batch.spinPartIndex) {
            // Cánh quạt: quay liên tục quanh trục Z cục bộ TẠI ĐÚNG TÂM TRỤC (không phải
            // gốc toạ độ (0,0,0) của mô hình — xem `WINDMILL_BLADES_PIVOT`), lệch pha theo
            // vị trí để nhiều cối xay gió trên nông trại không quay đồng bộ tuyệt đối.
            // spin = fromPivot × rotateZ × toPivot (dịch về tâm → xoay → dịch ngược lại),
            // rồi nhân TRƯỚC ma trận cục bộ của mảnh (`local × spin`) để áp đúng trong
            // không gian cục bộ gốc của mesh, trước khi `local` mang nó ra vị trí/hướng
            // thật trên tháp.
            spinRotZ.makeRotationZ(elapsed * WINDMILL_SPIN_SPEED + phase);
            spin.multiplyMatrices(fromPivot, spinRotZ).multiply(toPivot);
            effectiveLocal = local ? spinLocal.multiplyMatrices(local, spin) : spin;
          }
          mesh.setMatrixAt(i, effectiveLocal ? out.multiplyMatrices(base, effectiveLocal) : base);
        });
      });
      for (const mesh of batch.meshes) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private writeInstances(batch: InstanceBatch, refs: EntityRef[]): void {
    const base = new Matrix4();
    const out = new Matrix4();
    const pos = new Vector3();
    const rot = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const one = new Vector3(1, 1, 1);

    batch.meshes.forEach((mesh, partIndex) => {
      const local = batch.asset.parts[partIndex]?.matrix;
      refs.forEach((ref, i) => {
        pos.set(ref.x, 0, ref.z);
        rot.setFromAxisAngle(up, ref.rotationY);
        base.compose(pos, rot, one);
        mesh.setMatrixAt(i, local ? out.multiplyMatrices(base, local) : base);
      });
      mesh.count = refs.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.computeBoundingBox();
    });
    batch.refs = refs;
  }

  private disposeBatch(batch: InstanceBatch): void {
    for (const mesh of batch.meshes) {
      mesh.removeFromParent();
      // Chỉ giải phóng buffer instance; geometry/material thuộc provider hoặc cache fallback.
      mesh.dispose();
    }
    batch.meshes = [];
  }

  private isTreeObject(obj: Object3D): boolean {
    let cur: Object3D | null = obj;
    while (cur) {
      if (cur.name === OCB_TREE_NAME) return true;
      cur = cur.parent;
    }
    return false;
  }

  private isWarehouseObject(obj: Object3D): boolean {
    let cur: Object3D | null = obj;
    while (cur) {
      if (cur.name === WAREHOUSE_OBJECT_NAME) return true;
      cur = cur.parent;
    }
    return false;
  }

  // =============================================================================
  // Khung hình, kích thước, camera
  // =============================================================================

  private frame(time: number): void {
    const renderer = this.renderer;
    if (!renderer) return;

    if (this.cinema) {
      // Cinema_Mode: camera hoàn toàn do Cinema_Camera_Controller điều khiển — bỏ qua
      // `rotateAnim`/target thủ công, không đọc/ghi `state`/`version`/`balance` (AC 2.7).
      this.stepCinema(time);
    } else if (this.rotateAnim) {
      const anim = this.rotateAnim;
      if (anim.start === null) anim.start = time;
      const t = Math.min(1, (time - anim.start) / ROTATE_DURATION_MS);
      this.azimuth = lerpAngle(anim.from, anim.to, easeOutCubic(t));
      if (t >= 1) {
        this.azimuth = anim.to;
        this.rotateAnim = null;
      }
      this.cameraDirty = true;
    }

    const dt = this.lastFrameTime === null ? 0 : Math.min(MAX_FRAME_DT, Math.max(0, (time - this.lastFrameTime) / 1000));
    this.lastFrameTime = time;
    this.elapsed += dt;
    // Vật nuôi/cây trồng tiếp tục đồng bộ tick theo đúng chu kỳ hiện có, không bị
    // Cinema_Camera_Controller làm chậm hoặc chặn (AC 2.8).
    this.animalLayer.update(dt, this.elapsed);
    if (!this.reducedMotion) this.animateBatches(this.elapsed);

    this.envFx.update(time);
    this.markerLayer.update(time);
    this.updateCamera();
    renderer.render(this.scene, this.camera);
    this.quality.recordFrame(time);
  }

  /**
   * Áp vị trí/zoom/azimuth của Cinema_Camera_Controller tại `time` — đọc `this.bounds`
   * (đã có từ terrain) và ghi `this.target`/`this.camera` thuần hiển thị, không bao giờ
   * gọi `FarmStateStore.dispatch` hay tham chiếu `state`/`version`/`balance` (AC 2.7).
   * Khi segment hiện tại kết thúc (`finished`), sinh segment kế tiếp không lặp y nguyên
   * (AC 2.3), nội suy mượt giữa các điểm nhìn (AC 2.4).
   */
  private stepCinema(time: number): void {
    const cinema = this.cinema;
    if (!cinema) return;
    const result = cinemaCameraAt(cinema, time);
    this.target.x = result.x;
    this.target.z = result.z;
    // Zoom cinema tự tính trong biên hợp lệ — ghi trực tiếp vào field nội bộ, bỏ qua
    // `setZoom()` (chặn trên theo `_maxZoom`) vì giá trị đã nằm trong biên khi sinh segment.
    this._zoom.set(result.zoom);
    this.camera.zoom = result.zoom;
    this.camera.updateProjectionMatrix();
    // Azimuth liên tục (không snap theo 4 góc 90°) — ghi trực tiếp, không qua `rotateAnim`.
    this.azimuth = result.azimuth;
    this.cameraDirty = true;

    if (result.finished) {
      const bounds = this.cinemaBoundsFromUnlockedPlots();
      if (!bounds) {
        this.exitCinemaMode();
        return;
      }
      this.cinema = {
        segment: nextCinemaSegment(bounds, DEFAULT_MAX_ZOOM * 0.5, this._maxZoom(), cinema.segment, time),
        startedAtMs: time,
      };
    }
  }

  private updateCamera(): void {
    if (!this.cameraDirty) return;
    this.cameraDirty = false;
    const o = cameraOffset(this.azimuth, CAMERA_DISTANCE);
    this.camera.position.set(this.target.x + o.x, this.target.y + o.y, this.target.z + o.z);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  /** Khung nhìn vừa với lưới; bóng đổ phủ trọn lưới. */
  private fitFrustumAndShadow(): void {
    const b = this.bounds;
    const rows = b ? b.maxRow - b.minRow + 1 : 8;
    const cols = b ? b.maxCol - b.minCol + 1 : 8;
    // Đường chéo lưới chiếu isometric ≈ (rows + cols) / √2 theo chiều ngang màn hình.
    // Tính theo đơn vị ô rồi đổi sang đơn vị thế giới.
    const span = (rows + cols) / Math.SQRT2 + VIEW_MARGIN;
    this.frustumSize = Math.max(MIN_FRUSTUM, span * 0.75) * CELL_SIZE;
    this.updateMaxZoom();

    const cx = (b ? (b.minCol + b.maxCol) / 2 : 0) * CELL_SIZE;
    const cz = (b ? (b.minRow + b.maxRow) / 2 : 0) * CELL_SIZE;
    const radius = (Math.max(rows, cols) / 2 + VIEW_MARGIN) * CELL_SIZE;
    // Hướng mặt trời theo buổi do lớp môi trường đặt; vùng hạt mưa/dịp lễ phủ cùng lưới.
    this.envFx.setBounds(cx, cz, radius);
    const sc = this.sunLight.shadow.camera;
    sc.left = -radius * 1.5;
    sc.right = radius * 1.5;
    sc.top = radius * 1.5;
    sc.bottom = -radius * 1.5;
    sc.near = 0.5;
    sc.far = radius * 6 + 20 * CELL_SIZE;
    sc.updateProjectionMatrix();
    this.handleResize();
  }

  private clampTarget(): void {
    const b = this.bounds;
    if (!b) return;
    const s = CELL_SIZE;
    this.target.x = Math.min((b.maxCol + VIEW_MARGIN) * s, Math.max((b.minCol - VIEW_MARGIN) * s, this.target.x));
    this.target.z = Math.min((b.maxRow + VIEW_MARGIN) * s, Math.max((b.minRow - VIEW_MARGIN) * s, this.target.z));
  }

  private handleResize(): void {
    const renderer = this.renderer;
    const canvas = this.canvas;
    if (!renderer || !canvas) return;
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setSize(width, height, false);
    const aspect = width / height;
    const half = this.frustumSize / 2;
    this.camera.left = -half * aspect;
    this.camera.right = half * aspect;
    this.camera.top = half;
    this.camera.bottom = -half;
    this.camera.updateProjectionMatrix();
  }

  private observeResize(canvas: HTMLCanvasElement): void {
    if (typeof ResizeObserver === 'undefined') {
      const onResize = (): void => this.handleResize();
      window.addEventListener('resize', onResize);
      this.cleanups.push(() => window.removeEventListener('resize', onResize));
      return;
    }
    this.zone.runOutsideAngular(() => {
      this.resizeObserver = new ResizeObserver(() => this.handleResize());
      this.resizeObserver.observe(canvas);
    });
  }

  // =============================================================================
  // Cử chỉ chuột / cảm ứng
  // =============================================================================

  private attachControls(canvas: HTMLCanvasElement): void {
    // Không để trình duyệt cuộn/phóng trang khi thao tác trên khung 3D (US-38).
    canvas.style.touchAction = 'none';

    const listen = <K extends keyof HTMLElementEventMap>(
      type: K,
      handler: (e: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ): void => {
      canvas.addEventListener(type, handler, opts);
      this.cleanups.push(() => canvas.removeEventListener(type, handler, opts));
    };

    this.zone.runOutsideAngular(() => {
      listen('pointerdown', (e) => this.onPointerDown(e));
      listen('pointermove', (e) => this.onPointerMove(e));
      listen('pointerup', (e) => this.onPointerUp(e));
      listen('pointercancel', (e) => this.onPointerCancel(e));
      listen('wheel', (e) => this.onWheel(e), { passive: false });
      listen('contextmenu', (e) => e.preventDefault());
    });
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.notifyCinemaInterrupted();
    this.canvas?.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size === 1) {
      this.gesture = {
        startX: e.clientX,
        startY: e.clientY,
        startAt: e.timeStamp,
        moved: false,
        pinchDist: null,
        midX: e.clientX,
        midY: e.clientY,
      };
    } else if (this.pointers.size === 2 && this.gesture) {
      const [a, b] = [...this.pointers.values()];
      this.gesture.moved = true; // Hai ngón → không còn là chạm.
      this.gesture.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      this.gesture.midX = (a.x + b.x) / 2;
      this.gesture.midY = (a.y + b.y) / 2;
    }
  }

  private onPointerMove(e: PointerEvent): void {
    const prev = this.pointers.get(e.pointerId);
    const g = this.gesture;
    if (!prev || !g) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      if (g.pinchDist && dist > 0) this.zoomAt(dist / g.pinchDist, midX, midY);
      this.panBy(midX - g.midX, midY - g.midY);
      g.pinchDist = dist;
      g.midX = midX;
      g.midY = midY;
      return;
    }

    if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > TAP_SLOP_PX) {
      g.moved = true;
    }
    if (g.moved) this.panBy(e.clientX - prev.x, e.clientY - prev.y);
  }

  private onPointerUp(e: PointerEvent): void {
    const g = this.gesture;
    const wasSingle = this.pointers.size === 1;
    this.pointers.delete(e.pointerId);
    this.canvas?.releasePointerCapture?.(e.pointerId);

    if (this.pointers.size === 0) {
      this.gesture = null;
      if (g && wasSingle && !g.moved && e.timeStamp - g.startAt <= TAP_MAX_MS) {
        const pick = this.pickAt(e.clientX, e.clientY);
        const seq = ++this.tapSeq;
        this.zone.run(() => this._tap.set({ pick, clientX: e.clientX, clientY: e.clientY, seq }));
      }
    } else if (g && this.pointers.size === 1) {
      // Còn một ngón sau khi chụm → tiếp tục kéo từ vị trí ngón còn lại.
      const [rest] = [...this.pointers.values()];
      g.pinchDist = null;
      g.midX = rest.x;
      g.midY = rest.y;
    }
  }

  private onPointerCancel(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) this.gesture = null;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.notifyCinemaInterrupted();
    // deltaMode 1 = theo dòng (Firefox) → quy về px.
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    // Phóng về phía con trỏ để cuộn vào đúng vật nuôi muốn xem.
    this.zoomAt(Math.exp(-delta * WHEEL_ZOOM_SPEED), e.clientX, e.clientY);
  }

  /** Thoát Cinema_Mode và báo cho container khi nhân viên tương tác (chạm/kéo/cuộn) (AC 2.5). */
  private notifyCinemaInterrupted(): void {
    if (!this._cinemaActive()) return;
    this.exitCinemaMode();
    this.zone.run(() => this.onCinemaInterrupted?.());
  }
}
