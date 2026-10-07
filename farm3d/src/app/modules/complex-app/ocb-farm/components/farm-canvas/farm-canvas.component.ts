import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MAX_ZOOM, MIN_ZOOM, QuarterTurn } from '../../scene/farm-scene-math';
import { provideAssetLoaderFarmProvider } from '../../scene/asset-loader-provider';
import {
  FarmPickResult,
  FarmSceneService,
  FarmTreeRenderOptions,
  canManipulate,
} from '../../services/farm-scene.service';
import { FarmStateStore } from '../../services/farm-state.store';
import { FarmEnvironmentService } from '../../services/farm-environment.service';
import { FullscreenService } from '../../services/fullscreen.service';
import { SnapshotButtonComponent } from '../snapshot-button/snapshot-button.component';
import type { FarmEffectKind, FarmEntityMarker } from '../../scene/entity-markers';
import type { FarmCellRef } from '../../models/ocb-farm.model';

/** Yêu cầu phát hiệu ứng thao tác trên một ô. */
export interface FarmCanvasEffect {
  cells: readonly FarmCellRef[];
  kind: FarmEffectKind;
  seq: number;
}

/** Sự kiện chạm/nhấp trên khung 3D gửi cho container (menu tương tác ở 13.6). */
export interface FarmCanvasTap {
  pick: FarmPickResult | null;
  clientX: number;
  clientY: number;
  /**
   * Được mở thao tác di chuyển/bán/xoá hay không: chỉ `true` với vật nuôi / cây / trang trí
   * trên nông trại của chính mình. Cây OCB luôn `false` (BR-1); chế độ ghé thăm luôn `false`.
   */
  actionsAllowed: boolean;
}

interface RotateButton {
  turn: QuarterTurn;
  label: string;
  degrees: number;
}

const ROTATE_BUTTONS: readonly RotateButton[] = [
  { turn: 0, degrees: 0, label: 'Góc nhìn mặc định (0°)' },
  { turn: 1, degrees: 90, label: 'Xoay góc nhìn 90°' },
  { turn: 2, degrees: 180, label: 'Xoay góc nhìn 180°' },
  { turn: 3, degrees: 270, label: 'Xoay góc nhìn 270°' },
];

/** Bước kéo bằng phím mũi tên (px màn hình) và hệ số phóng của nút / phím +/−. */
const KEY_PAN_PX = 48;
/** 1.4 → khoảng 8–10 lần bấm từ toàn cảnh tới cận cảnh một vật nuôi. */
const ZOOM_STEP = 1.4;
const ZOOM_EPS = 1e-3;

const ENTITY_LABELS: Record<'animal' | 'plant' | 'decor', string> = {
  animal: 'vật nuôi',
  plant: 'cây trồng',
  decor: 'vật trang trí',
};

/** Nhãn tiếng Việt theo mã vật thể cố định (`fixtureKind`) — hiện chỉ có nhà kho. */
const FIXTURE_LABELS: Record<string, string> = {
  warehouse: 'Nhà kho',
};

/**
 * OCB Farm — host khung 3D (task 11.5).
 *
 * - Sở hữu `FarmSceneService` (một WebGL context / khung) và đăng ký `FARM_ASSET_PROVIDER`
 *   từ `AssetLoaderService` → vật thể dùng mô hình thật, tải lỗi thì khối hộp fallback.
 * - Đồng bộ cảnh theo state hiển thị (gồm cập nhật lạc quan) của `FarmStateStore`.
 * - Cử chỉ: kéo để di chuyển, cuộn / chụm hai ngón để phóng, chạm để chọn (trong service);
 *   `touch-action: none` trên vùng khung để cử chỉ không cuộn / phóng trang (US-38).
 * - Điều khiển cốt lõi (4 nút xoay 90°, phóng to/nhỏ, về giữa) là `.btn` ≥ 44×44 px, có
 *   nhãn tiếng Việt; bàn phím: mũi tên di chuyển, +/− phóng, Q/E xoay, 0 về giữa.
 * - Chạm vào Cây OCB không bao giờ mở thao tác di chuyển/bán/xoá (BR-1).
 *
 * _Requirements: US-36, US-38_
 */
