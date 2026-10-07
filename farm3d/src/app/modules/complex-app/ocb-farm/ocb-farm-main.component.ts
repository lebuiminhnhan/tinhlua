import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { ToastService } from '../../../shared/components/toast/toast.service';
import { FarmHudComponent } from './components/farm-hud/farm-hud.component';
import {
  FARM_LOAD_TIMEOUT_MS,
  FarmLoadItemDef,
  FarmLoadTracker,
} from './components/loading-overlay/load-progress';
import { FarmLoadingOverlayComponent } from './components/loading-overlay/loading-overlay.component';
import { OnboardingWizardComponent } from './components/onboarding-wizard/onboarding-wizard.component';
import { FarmCanvasComponent, FarmCanvasTap } from './components/farm-canvas/farm-canvas.component';
import { todayVnIso } from './components/onboarding-wizard/join-date';
import {
  OcbTreePanelComponent,
  OcbTreePanelTab,
} from './components/ocb-tree-panel/ocb-tree-panel.component';
import { LedgerPanelComponent } from './components/ledger-panel/ledger-panel.component';
import { InboxPanelComponent } from './components/inbox-panel/inbox-panel.component';
import { LeaderboardPanelComponent } from './components/leaderboard-panel/leaderboard-panel.component';
import { ShopPanelComponent, ShopPurchase } from './components/shop-panel/shop-panel.component';
import { SettingsPanelComponent } from './components/settings-panel/settings-panel.component';
import { AchievementPanelComponent } from './components/achievement-panel/achievement-panel.component';
import { ExpandPanelComponent, ExpandRequest } from './components/expand-panel/expand-panel.component';
import { unlockPlotPatch } from './components/expand-panel/expand-plan';
import {
  InventoryPanelComponent,
  InventorySale,
} from './components/inventory-panel/inventory-panel.component';
import { ShopTab, decorCatalogFromManifest, isFarmSpecies, isPlantKind } from './components/shop-panel/shop-catalog';
import { CheckinDialogComponent } from './components/checkin-dialog/checkin-dialog.component';
import { OfflineSummaryDialogComponent } from './components/offline-summary-dialog/offline-summary-dialog.component';
import { hasOfflineAccumulation } from './components/offline-summary-dialog/offline-summary';
import { EntityActionMenuComponent } from './components/entity-action-menu/entity-action-menu.component';
import { FarmConfirmDialogComponent } from './components/entity-action-menu/farm-confirm-dialog.component';
import { FarmInteractionController } from './components/entity-action-menu/farm-interaction.controller';
import { LEDGER_PAGE_SIZE_CONFIG_KEY, resolveLedgerPageSize } from './components/ledger-panel/ledger';
import { VisitBrowserComponent, VisitSelection } from './components/visit-browser/visit-browser.component';
import { VisitToolbarComponent } from './components/visit-toolbar/visit-toolbar.component';
import { DEFAULT_GREETING_MAX_LEN } from './components/visit-toolbar/visit-toolbar';
import {
  DEFAULT_ANNIVERSARY_MIN_YEARS,
  isTreeBlooming,
  joinYearOf,
} from './components/ocb-tree-panel/ocb-tree';
import type { FarmTreeRenderOptions } from './services/farm-scene.service';
import {
  FarmConfigResponse,
  FarmHelpAvailability,
  FarmOwnerProfile,
  FarmQuality,
  FarmStateJson,
  HelpActionType,
} from './models/ocb-farm.model';
import {
  AssetLoaderService,
  FARM_ASSET_MANIFEST_ITEM_ID,
  isAssetLoadItemId,
} from './services/asset-loader.service';
import { DispatchResult, FarmStateStore, FarmVisitTarget } from './services/farm-state.store';
import { FarmApiService } from './services/farm-api.service';
import { FarmSettingsSyncService } from './services/farm-settings-sync.service';
import { QualityService } from './services/quality.service';
import { FullscreenService } from './services/fullscreen.service';

/** Khoá `farm_config` (giây) cho thời gian chờ tải tối đa — chưa có thì dùng XN-1 (30s). */
const LOAD_TIMEOUT_CONFIG_KEY = 'load_timeout_seconds';

type FarmMainAction = 'checkin' | 'harvest' | 'anniversary';

/** Chu kỳ cập nhật "hôm nay" (UTC+7) — banner kỷ niệm / ra hoa đổi đúng lúc qua ngày. */
const CLOCK_TICK_MS = 60_000;

const LOAD_ITEMS: readonly FarmLoadItemDef[] = [
  { id: 'farm-data', label: 'Dữ liệu nông trại', weight: 3, critical: true },
  { id: 'config', label: 'Cấu hình trò chơi', weight: 1 },
  // Danh mục mô hình đăng ký ngay từ đầu để lần tải không "xong" trước khi biết danh sách
  // mô hình. Không chặn: thiếu mô hình thì nông trại vẫn dùng được (US-39). Từng mô hình
  // được `AssetLoaderService` thêm vào tracker này khi biết mức chất lượng.
  { id: FARM_ASSET_MANIFEST_ITEM_ID, label: 'Danh mục mô hình 3D', weight: 1 },
];

/**
 * OCB Farm — component chính (container).
 *
 * - Sở hữu `FarmLoadTracker` và điều phối lần tải đầu: dữ liệu nông trại (`GET /me`,
 *   bắt buộc) và cấu hình (không bắt buộc). Quá thời gian chờ → overlay báo lỗi kèm thử
 *   lại; thử lại chỉ chạy lại các hạng mục lỗi (US-39).
 * - `GET /me` trả `initialized = false` → mở khu khởi tạo nông trại (US-1, wizard ở 12.1).
 * - Hành động chính check-in / thu hoạch tất cả, ghi nhận analytics `farm_action`.
 *
 * _Requirements: US-1, US-39_
 */