@Component({
  selector: 'app-farm-canvas',
  templateUrl: './farm-canvas.component.html',
  styleUrl: './farm-canvas.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SnapshotButtonComponent],
  providers: [FarmSceneService, FarmEnvironmentService, provideAssetLoaderFarmProvider()],
})
export class FarmCanvasComponent {
  private readonly scene = inject(FarmSceneService);
  private readonly store = inject(FarmStateStore);
  private readonly environment = inject(FarmEnvironmentService);
  private readonly fullscreen = inject(FullscreenService);
  private readonly hostRef = inject(ElementRef<HTMLElement>);

  /** Tắt cử chỉ/điều khiển (ví dụ khi hộp thoại đang mở). */
  readonly interactive = input(true);

  /** Năm vào làm (năm tượng trưng của nhánh) + ra hoa kết quả ngày kỷ niệm (US-6, US-7). */
  readonly treeOptions = input<FarmTreeRenderOptions | null>(null);

  /** Dấu hiệu sẵn sàng thu hoạch / thiếu nước / buồn trên vật thể (task 13.6). */
  readonly markers = input<readonly FarmEntityMarker[]>([]);
  /** Ô của vật thể đang mở menu — vẽ vòng chọn. */
  readonly selectionCell = input<FarmCellRef | null>(null);
  /** Ô đích hợp lệ khi đang di chuyển vật thể. */
  readonly moveTargets = input<readonly FarmCellRef[]>([]);
  /** Hiệu ứng thao tác (`seq` tăng dần để phát lại cùng một ô). */
  readonly effectEvent = input<FarmCanvasEffect | null>(null);

  /** Chạm/nhấp lên khung 3D (đã raycast) — container mở menu tương ứng. */
  readonly tapped = output<FarmCanvasTap>();
  /** Phát khi nhân viên tương tác (chạm/kéo/cuộn) trong lúc Cinema_Mode đang chạy (AC 2.5). */
  readonly cinemaInterrupted = output<void>();

  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  readonly rotateButtons = ROTATE_BUTTONS;
  private readonly destroyRef = inject(DestroyRef);
  private readonly contextLost = signal(false);
  private contextListenersBound = false;

  readonly ready = this.scene.ready;
  /** Lỗi khởi tạo WebGL hoặc mất context đồ hoạ — hiển thị `.alert` thay cho khung 3D. */
  readonly error = computed(
    () =>
      this.scene.error() ??
      (this.contextLost()
        ? 'Khung hình 3D bị gián đoạn do trình duyệt thu hồi bộ nhớ đồ hoạ. Hệ thống sẽ tự khôi phục, hoặc bấm Thử lại.'
        : null),
  );
  readonly quarterTurn = this.scene.quarterTurn;
  readonly canZoomIn = computed(() => this.scene.zoom() < Math.min(MAX_ZOOM, this.scene.maxZoom()) - ZOOM_EPS);
  readonly canZoomOut = computed(() => this.scene.zoom() > MIN_ZOOM + ZOOM_EPS);
  readonly controlsDisabled = computed(() => !this.ready() || !this.interactive());
  readonly zoomPercent = computed(() => Math.round(this.scene.zoom() * 100));

  /** Fullscreen_Mode (task 15) — `.farm-stage` (component cha) là phần tử fullscreen (AC 1.1, 1.2, 1.5). */
  readonly isFullscreen = this.fullscreen.active;
  /** Trình duyệt từ chối/không hỗ trợ Fullscreen API (AC 1.4). */
  readonly fullscreenUnsupported = this.fullscreen.unsupported;

  /** Thông báo cho trình đọc màn hình về vật vừa chọn. */
  readonly selectionMessage = signal('');

  constructor() {
    // Cảnh theo state hiển thị của store. `untracked`: dựng cảnh đọc signal của bộ nạp mô
    // hình — không để effect này phụ thuộc vào chúng (provider tự báo qua `revision`).
    effect(() => {
      const state = this.store.state();
      untracked(() => this.scene.setState(state));
    });

    effect(() => {
      const opts = this.treeOptions();
      if (opts) untracked(() => this.scene.setTreeOptions(opts));
    });

    // Ngày/đêm (đã áp khoá cảnh), thời tiết, chủ đề dịp lễ — thuần hiển thị (US-30/31/33).
    effect(() => {
      const env = this.environment.input();
      if (env) untracked(() => this.scene.setEnvironment(env));
    });

    // Dấu hiệu trạng thái, vòng chọn, ô đích di chuyển, hiệu ứng thao tác (task 13.6).
    effect(() => {
      const markers = this.markers();
      untracked(() => this.scene.setEntityMarkers(markers));
    });
    effect(() => {
      const cell = this.selectionCell();
      untracked(() => this.scene.setSelection(cell));
    });
    effect(() => {
      const cells = this.moveTargets();
      untracked(() => this.scene.setMoveTargets(cells));
    });
    effect(() => {
      const fx = this.effectEvent();
      if (fx) untracked(() => fx.cells.forEach((cell) => this.scene.playEffect(cell, fx.kind)));
    });

    // Chạm trên khung → phát sự kiện cho container.
    effect(() => {
      const tap = this.scene.lastTap();
      if (!tap) return;
      untracked(() => this.handleTap(tap.pick, tap.clientX, tap.clientY));
    });

    // Cinema_Mode bị gián đoạn bởi tương tác chuột/cảm ứng (AC 2.5) — service phát qua
    // callback (listener pointerdown/wheel nằm trong `FarmSceneService.attachControls`).
    this.scene.setCinemaInterruptedHandler(() => this.cinemaInterrupted.emit());
    this.destroyRef.onDestroy(() => this.scene.setCinemaInterruptedHandler(null));

    // Đồng bộ class `.farm-stage-fullscreen` trên `.farm-stage` (ancestor, component cha)
    // theo `FullscreenService.active()` — nguồn chân lý duy nhất là `fullscreenchange`
    // (AC 1.6: mọi đường thoát, kể cả Esc do OS/chuyển app, đều tự đồng bộ qua đây).
    effect(() => {
      const active = this.isFullscreen();
      untracked(() => {
        const stage = this.hostRef.nativeElement.closest('.farm-stage') as HTMLElement | null;
        stage?.classList.toggle('farm-stage-fullscreen', active);
      });
    });

    // `FarmSceneService` theo component nên tự `dispose()` khi host bị huỷ.
    afterNextRender(() => this.initScene());
  }

  // ---------------------------------------------------------------------------
  // Điều khiển
  // ---------------------------------------------------------------------------

  setTurn(turn: QuarterTurn): void {
    if (this.controlsDisabled()) return;
    this.scene.setQuarterTurn(turn);
  }

  // ---------------------------------------------------------------------------
  // Cinema_Mode (task 17.2) — `FarmSceneService` sống trong `providers` của component
  // này (một WebGL context riêng mỗi `app-farm-canvas`), nên container (`ocb-farm-main`)
  // không `inject()` được trực tiếp — phải đi qua cầu nối công khai này bằng `viewChild`.
  // ---------------------------------------------------------------------------

  /** Bật Cinema_Camera_Controller trên scene của khung 3D này (AC 2.1). */
  enterCinemaMode(): void {
    this.scene.enterCinemaMode();
  }

  /** Tắt Cinema_Camera_Controller, camera giữ nguyên vị trí hiện tại (AC 2.6). */
  exitCinemaMode(): void {
    this.scene.exitCinemaMode();
  }

  zoomIn(): void {
    if (!this.controlsDisabled()) this.scene.zoomBy(ZOOM_STEP);
  }

  zoomOut(): void {
    if (!this.controlsDisabled()) this.scene.zoomBy(1 / ZOOM_STEP);
  }

  resetView(): void {
    if (!this.controlsDisabled()) this.scene.resetView();
  }

  /** Thử khởi tạo lại WebGL (sau khi bật tăng tốc phần cứng / mất context). */
  retryInit(): void {
    this.initScene();
  }

  /**
   * Bật Fullscreen_Mode trên `.farm-stage` (component cha bọc HUD + khung 3D), không phải
   * trên `<canvas>` riêng — theo quyết định kiến trúc ở design.md mục 1 (AC 1.1).
   */
  async enterFullscreen(): Promise<void> {
    const stage = this.hostRef.nativeElement.closest('.farm-stage') as HTMLElement | null;
    if (!stage) return;
    await this.fullscreen.enter(stage);
  }