@Component({
  selector: 'app-ocb-farm-main',
  templateUrl: './ocb-farm-main.component.html',
  styleUrl: './ocb-farm-main.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FarmCanvasComponent,
    FarmHudComponent,
    FarmLoadingOverlayComponent,
    OnboardingWizardComponent,
    OcbTreePanelComponent,
    LedgerPanelComponent,
    InboxPanelComponent,
    LeaderboardPanelComponent,
    ShopPanelComponent,
    ExpandPanelComponent,
    InventoryPanelComponent,
    CheckinDialogComponent,
    OfflineSummaryDialogComponent,
    EntityActionMenuComponent,
    FarmConfirmDialogComponent,
    SettingsPanelComponent,
    AchievementPanelComponent,
    VisitBrowserComponent,
    VisitToolbarComponent,
  ],
})
export default class OcbFarmMainComponent {
  private readonly store = inject(FarmStateStore);
  private readonly api = inject(FarmApiService);
  private readonly analytics = inject(AnalyticsService);
  private readonly toast = inject(ToastService);
  private readonly assets = inject(AssetLoaderService);
  private readonly quality = inject(QualityService);
  private readonly settingsSync = inject(FarmSettingsSyncService);
  private readonly fullscreen = inject(FullscreenService);

  /** Theo dõi tiến trình tải — public để template và (sau này) `farm-canvas` dùng chung. */
  readonly loader = new FarmLoadTracker();

  private readonly config = signal<FarmConfigResponse | null>(null);
  readonly retrying = signal(false);
  readonly busyAction = signal<FarmMainAction | null>(null);
  /** Hộp thoại hướng dẫn 5 bước (US-1) — tự mở sau khởi tạo, mở lại từ nút "Hướng dẫn". */
  readonly guideOpen = signal(false);

  // --- Fullscreen_Mode & Cinema_Mode (task 17.1) ------------------------------
  /**
   * Đồng bộ từ `FullscreenService.active()` (nguồn chân lý duy nhất là `fullscreenchange`
   * trên `document`) — khi `true`, ẩn `.card-header`, tiêu đề `<h4>`, `app-farm-hud`, chỉ
   * còn `.farm-stage` (khung 3D + nút thoát của `farm-canvas`) (AC 1.2).
   * Luôn khởi tạo theo trạng thái fullscreen thật của trình duyệt tại thời điểm tạo
   * component (không đọc từ localStorage/state cũ) — thực tế là `false` khi component mới
   * được tạo vì không có cách nào vào lại fullscreen mà không qua `enter()` (AC 12.3).
   */
  readonly isFullscreen = this.fullscreen.active;
  /**
   * Cinema_Mode (Picture-in-Picture tự dựng, task 2) — khác Fullscreen_Mode, không gọi
   * Fullscreen API, chỉ là cờ hiển thị cục bộ của component này. Luôn khởi tạo `false`
   * (AC 12.3) — nối `scene.enterCinemaMode()`/`exitCinemaMode()` ở task 17.2.
   * Độc lập với `isFullscreen` — cả hai có thể cùng `true`.
   */
  readonly cinemaMode = signal(false);
  /**
   * Cầu nối tới `app-farm-canvas` (task 17.2) — `FarmSceneService` sống trong `providers`
   * của `FarmCanvasComponent` (một WebGL context riêng mỗi khung 3D), không phải
   * `providedIn: 'root'`, nên component này không `inject()` được trực tiếp. Gọi
   * `enterCinemaMode()`/`exitCinemaMode()` công khai trên `FarmCanvasComponent` thay vì
   * tham chiếu `FarmSceneService` trực tiếp.
   */
  private readonly farmCanvas = viewChild(FarmCanvasComponent);

  // --- Cinema_Mode: cửa sổ nổi (PiP) có thể kéo thả --------------------------
  /**
   * Toạ độ góc trên-trái của `.farm-stage` (px, `position: fixed`) khi Cinema_Mode đang
   * chạy. Đặt lại về góc dưới-phải màn hình mỗi lần vào Cinema_Mode (không nhớ qua phiên,
   * nhất quán AC 12.3 "không tự khởi động lại/khôi phục trạng thái cũ").
   */
  readonly pipX = signal(0);
  readonly pipY = signal(0);
  /** Lệch chuột/cảm ứng so với góc cửa sổ tại thời điểm bắt đầu kéo (tính 1 lần ở pointerdown). */
  private pipDragOffsetX = 0;
  private pipDragOffsetY = 0;
  private pipPointerId: number | null = null;
  private pipMoveListener: ((e: PointerEvent) => void) | null = null;
  private pipUpListener: ((e: PointerEvent) => void) | null = null;

  // --- Cây OCB (US-4..US-7, US-51) -------------------------------------------
  /** Hôm nay theo giờ Việt Nam — cập nhật mỗi phút để qua 00:00 là đổi trạng thái kỷ niệm. */
  readonly todayIso = signal(todayVnIso());
  readonly treePanelOpen = signal(false);
  // --- Cài đặt (US-30, US-32, US-36, BR-29) -----------------------------------
  readonly settingsOpen = signal(false);
  // --- Lịch sử thu chi (US-21) -----------------------------------------------
  readonly ledgerOpen = signal(false);
  // --- Hộp thư: người đã giúp + lời chúc (US-8, US-27, US-48) -----------------
  readonly inboxOpen = signal(false);
  // --- Bảng xếp hạng (US-28) --------------------------------------------------
  readonly leaderboardOpen = signal(false);
  // --- Thành tựu và huy hiệu (US-29) ------------------------------------------
  readonly achievementsOpen = signal(false);
  // --- Ghé thăm đồng nghiệp (US-8, US-26, US-27, BR-21) ------------------------
  readonly visitBrowserOpen = signal(false);
  readonly visitTarget = this.store.visitMode;
  readonly visitHasFarm = signal(true);
  readonly visitHelp = signal<FarmHelpAvailability | null>(null);
  /** Hồ sơ công khai của chủ nông trại đang ghé thăm — để xem Cây OCB của đồng nghiệp. */
  readonly visitOwner = signal<FarmOwnerProfile | null>(null);
  readonly visitGreetingMaxLen = computed(
    () => this.config()?.values['greeting_max_len'] ?? DEFAULT_GREETING_MAX_LEN,
  );
  readonly visitLoading = signal(false);
  readonly visitError = signal<string | null>(null);
  /** Số dòng mỗi trang theo cấu hình (`ledger_page_size`), mặc định 20. */
  readonly ledgerPageSize = computed(() =>
    resolveLedgerPageSize(this.config()?.values[LEDGER_PAGE_SIZE_CONFIG_KEY]),
  );
  // --- Cửa hàng (US-10, US-16, US-33, US-34, US-37, US-49) --------------------
  readonly shopOpen = signal(false);
  // --- Mở rộng đất (US-24) ----------------------------------------------------
  readonly expandOpen = signal(false);
  readonly expanding = signal(false);
  readonly expandError = signal<string | null>(null);
  readonly shopTab = signal<ShopTab>('animal');
  /** Mọi mã trang trí khai báo trong manifest 3D → mỗi mã một vật phẩm trong cửa hàng. */
  readonly decorCatalog = computed(() => decorCatalogFromManifest(this.assets.manifest()?.decors));
  readonly shopBuying = signal(false);
  readonly shopError = signal<string | null>(null);
  readonly treePanelTab = signal<OcbTreePanelTab>('overview');
  readonly selectedBranchIndex = signal<number | null>(null);
  /** Năm kỷ niệm đã nhận thưởng trong phiên (sau khi hái hoặc bị báo đã nhận). */
  readonly anniversaryClaimedYear = signal<number | null>(null);
  readonly anniversaryError = signal<string | null>(null);
  readonly configValue = this.config.asReadonly();

  // --- Dữ liệu từ store -------------------------------------------------------
  readonly me = this.store.me;
  readonly state = this.store.state;
  readonly balance = this.store.balance;
  readonly hasPending = this.store.hasPending;
  readonly connection = this.store.connection;
  readonly isVisiting = this.store.isVisiting;

  /** Lỗi thao tác (không phải lỗi tải — lỗi tải đã hiển thị trong overlay). */
  readonly actionError = computed(() => {
    const err = this.store.error();
    return err && err.kind !== 'load' ? err : null;
  });

  // --- Trạng thái suy ra ------------------------------------------------------
  readonly needsOnboarding = computed(() => this.store.initialized() === false);
  readonly farmReady = computed(() => this.store.initialized() === true && this.me() !== null);

  readonly farmName = computed(() => this.me()?.owner.farm_name || 'Nông trại OCB');
  readonly ownerName = computed(() => this.me()?.owner.full_name || '');
  readonly sceneLock = computed(() => this.me()?.settings.scene_lock ?? null);

  private readonly loadTimeoutMs = computed(() => {
    const seconds = this.config()?.values[LOAD_TIMEOUT_CONFIG_KEY];
    return seconds !== undefined && Number.isFinite(seconds) && seconds > 0
      ? seconds * 1000
      : FARM_LOAD_TIMEOUT_MS;
  });

  readonly loadErrorMessage = computed(() => {
    const failed = this.loader.criticalFailure();
    return failed ? `${failed.label}: ${failed.error ?? 'không tải được'}.` : null;
  });

  // --- Check-in & tổng kết offline (US-23, US-25) ------------------------------
  /**
   * Số Hạt OCB vừa nhận ở lượt check-in trong phiên này — chỉ để hiển thị trong hộp
   * thưởng, KHÔNG dùng để tính `claimed_today`/`streak` (hai giá trị đó đọc trực tiếp từ
   * `me().checkin`, được `FarmStateStore` vá đúng ngay sau khi `CLAIM_CHECKIN` thành công
   * — xem `FarmStateStore.patchMeCheckin`). Mất khi F5, nhưng không sao vì hộp thưởng chỉ
   * hiện số tiền này ngay sau khi vừa bấm nhận, không cần giữ qua lần tải trang mới.
   */
  readonly checkinReceived = signal<number | null>(null);
  readonly checkinDialogOpen = signal(false);
  readonly checkinError = signal<string | null>(null);
  readonly checkinStatus = computed(() => this.me()?.checkin ?? null);
  readonly offlineSummary = computed(() => this.me()?.offline_summary ?? null);
  readonly offlineSummaryOpen = signal(false);
  readonly offlineError = signal<string | null>(null);
  /** Hộp thoại tự mở chỉ một lần mỗi phiên (sau lần tải `/me` đầu tiên). */
  private autoDialogsShown = false;

  readonly checkinClaimed = computed(() => this.checkinStatus()?.claimed_today ?? false);
  readonly checkinStreak = computed(() => this.checkinStatus()?.streak ?? 0);

  /** Có thể thực hiện hành động ghi: đã sẵn sàng, không ghé thăm, có mạng, không bận. */
  readonly canAct = computed(
    () =>
      this.farmReady() &&
      !this.isVisiting() &&
      this.connection() !== 'offline' &&
      this.busyAction() === null,
  );
  readonly canCheckin = computed(() => this.canAct() && !this.checkinClaimed());

  /** Năm vào làm + ra hoa kết quả ngày kỷ niệm → khung 3D (US-6, US-7). */
  readonly treeOptions = computed<FarmTreeRenderOptions | null>(() => {
    const me = this.me();
    // Ghé thăm: Cây OCB theo ngày vào làm của chủ nông trại (nhánh biết đúng năm dương lịch).
    const joinDate = this.isVisiting() ? this.visitOwner()?.seniority.join_date ?? null : me?.join_date ?? null;
    if (!me && !this.isVisiting()) return null;
    const values = this.config()?.values ?? {};
    const minYears = values['anniversary_min_years'] ?? DEFAULT_ANNIVERSARY_MIN_YEARS;
    const fruitCount = values['anniversary_fruit_count'];
    return {
      joinYear: joinYearOf(joinDate),
      blooming: isTreeBlooming(joinDate, this.todayIso(), minYears),
      ...(fruitCount !== undefined ? { fruitCount } : {}),
    };
  });

  readonly connectionBadge = computed(() => {
    switch (this.connection()) {
      case 'offline':
        return { cls: 'text-bg-danger', icon: 'bi bi-wifi-off', label: 'Mất kết nối' };
      case 'reconnecting':
        return { cls: 'text-bg-warning', icon: 'bi bi-arrow-repeat', label: 'Đang kết nối lại' };
      default:
        return this.hasPending()
          ? { cls: 'text-bg-info', icon: 'bi bi-cloud-upload', label: 'Đang lưu' }
          : { cls: 'text-bg-success', icon: 'bi bi-cloud-check', label: 'Đã lưu' };
    }
  });

  // --- Mô hình 3D -------------------------------------------------------------
  /** Mức chất lượng của lần nạp mô hình gần nhất (`null` = chưa nạp). */
  private assetTier: FarmQuality | null = null;
  /**
   * `true` sau khi đổi mức chất lượng trong phiên: mô hình mức mới nạp nền bằng tracker
   * riêng của `AssetLoaderService` → không phủ overlay chặn, nông trại dùng tiếp (US-36).
   */
  private readonly assetsInBackground = signal(false);