  /** Thoát Fullscreen_Mode qua nút thoát duy nhất hiển thị trong `.farm-stage` (AC 1.3). */
  async exitFullscreen(): Promise<void> {
    await this.fullscreen.exit();
  }

  onKeydown(event: KeyboardEvent): void {
    if (this.controlsDisabled() || event.altKey || event.ctrlKey || event.metaKey) return;
    let handled = true;
    switch (event.key) {
      case 'ArrowLeft':
        this.scene.panBy(KEY_PAN_PX, 0);
        break;
      case 'ArrowRight':
        this.scene.panBy(-KEY_PAN_PX, 0);
        break;
      case 'ArrowUp':
        this.scene.panBy(0, KEY_PAN_PX);
        break;
      case 'ArrowDown':
        this.scene.panBy(0, -KEY_PAN_PX);
        break;
      case '+':
      case '=':
        this.scene.zoomBy(ZOOM_STEP);
        break;
      case '-':
      case '_':
        this.scene.zoomBy(1 / ZOOM_STEP);
        break;
      case 'q':
      case 'Q':
        this.scene.rotate('ccw');
        break;
      case 'e':
      case 'E':
        this.scene.rotate('cw');
        break;
      case '0':
      case 'Home':
        this.scene.resetView();
        break;
      default:
        handled = false;
    }
    if (handled) event.preventDefault();
  }

  // ---------------------------------------------------------------------------
  // Nội bộ
  // ---------------------------------------------------------------------------

  private initScene(): void {
    const canvas = this.canvasRef().nativeElement;
    if (!this.contextListenersBound) {
      this.contextListenersBound = true;
      const onLost = (e: Event): void => {
        // Cho phép trình duyệt khôi phục context; trong lúc chờ hiện thông báo kèm thử lại.
        e.preventDefault();
        this.scene.dispose();
        this.contextLost.set(true);
      };
      const onRestored = (): void => this.initScene();
      canvas.addEventListener('webglcontextlost', onLost);
      canvas.addEventListener('webglcontextrestored', onRestored);
      this.destroyRef.onDestroy(() => {
        canvas.removeEventListener('webglcontextlost', onLost);
        canvas.removeEventListener('webglcontextrestored', onRestored);
      });
    }
    if (this.scene.init(canvas, { controls: true })) this.contextLost.set(false);
  }

  private handleTap(pick: FarmPickResult | null, clientX: number, clientY: number): void {
    if (!this.interactive()) return;
    // BR-1: Cây OCB (`kind: 'tree'`) không bao giờ được mở thao tác; ghé thăm chỉ xem.
    const actionsAllowed = canManipulate(pick) && !this.store.isVisiting();
    this.selectionMessage.set(this.describe(pick));
    this.tapped.emit({ pick, clientX, clientY, actionsAllowed });
  }

  private describe(pick: FarmPickResult | null): string {
    if (!pick) return 'Không chọn vật thể nào.';
    switch (pick.kind) {
      case 'tree':
        if (pick.branch) {
          const year = pick.branch.calendarYear !== null ? `, tượng trưng năm ${pick.branch.calendarYear}` : '';
          return `Đã chọn nhánh thứ ${pick.branch.index + 1} của Cây OCB${year}, năm gắn bó thứ ${pick.branch.tenureYear}.`;
        }
        return 'Đã chọn Cây OCB. Cây OCB cố định ở trung tâm, chỉ xem, không thể di chuyển, bán hoặc xoá.';
      case 'entity':
        return `Đã chọn ${ENTITY_LABELS[pick.entityKind]} ở ô ${pick.cell}.`;
      case 'cell':
        if (!pick.unlocked) return `Ô ${pick.cell} chưa được mở.`;
        return pick.terrain === 'water' ? `Đã chọn ô ao nước ${pick.cell}.` : `Đã chọn ô đất ${pick.cell}.`;
      case 'fixture':
        return `Đã chọn ${FIXTURE_LABELS[pick.fixtureKind] ?? pick.fixtureKind}. Bấm để mở.`;
    }
  }

}