  /** Hạng mục lỗi cho overlay: tracker chính + mô hình nạp nền ở mức chất lượng mới. */
  readonly overlayFailedItems = computed(() => {
    const main = this.loader.failedItems();
    if (!this.assetsInBackground()) return main;
    return [...main.filter((i) => !isAssetLoadItemId(i.id)), ...this.assets.failedLoadItems()];
  });

  /** Lần chạm gần nhất trên khung 3D — menu tương tác (13.6) đọc signal này. */
  readonly lastCanvasTap = signal<FarmCanvasTap | null>(null);

  /** Menu tương tác vật nuôi / cây / trang trí, thao tác hàng loạt, dấu hiệu 3D (13.6). */
  readonly interaction = new FarmInteractionController({
    values: () => this.config()?.values ?? {},
    canAct: () => this.canAct(),
  });

  constructor() {
    const clock = setInterval(() => {
      const today = todayVnIso();
      if (today !== this.todayIso()) this.todayIso.set(today);
    }, CLOCK_TICK_MS);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(clock);
      this.loader.dispose();
      this.endPipDrag();
    });

    // Đổi mức chất lượng trong phiên → nạp bộ mô hình của mức mới (nạp nền, không chặn);
    // trong lúc chờ, khung 3D dùng tạm mô hình mức cũ.
    effect(() => {
      const tier = this.quality.tier();
      // Chờ settings của nhân viên được nạp, tránh tải nhầm bộ mô hình của mức tự dò.
      const settled = this.settingsSync.hydrated() || this.store.initialized() === false;
      if (!settled || this.assetTier === null || tier === this.assetTier) return;
      untracked(() => {
        this.assetTier = tier;
        this.assetsInBackground.set(true);
        void this.assets.loadAll(tier);
      });
    });

    void this.startLoad();
  }

  // ---------------------------------------------------------------------------
  // Tải
  // ---------------------------------------------------------------------------

  async startLoad(): Promise<void> {
    this.loader.begin(LOAD_ITEMS, this.loadTimeoutMs());
    await this.runItems(LOAD_ITEMS.map((i) => i.id));
  }

  /** Thử lại: chỉ tải lại các hạng mục lỗi, giữ nguyên hạng mục đã xong. */
  async retryLoad(): Promise<void> {
    if (this.retrying()) return;
    this.retrying.set(true);
    try {
      if (this.assetsInBackground()) {
        // Mô hình mức mới nằm ở tracker riêng của bộ nạp; tracker chính chỉ thử lại phần còn lại.
        const mainIds = this.loader
          .failedItems()
          .filter((i) => !isAssetLoadItemId(i.id))
          .map((i) => i.id);
        await Promise.all([
          mainIds.length > 0 ? this.runItems(this.loader.retry(mainIds)) : Promise.resolve(),
          this.assets.retryFailed(),
        ]);
      } else {
        await this.runItems(this.loader.retry());
      }
    } finally {
      this.retrying.set(false);
    }
  }

  /**
   * Chạy các hạng mục của tracker chính. Hạng mục mô hình (`asset:*`, trừ danh mục ở lần
   * tải đầu) do `AssetLoaderService` tự theo dõi trên cùng tracker → chuyển sang
   * `runRetriedItems` thay vì `track` lần nữa.
   */
  private async runItems(ids: readonly string[]): Promise<void> {
    // Danh mục: lần tải đầu (chưa biết mức chất lượng) tự nạp; khi thử lại sau khi đã yêu
    // cầu mô hình thì để bộ nạp chạy lại cả danh mục lẫn mô hình của lần yêu cầu đó.
    const assetIds = ids.filter(
      (id) => isAssetLoadItemId(id) && (id !== FARM_ASSET_MANIFEST_ITEM_ID || this.assetTier !== null),
    );
    const ownIds = ids.filter((id) => !assetIds.includes(id));
    await Promise.all([
      ...ownIds.map((id) => this.loader.track(id, () => this.loadItem(id))),
      assetIds.length > 0 ? this.assets.runRetriedItems(assetIds) : Promise.resolve(),
    ]);
  }

  private async loadItem(id: string): Promise<void> {
    switch (id) {
      case 'farm-data': {
        const ok = await this.store.load();
        if (!ok) {
          throw new Error(this.store.error()?.message || 'Không tải được dữ liệu nông trại');
        }
        // Đã biết mức chất lượng theo nhân viên → nạp mô hình vào cùng tracker. Gọi trước
        // khi hạng mục này hoàn tất để tiến trình không chạm 100% giữa chừng.
        this.requestInitialAssets();
        this.openDialogsAfterLoad();
        return;
      }
      case FARM_ASSET_MANIFEST_ITEM_ID:
        await this.assets.loadManifest();
        return;
      case 'config':
        this.config.set(await firstValueFrom(this.api.getConfig()));
        return;
      default:
        throw new Error('Hạng mục tải không xác định');
    }
  }

  /**
   * Nạp mô hình ở mức chất lượng của nhân viên (lựa chọn thủ công đã lưu, hoặc tự dò).
   * Đọc thẳng `me.settings` vì `FarmSettingsSyncService` chỉ nạp settings ở lượt effect sau.
   */
  private requestInitialAssets(): void {
    if (this.assetTier !== null) return;
    const settings = this.store.me()?.settings;
    const tier: FarmQuality = settings?.quality_manual ? settings.quality : this.quality.detection().tier;
    this.assetTier = tier;
    // Màn hình tải chỉ chờ tập mô hình lần đầu; biến thể ngẫu nhiên + vật phẩm trang trí
    // bổ sung nạp nền sau đó (khung 3D tự đổi sang mô hình thật khi xong).
    void this.assets.loadAll(tier, { tracker: this.loader, initialOnly: true }).then(() => {
      if (this.assetTier !== tier) return;
      this.assetsInBackground.set(true);
      void this.assets.loadAll(tier);
    });
  }

  onCanvasTap(tap: FarmCanvasTap): void {
    // Đang chọn ô đích di chuyển / chạm vật thể → menu tương tác xử lý (13.6).
    if (this.interaction.handleTap(tap)) return;
    this.lastCanvasTap.set(tap);
    // Chạm Cây OCB → mở bảng thông tin; chạm đúng nhánh → tab Nhánh, chọn sẵn nhánh đó (US-6).
    if (tap.pick?.kind === 'tree') {
      const branch = tap.pick.branch;
      this.openTreePanel(branch ? 'branches' : 'overview', branch?.index ?? null);
    }
    // Chạm Nhà kho → mở kho & bán sản phẩm (vật thể cố định, giống Cây OCB — chỉ xem/mở panel).
    if (tap.pick?.kind === 'fixture' && tap.pick.fixtureKind === 'warehouse') {
      this.openInventory();
    }
  }

  // ---------------------------------------------------------------------------
  // Cây OCB
  // ---------------------------------------------------------------------------

  openTreePanel(tab: OcbTreePanelTab = 'overview', branchIndex: number | null = null): void {
    // Ghé thăm vẫn mở được — bảng ở chế độ chỉ xem Cây OCB của đồng nghiệp.
    if (!this.farmReady() || (this.isVisiting() && (!this.visitOwner() || !this.visitHasFarm()))) return;
    this.treePanelTab.set(tab);
    this.selectedBranchIndex.set(branchIndex);
    this.anniversaryError.set(null);
    this.treePanelOpen.set(true);
  }

  closeTreePanel(): void {
    this.treePanelOpen.set(false);
  }

  // ---------------------------------------------------------------------------
  // Cửa hàng (US-10, US-16, US-33, US-34, US-37, US-49)
  // ---------------------------------------------------------------------------

  /** Ô đã mở vừa chạm trên khung 3D — cửa hàng chọn sẵn ô này nếu hợp lệ. */
  readonly shopPreferredCell = computed(() => {
    const pick = this.lastCanvasTap()?.pick;
    return pick?.kind === 'cell' && pick.unlocked ? pick.cell : null;
  });
  readonly canShop = computed(() => this.canAct() && !this.shopBuying());

  openShop(tab: ShopTab = 'animal'): void {
    if (!this.farmReady() || this.isVisiting()) return;
    this.shopTab.set(tab);
    this.shopError.set(null);
    this.shopOpen.set(true);
  }

  closeShop(): void {
    this.shopOpen.set(false);
    this.shopError.set(null);
  }

  // ---------------------------------------------------------------------------
  // Mở rộng đất (US-24)
  // ---------------------------------------------------------------------------

  /** Vùng khoá vừa chạm trên khung 3D — khu mở rộng chọn sẵn vùng này. */
  readonly expandPreferredPlot = computed(() => {
    const pick = this.lastCanvasTap()?.pick;
    return pick?.kind === 'cell' && !pick.unlocked ? pick.plotId : null;
  });
  readonly canExpand = computed(() => this.canAct() && !this.expanding());

  openExpand(): void {
    if (!this.farmReady() || this.isVisiting()) return;
    this.expandError.set(null);
    this.expandOpen.set(true);
  }

  closeExpand(): void {
    this.expandOpen.set(false);
    this.expandError.set(null);
  }

  /**
   * `EXPAND_PLOT`: mở vùng và trừ Hạt OCB lạc quan; server từ chối hoặc lỗi lưu thì store
   * tự hoàn tác (vùng vẫn khoá, số dư giữ nguyên) và lỗi hiển thị trong panel kèm thử lại.
   */
  async expandPlot(req: ExpandRequest): Promise<void> {
    if (!this.canExpand()) return;
    this.expandError.set(null);
    this.expanding.set(true);
    try {
      const result = await this.store.dispatch(
        'EXPAND_PLOT',
        { plot_id: req.plotId },
        { optimistic: unlockPlotPatch(req.plotId, req.price), label: `Mở ${req.label}` },
      );
      if (result.ok) {
        this.closeExpand();
        this.afterAction(result, 'EXPAND_PLOT', `Đã mở ${req.label}. Các ô mới đã sẵn sàng để sử dụng.`);
      } else {
        // Panel là hộp thoại phủ trên alert lỗi chung → hiển thị lỗi ngay trong panel.
        this.expandError.set(result.error.message);
        this.store.clearError();
      }
    } finally {
      this.expanding.set(false);
    }
  }

  /**
   * Gửi lệnh mua tương ứng tab. Trừ Hạt OCB lạc quan để số dư cập nhật ngay; server từ
   * chối thì store tự hoàn tác và lỗi hiển thị trong cửa hàng (giữ mở để chọn lại).
   */
  async buyFromShop(p: ShopPurchase): Promise<void> {
    if (!this.canShop()) return;
    this.shopError.set(null);
    this.shopBuying.set(true);
    const optimistic = (s: { state: FarmStateJson; balance: number }) => ({ ...s, balance: s.balance - p.price });
    try {
      let result: DispatchResult;
      let command: string;
      if (p.tab === 'animal' && isFarmSpecies(p.code)) {
        command = 'BUY_ANIMAL';
        result = await this.store.dispatch(
          'BUY_ANIMAL',
          { species: p.code, cell: p.cell },
          { optimistic, label: `Mua ${p.name}` },
        );
      } else if (p.tab === 'seed' && isPlantKind(p.code)) {
        command = 'PLANT_SEED';
        result = await this.store.dispatch(
          'PLANT_SEED',
          { kind: p.code, cell: p.cell },
          { optimistic, label: `Gieo hạt ${p.name}` },
        );
      } else if (p.tab === 'boost' && p.targetId && p.code === 'growth_potion') {
        command = 'USE_GROWTH_POTION';
        result = await this.store.dispatch(
          'USE_GROWTH_POTION',
          { animal_id: p.targetId },
          { optimistic, label: `Dùng ${p.name}` },
        );
      } else if (p.tab === 'boost' && p.targetId && p.code === 'super_fertilizer') {
        command = 'USE_SUPER_FERTILIZER';
        result = await this.store.dispatch(
          'USE_SUPER_FERTILIZER',
          { plant_id: p.targetId },
          { optimistic, label: `Dùng ${p.name}` },
        );
      } else if (p.tab === 'decor') {
        command = 'BUY_DECOR';
        result = await this.store.dispatch(
          'BUY_DECOR',
          { kind: p.code, cell: p.cell },
          { optimistic, label: `Mua ${p.name}` },
        );
      } else {
        this.shopError.set('Vật phẩm không hợp lệ.');
        return;
      }
      if (result.ok) {
        this.closeShop();
        this.afterAction(
          result,
          command,
          p.tab === 'boost' ? `Đã dùng ${p.name}.` : `Đã mua ${p.name} và đặt tại ô ${p.cell}.`,
        );
      } else {
        // Cửa hàng là hộp thoại phủ trên alert lỗi chung → hiển thị lỗi ngay trong cửa hàng.
        this.shopError.set(result.error.message);
        this.store.clearError();
      }
    } finally {
      this.shopBuying.set(false);
    }
  }

  /** Hái quả kỷ niệm (US-7) — server chặn lần hái thứ hai trong cùng năm kỷ niệm. */
  async pickAnniversaryFruit(year: number): Promise<void> {
    if (!this.canAct()) return;
    this.anniversaryError.set(null);
    this.busyAction.set('anniversary');
    try {
      const result = await this.store.dispatch('PICK_ANNIVERSARY_FRUIT', { anniversary_year: year });
      if (result.ok) {
        this.anniversaryClaimedYear.set(year);
        this.analytics.trackAppUsage('ocb-farm', 'farm_action', { command: 'PICK_ANNIVERSARY_FRUIT' });
        const notice = result.notices.find((n) => n.code === 'ANNIVERSARY_FRUIT_PICKED');
        this.toast.success(notice?.message ?? 'Đã hái quả kỷ niệm.');
        for (const a of result.achievements) this.toast.success(`Mở khoá thành tựu: ${a.name}`);
      } else {
        // Bảng Cây OCB là hộp thoại phủ trên alert lỗi chung → hiển thị lỗi ngay trong bảng.
        this.anniversaryError.set(result.error.message);
        if (result.error.code === 'ANNIVERSARY_ALREADY_CLAIMED') this.anniversaryClaimedYear.set(year);
      }
    } finally {
      this.busyAction.set(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Hành động chính
  // ---------------------------------------------------------------------------

  /**
   * Nhận thưởng check-in (US-25). Lỗi hiển thị ngay trong hộp thưởng (giữ mở để thử lại);
   * bị báo đã nhận hôm nay → chuyển hộp sang trạng thái đã check-in.
   */
  async claimCheckin(): Promise<void> {
    if (!this.canCheckin()) return;
    this.checkinError.set(null);
    this.busyAction.set('checkin');
    try {
      const result = await this.store.dispatch('CLAIM_CHECKIN', {});
      if (result.ok) {
        const notice = result.notices.find((n) => n.code === 'CHECKIN_CLAIMED');
        const base = Number(notice?.data?.['base_reward']);
        const bonus = Number(notice?.data?.['streak_bonus']);
        this.checkinReceived.set(Number.isFinite(base) ? base + (Number.isFinite(bonus) ? bonus : 0) : null);
        this.afterAction(result, 'CLAIM_CHECKIN', notice?.message ?? 'Đã nhận thưởng check-in hôm nay.');
      } else {
        if (this.checkinDialogOpen()) {
          // Hộp thưởng tự hiển thị lỗi → không lặp lại ở alert chung phía sau hộp thoại.
          this.checkinError.set(result.error.message);
          this.store.clearError();
        }
        // `me().checkin.claimed_today` đã đúng (patch bởi store hoặc tải lại trước đó) —
        // không cần vá gì thêm ở đây, hộp thưởng tự chuyển trạng thái theo `checkinClaimed()`.
      }
    } finally {
      this.busyAction.set(null);
    }
  }

  async harvestAll(): Promise<void> {
    if (!this.canAct()) return;
    this.offlineError.set(null);
    this.busyAction.set('harvest');
    try {
      const result = await this.store.dispatch('HARVEST_ALL', {});
      this.afterAction(result, 'HARVEST_ALL', 'Đã thu hoạch tất cả sản phẩm sẵn sàng vào kho.');
      if (result.ok) {
        this.closeOfflineSummary();
      } else if (this.offlineSummaryOpen()) {
        this.offlineError.set(result.error.message);
        this.store.clearError();
      }
    } finally {
      this.busyAction.set(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Hộp thưởng check-in & bảng tổng kết offline (US-23, US-25)
  // ---------------------------------------------------------------------------

  /**
   * Sau lần tải `/me` đầu: có sản phẩm tích lũy → mở bảng tổng kết; chưa check-in hôm nay
   * → mở hộp thưởng (hiển thị sau khi đóng bảng tổng kết để không chồng hai hộp thoại).
   */
  private openDialogsAfterLoad(): void {
    if (this.autoDialogsShown || this.isVisiting()) return;
    this.autoDialogsShown = true;
    if (hasOfflineAccumulation(this.offlineSummary())) this.offlineSummaryOpen.set(true);
    if (this.checkinStatus() && !this.checkinClaimed()) this.checkinDialogOpen.set(true);
  }

  openCheckin(): void {
    if (!this.farmReady() || this.isVisiting()) return;
    this.checkinError.set(null);
    this.checkinDialogOpen.set(true);
  }

  closeCheckin(): void {
    this.checkinDialogOpen.set(false);
    this.checkinError.set(null);
  }

  closeOfflineSummary(): void {
    this.offlineSummaryOpen.set(false);
    this.offlineError.set(null);
  }

  /** Wizard đã gọi `POST /me/init` và tải lại nông trại qua store → mở hướng dẫn. */
  onOnboardingCompleted(): void {
    this.toast.success('Đã tạo nông trại của bạn.');
    this.guideOpen.set(true);
  }

  openGuide(): void {
    if (this.farmReady()) this.guideOpen.set(true);
  }

  closeGuide(): void {
    this.guideOpen.set(false);
  }

  /**
   * Bật Cinema_Mode: `.farm-stage` tách thành cửa sổ nổi (PiP) có thể kéo thả, phần còn lại
   * của trang (toolbar, HUD, panel) vẫn hiển thị và tương tác được — khác hành vi "ẩn hết"
   * trước đây. Khởi động Cinema_Camera_Controller trên scene của khung 3D hiện tại; đặt lại
   * vị trí PiP về góc dưới-phải màn hình (không nhớ qua phiên, nhất quán AC 12.3).
   */
  enterCinemaMode(): void {
    if (!this.farmReady() || this.isVisiting()) return;
    this.cinemaMode.set(true);
    this.resetPipPosition();
    this.farmCanvas()?.enterCinemaMode();
  }

  /**
   * Thoát Cinema_Mode — qua nút thoát trên thanh kéo thả của PiP, hoặc khi `farm-canvas`
   * phát `cinemaInterrupted` (nhân viên chạm/kéo/cuộn trên khung 3D trong lúc Cinema_Mode
   * đang chạy, AC 2.5). Kéo thanh handle của PiP KHÔNG tính là tương tác với khung 3D nên
   * không gọi tới đây (xem `onPipDragStart`/`stopPropagation` trên nút thoát trong template).
   */
  exitCinemaMode(): void {
    this.cinemaMode.set(false);
    this.endPipDrag();
    this.farmCanvas()?.exitCinemaMode();
  }

  /** Kích thước mặc định của cửa sổ Cinema_Mode (PiP) — khớp với `.farm-stage-pip` trong SCSS. */
  private static readonly PIP_WIDTH = 360;
  private static readonly PIP_HEIGHT = 240;
  private static readonly PIP_MARGIN = 16;

  /** Đặt PiP về góc dưới-phải viewport, có chừa lề để không dính sát cạnh màn hình. */
  private resetPipPosition(): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    this.pipX.set(Math.max(0, vw - OcbFarmMainComponent.PIP_WIDTH - OcbFarmMainComponent.PIP_MARGIN));
    this.pipY.set(Math.max(0, vh - OcbFarmMainComponent.PIP_HEIGHT - OcbFarmMainComponent.PIP_MARGIN));
  }

  /**
   * Bắt đầu kéo cửa sổ Cinema_Mode (PiP) từ thanh handle (chuột + cảm ứng qua Pointer
   * Events). Gắn listener `pointermove`/`pointerup` trên `window` thay vì template để theo
   * được con trỏ ra ngoài phạm vi thanh handle khi kéo nhanh. Cập nhật `pipX`/`pipY` qua
   * signal (không mutate DOM trực tiếp) để giữ đúng vòng lặp reactivity của Angular — khối
   * lượng tính toán ở đây rất nhẹ (hai phép trừ) nên không cần `runOutsideAngular`.
   */
  onPipDragStart(event: PointerEvent): void {
    // Chỉ nút chính (chuột) hoặc chạm; bỏ qua nếu bấm đúng vào nút thoát (đã stopPropagation).
    if (event.button !== undefined && event.button !== 0 && event.pointerType === 'mouse') return;
    event.preventDefault();
    this.pipPointerId = event.pointerId;
    this.pipDragOffsetX = event.clientX - this.pipX();
    this.pipDragOffsetY = event.clientY - this.pipY();

    const onMove = (e: PointerEvent): void => {
      if (e.pointerId !== this.pipPointerId) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const nextX = e.clientX - this.pipDragOffsetX;
      const nextY = e.clientY - this.pipDragOffsetY;
      // Giữ cửa sổ trong phạm vi viewport (clamp) để không bị kéo mất ra ngoài vùng nhìn thấy.
      this.pipX.set(Math.min(Math.max(0, nextX), Math.max(0, vw - OcbFarmMainComponent.PIP_WIDTH)));
      this.pipY.set(Math.min(Math.max(0, nextY), Math.max(0, vh - OcbFarmMainComponent.PIP_HEIGHT)));
    };
    const onUp = (e: PointerEvent): void => {
      if (e.pointerId !== this.pipPointerId) return;
      this.endPipDrag();
    };
    this.pipMoveListener = onMove;
    this.pipUpListener = onUp;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  /** Gỡ listener kéo thả PiP — gọi khi thả chuột/tay hoặc khi thoát Cinema_Mode giữa lúc đang kéo. */
  private endPipDrag(): void {
    if (this.pipMoveListener) window.removeEventListener('pointermove', this.pipMoveListener);
    if (this.pipUpListener) {
      window.removeEventListener('pointerup', this.pipUpListener);
      window.removeEventListener('pointercancel', this.pipUpListener);
    }
    this.pipMoveListener = null;
    this.pipUpListener = null;
    this.pipPointerId = null;
  }

  dismissActionError(): void {
    this.store.clearError();
  }

  /** Mở bảng lịch sử thu chi (US-21) — chỉ cho nông trại của chính mình. */
  openLedger(): void {
    if (!this.farmReady() || this.isVisiting()) return;
    this.ledgerOpen.set(true);
  }

  closeLedger(): void {
    this.ledgerOpen.set(false);
  }

  /** Mở hộp thư: người đã giúp + lời chúc (US-8, US-27, US-48) — chỉ cho nông trại của chính mình. */
  openInbox(): void {
    if (!this.farmReady() || this.isVisiting()) return;
    this.inboxOpen.set(true);
  }

  closeInbox(): void {
    this.inboxOpen.set(false);
  }

  /** Hộp thư vừa đánh dấu đã xem — làm mới `inbox_new_count` trên HUD ngay, không chờ tải lại `/me`. */
  onInboxMarkedRead(): void {
    const me = this.store.me();
    if (me && me.inbox_new_count !== 0) {
      this.store.patchInboxNewCount(0);
    }
  }

  /** Mở bảng xếp hạng (US-28) — chỉ cho nông trại của chính mình. */
  openLeaderboard(): void {
    if (!this.farmReady() || this.isVisiting()) return;
    this.leaderboardOpen.set(true);
  }

  closeLeaderboard(): void {
    this.leaderboardOpen.set(false);
  }

  // ---------------------------------------------------------------------------
  // Ghé thăm nông trại đồng nghiệp (US-8, US-26, US-27, BR-21)
  // ---------------------------------------------------------------------------

  /** Mở danh sách tìm/lọc đồng nghiệp để ghé thăm (US-26). */
  openVisitBrowser(): void {
    if (!this.farmReady() || this.isVisiting()) return;
    this.visitBrowserOpen.set(true);
  }

  closeVisitBrowser(): void {
    this.visitBrowserOpen.set(false);
  }

  /**
   * Nhân viên chọn một đồng nghiệp trong danh sách: tải `GET /farms/:userId` rồi đưa
   * nông trại đó vào store ở chế độ chỉ xem. Đồng nghiệp chưa có nông trại thì không mở
   * khung nông trại và không cho hành động giúp đỡ (US-26).
   */
  async onVisitSelected(selection: VisitSelection): Promise<void> {
    this.visitLoading.set(true);
    this.visitError.set(null);
    try {
      const visit = await firstValueFrom(this.api.getFarmVisit(selection.userId));
      this.closeVisitBrowser();
      const target: FarmVisitTarget = {
        user_id: visit.owner.user_id,
        full_name: visit.owner.full_name,
        farm_name: visit.owner.farm_name,
        department_name: visit.owner.department_name,
        seniority_months: visit.owner.seniority.total_months,
        is_anniversary_today: visit.is_anniversary_today,
        anniversary_years: visit.anniversary_years,
      };
      this.visitHasFarm.set(visit.has_farm);
      this.visitHelp.set(visit.help);
      this.visitOwner.set(visit.owner);
      this.store.enterVisit(target, visit.state);
      this.analytics.trackAppUsage('ocb-farm', 'farm_action', { command: 'VISIT_FARM' });
    } catch (err: unknown) {
      this.toast.error('Không mở được nông trại của đồng nghiệp. Vui lòng thử lại.');
      console.warn('[ocb-farm] Không tải được nông trại ghé thăm.', err);
    } finally {
      this.visitLoading.set(false);
    }
  }

  /** Thoát ghé thăm, quay về nông trại của chính mình (US-26). */
  exitVisit(): void {
    this.store.exitVisit();
    this.visitHasFarm.set(true);
    this.visitHelp.set(null);
    this.visitOwner.set(null);
    this.treePanelOpen.set(false);
  }

  /** Giúp thành công: cập nhật lại lượt giúp còn lại để nút chuyển trạng thái ngay (US-27). */
  onVisitHelped(event: { action: HelpActionType; help: FarmHelpAvailability }): void {
    this.visitHelp.set(event.help);
    this.analytics.trackAppUsage('ocb-farm', 'farm_action', { command: `HELP_${event.action.toUpperCase()}` });
  }

  /** Lời chúc gửi thành công (US-8). */
  onVisitGreeted(): void {
    this.analytics.trackAppUsage('ocb-farm', 'farm_action', { command: 'SEND_GREETING' });
  }

  /** Mở cài đặt âm thanh, khoá cảnh và chất lượng đồ hoạ (US-30, US-32, US-36). */
  openSettings(): void {
    if (!this.farmReady()) return;
    this.settingsOpen.set(true);
  }

  closeSettings(): void {
    this.settingsOpen.set(false);
  }

  // ---------------------------------------------------------------------------
  // Kho & bán sản phẩm (US-13, US-14, US-20, US-22)
  // ---------------------------------------------------------------------------

  readonly inventoryOpen = signal(false);
  readonly inventorySelling = signal(false);
  readonly inventoryRefreshing = signal(false);
  readonly inventoryError = signal<string | null>(null);
  readonly inventoryNotice = signal<string | null>(null);
  readonly canSellInventory = computed(() => this.canAct() && !this.inventorySelling());

  openInventory(): void {
    if (!this.farmReady() || this.isVisiting()) return;
    this.inventoryError.set(null);
    this.inventoryNotice.set(null);
    this.inventoryOpen.set(true);
  }

  closeInventory(): void {
    this.inventoryOpen.set(false);
    this.inventoryError.set(null);
    this.inventoryNotice.set(null);
  }

  /** Tải lại `/me` để kho hiển thị đúng số lượng mới nhất (ví dụ đã bán ở thiết bị khác). */
  async refreshInventory(notice: string | null = null): Promise<void> {
    if (this.inventoryRefreshing()) return;
    this.inventoryRefreshing.set(true);
    try {
      const ok = await this.store.load();
      if (ok) {
        this.inventoryNotice.set(notice ?? 'Đã làm mới kho theo dữ liệu mới nhất.');
      } else {
        this.inventoryError.set(this.store.error()?.message ?? 'Không làm mới được kho, vui lòng thử lại.');
        this.store.clearError();
      }
    } finally {
      this.inventoryRefreshing.set(false);
    }
  }

  /**
   * Gửi `SELL_PRODUCT` kèm `expected_quantity` (số lượng kho đang hiển thị). Cập nhật lạc
   * quan để số dư và kho đổi ngay; server từ chối thì store tự hoàn tác. Số lượng đã đổi
   * ở thiết bị khác (`QUANTITY_CHANGED` / xung đột phiên bản) → làm mới kho và báo lý do.
   */
  async sellFromInventory(sale: InventorySale): Promise<void> {
    if (!this.canSellInventory()) return;
    this.inventoryError.set(null);
    this.inventoryNotice.set(null);
    this.inventorySelling.set(true);
    const optimistic = (s: { state: FarmStateJson; balance: number }) => {
      const current = s.state.storage[sale.product] ?? 0;
      return {
        state: { ...s.state, storage: { ...s.state.storage, [sale.product]: Math.max(0, current - sale.quantity) } },
        balance: s.balance + sale.preview.total,
      };
    };
    try {
      const result = await this.store.dispatch(
        'SELL_PRODUCT',
        { product: sale.product, quantity: sale.quantity, expected_quantity: sale.expectedQuantity },
        { optimistic, label: `Bán ${sale.quantity} ${sale.label}` },
      );
      if (result.ok) {
        const notice = result.notices.find((n) => n.code === 'SELL_PRODUCT_BREAKDOWN');
        this.afterAction(
          result,
          'SELL_PRODUCT',
          notice?.message ?? `Đã bán ${sale.quantity} ${sale.label}, nhận ${sale.preview.total} Hạt OCB.`,
        );
        return;
      }
      // Kho là hộp thoại phủ trên alert lỗi chung → hiển thị lỗi ngay trong kho.
      this.store.clearError();
      const changedMsg =
        'Số lượng trong kho đã thay đổi so với lúc bạn mở kho (có thể đã bán ở thiết bị khác). ' +
        'Lượt bán chưa được thực hiện, kho đã được làm mới — vui lòng kiểm tra lại.';
      if (result.error.code === 'QUANTITY_CHANGED') {
        await this.refreshInventory(changedMsg);
      } else if (result.error.kind === 'conflict') {
        // 409: store đã nhận state mới nhất từ server.
        this.inventoryNotice.set(changedMsg);
      } else {
        this.inventoryError.set(result.error.message);
      }
    } finally {
      this.inventorySelling.set(false);
    }
  }

  /** Mở bảng thành tựu và chọn huy hiệu hiển thị (US-29) — chỉ cho nông trại của chính mình. */
  openBadges(): void {
    if (!this.farmReady() || this.isVisiting()) return;
    this.achievementsOpen.set(true);
  }

  closeBadges(): void {
    this.achievementsOpen.set(false);
  }

  /** Lỗi thao tác hiển thị qua `actionError` (kèm danh sách thao tác bị huỷ) nên không toast lại. */
  private afterAction(result: DispatchResult, command: string, successMessage: string): void {
    if (!result.ok) return;
    this.analytics.trackAppUsage('ocb-farm', 'farm_action', { command });
    this.toast.success(successMessage);
    for (const a of result.achievements) {
      this.toast.success(`Mở khoá thành tựu: ${a.name}`);
    }
  }
}
