import { DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { AnalyticsService } from '../../../../../core/services/analytics.service';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import type {
  FarmCellRef,
  FarmCommandCode,
  FarmCommandPayloadMap,
  FarmStateJson,
  FarmStorage,
} from '../../models/ocb-farm.model';
import { DispatchResult, FarmOptimisticPatch, FarmStateStore } from '../../services/farm-state.store';
import { SoundService } from '../../services/sound.service';
import type { FarmEffectKind } from '../../scene/entity-markers';
import type { FarmCanvasEffect, FarmCanvasTap } from '../farm-canvas/farm-canvas.component';
import { formatSeeds } from '../shop-panel/shop-catalog';
import {
  BulkActionId,
  EntityActionId,
  EntityDetail,
  EntityRef,
  FULLNESS_MAX,
  FarmConfigValues,
  FarmStatusContext,
  bulkSummary,
  describeEntity,
  entityMarkers,
  harvestResultRows,
  moveBlockReason,
  moveTargets,
  nextRotation,
  plantStatus,
  withEntityMoved,
} from './entity-actions';
import type { FarmConfirmContent, FarmConfirmResult } from './farm-confirm-dialog.component';

/** Chu kỳ cập nhật đếm ngược và dấu hiệu trạng thái. */
const STATUS_TICK_MS = 1000;

interface Selection {
  ref: EntityRef;
  clientX: number;
  clientY: number;
}

interface MoveMode {
  ref: EntityRef;
  fromCell: FarmCellRef;
  label: string;
}

type ConfirmState =
  | { kind: 'bulk'; id: BulkActionId }
  | { kind: 'sell'; ref: EntityRef; detail: EntityDetail };

export interface FarmInteractionHost {
  /** Giá trị `farm_config` đang áp dụng. */
  values: () => FarmConfigValues;
  /** Container cho phép gửi lệnh ghi (sẵn sàng, không ghé thăm, có mạng, không bận). */
  canAct: () => boolean;
}

const BULK_TITLES: Record<BulkActionId, { title: string; icon: string; command: FarmCommandCode }> = {
  feed_all: { title: 'Cho ăn tất cả', icon: 'bi bi-basket2', command: 'FEED_ALL' },
  water_all: { title: 'Tưới tất cả', icon: 'bi bi-droplet', command: 'WATER_ALL' },
  harvest_all: { title: 'Thu hoạch tất cả', icon: 'bi bi-basket', command: 'HARVEST_ALL' },
};

/**
 * OCB Farm — điều phối tương tác vật nuôi / cây trồng / trang trí trên khung 3D (task 13.6).
 *
 * Tách khỏi `ocb-farm-main` để container chỉ nối dây: chạm vật thể → menu; di chuyển chọn
 * ô đích (sai → nêu lý do, giữ vị trí); thao tác hàng loạt và bán qua hộp xác nhận; dấu
 * hiệu 3D và đếm ngược cập nhật mỗi giây. Lệnh gửi qua `FarmStateStore`.
 *
 * Tạo trong field initializer của container (ngữ cảnh inject của component).
 *
 * _Requirements: US-11, US-12, US-13, US-15, US-17, US-18, US-19, US-20, US-34_
 */
export class FarmInteractionController {
  private readonly store = inject(FarmStateStore);
  private readonly toast = inject(ToastService);
  private readonly analytics = inject(AnalyticsService);
  private readonly sound = inject(SoundService);

  /** Đồng hồ hiển thị đã hiệu chỉnh lệch giờ theo `server_time` của lần tải gần nhất. */
  private readonly clockOffsetMs = signal(0);
  private readonly tick = signal(Date.now());
  readonly nowMs = computed(() => this.tick() + this.clockOffsetMs());
  /** Thời điểm state client khớp với lần server tick gần nhất. */
  private readonly syncedAtMs = signal(Date.now());

  private readonly selection = signal<Selection | null>(null);
  readonly moveMode = signal<MoveMode | null>(null);
  readonly moveError = signal<string | null>(null);
  readonly busyAction = signal<EntityActionId | null>(null);
  readonly menuError = signal<string | null>(null);

  private readonly confirmState = signal<ConfirmState | null>(null);
  readonly confirmBusy = signal(false);
  readonly confirmError = signal<string | null>(null);
  readonly confirmResult = signal<FarmConfirmResult | null>(null);

  private fxSeq = 0;
  readonly effectEvent = signal<FarmCanvasEffect | null>(null);

  readonly ctx = computed<FarmStatusContext>(() => ({
    values: this.host.values(),
    balance: this.store.balance(),
    nowMs: this.nowMs(),
    syncedAtMs: this.syncedAtMs() + this.clockOffsetMs(),
    raining: this.store.me()?.environment.weather === 'rainy',
  }));

  readonly detail = computed(() => {
    const sel = this.selection();
    return sel ? describeEntity(this.store.state(), sel.ref, this.ctx()) : null;
  });
  readonly menuPosition = computed(() => {
    const sel = this.selection();
    return { x: sel?.clientX ?? 0, y: sel?.clientY ?? 0 };
  });
  readonly menuOpen = computed(
    () => this.detail() !== null && this.moveMode() === null && this.confirmState() === null,
  );

  readonly markers = computed(() => entityMarkers(this.store.state(), this.ctx()));
  readonly selectionCell = computed(() => this.moveMode()?.fromCell ?? this.detail()?.cell ?? null);
  readonly moveTargetCells = computed(() => {
    const mode = this.moveMode();
    return mode ? moveTargets(this.store.state(), mode.ref, mode.fromCell) : [];
  });

  readonly feedAll = computed(() => bulkSummary('feed_all', this.store.state(), this.ctx()));
  readonly waterAll = computed(() => bulkSummary('water_all', this.store.state(), this.ctx()));
  readonly harvestAll = computed(() => bulkSummary('harvest_all', this.store.state(), this.ctx()));

  /** Nút thao tác hàng loạt ở thanh công cụ (số lượng + lý do vô hiệu hoá). */
  readonly bulkButtons = computed(() => [
    { id: 'feed_all' as const, label: 'Cho ăn tất cả', icon: 'bi bi-basket2', testId: 'farm-feed-all', s: this.feedAll() },
    { id: 'water_all' as const, label: 'Tưới tất cả', icon: 'bi bi-droplet', testId: 'farm-water-all', s: this.waterAll() },
    { id: 'harvest_all' as const, label: 'Thu hoạch tất cả', icon: 'bi bi-basket', testId: 'farm-harvest-all', s: this.harvestAll() },
  ]);

  /** Hộp xác nhận đang mở — khoá cử chỉ trên khung 3D. */
  readonly blocking = computed(() => this.confirmState() !== null);

  readonly confirmContent = computed<FarmConfirmContent | null>(() => {
    const c = this.confirmState();
    if (!c) return null;
    if (c.kind === 'sell') return this.sellContent(c.detail);
    return this.bulkContent(c.id);
  });
  readonly confirmCanSubmit = computed(() => {
    const c = this.confirmState();
    if (!c || !this.host.canAct()) return false;
    return c.kind === 'sell' || this.summaryOf(c.id).disabledReason === null;
  });

  constructor(private readonly host: FarmInteractionHost) {
    const timer = setInterval(() => this.tick.set(Date.now()), STATUS_TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));

    // Mỗi lần nhận state mới từ server (tải `/me` hoặc lệnh thành công) → mốc đồng bộ mới.
    effect(() => {
      const me = this.store.me();
      this.store.version();
      untracked(() => {
        const now = Date.now();
        this.syncedAtMs.set(now);
        const serverMs = me ? Date.parse(me.server_time) : NaN;
        if (Number.isFinite(serverMs)) this.clockOffsetMs.set(serverMs - now);
      });
    });

    // Vật thể đã mất (bán / hoa thu hoạch xong) → đóng menu.
    effect(() => {
      if (this.selection() && this.detail() === null) untracked(() => this.closeMenu());
    });
  }

  // ---------------------------------------------------------------------------
  // Chạm trên khung 3D
  // ---------------------------------------------------------------------------

  /**
   * Xử lý chạm. Trả `true` khi đã dùng chạm (container bỏ qua): đang chọn ô đích di chuyển,
   * hoặc mở menu vật thể. Chạm Cây OCB / ô trống / khoảng trống → đóng menu, trả `false`.
   */
  handleTap(tap: FarmCanvasTap): boolean {
    const mode = this.moveMode();
    if (mode) {
      this.tryMove(mode, tap);
      return true;
    }
    const pick = tap.pick;
    if (pick?.kind === 'entity' && tap.actionsAllowed) {
      this.menuError.set(null);
      this.selection.set({ ref: { entityKind: pick.entityKind, id: pick.id }, clientX: tap.clientX, clientY: tap.clientY });
      return true;
    }
    this.closeMenu();
    return false;
  }

  closeMenu(): void {
    if (this.busyAction()) return;
    this.selection.set(null);
    this.menuError.set(null);
  }

  cancelMove(): void {
    this.moveMode.set(null);
    this.moveError.set(null);
  }

  // ---------------------------------------------------------------------------
  // Thao tác trên một vật thể
  // ---------------------------------------------------------------------------

  async runAction(id: EntityActionId): Promise<void> {
    const d = this.detail();
    if (!d || !this.host.canAct() || this.busyAction()) return;
    const action = d.actions.find((a) => a.id === id);
    if (!action || action.disabledReason) return;
    const { ref } = d;
    const now = new Date(this.nowMs()).toISOString();

    switch (id) {
      case 'move':
        this.moveError.set(null);
        this.moveMode.set({ ref, fromCell: d.cell, label: d.title });
        return;
      case 'sell':
        this.openConfirm({ kind: 'sell', ref, detail: d });
        return;
      case 'feed': {
        const cost = d.animal?.feedCost ?? 0;
        await this.runEntity(id, 'FEED_ANIMAL', { animal_id: ref.id }, d, 'happy', `Đã cho ${d.title} ăn.`, (s) => ({
          balance: s.balance - cost,
          state: {
            ...s.state,
            animals: s.state.animals.map((a) => (a.id === ref.id ? { ...a, fullness: FULLNESS_MAX, fed_at: now } : a)),
          },
        }));
        return;
      }
      case 'harvest':
        if (ref.entityKind === 'animal') {
          await this.runEntity(id, 'HARVEST_ANIMAL', { animal_id: ref.id }, d, 'harvest', `Đã thu hoạch ${d.animal?.productLabel ?? 'sản phẩm'} vào kho.`);
        } else {
          await this.runEntity(id, 'HARVEST_PLANT', { plant_id: ref.id }, d, 'harvest', `Đã thu hoạch ${d.plant?.productLabel ?? 'sản phẩm'} vào kho.`);
        }
        return;
      case 'water':
        await this.runEntity(id, 'WATER_PLANT', { plant_id: ref.id }, d, 'water', `Đã tưới ${d.title}.`, (s) => ({
          ...s,
          state: { ...s.state, plants: s.state.plants.map((p) => (p.id === ref.id ? { ...p, watered_at: now } : p)) },
        }));
        return;
      case 'fertilize':
        await this.runEntity(id, 'FERTILIZE_PLANT', { plant_id: ref.id }, d, 'happy', `Đã bón phân cho ${d.title}.`);
        return;
      case 'potion': {
        const cost = action.cost ?? 0;
        await this.runEntity(id, 'USE_GROWTH_POTION', { animal_id: ref.id }, d, 'harvest', `${d.title} đã cho sản phẩm ngay nhờ thuốc tăng trưởng.`, (s) => ({
          balance: s.balance - cost,
          state: {
            ...s.state,
            animals: s.state.animals.map((a) =>
              a.id === ref.id ? { ...a, pending: a.pending + 1, fullness: FULLNESS_MAX, fed_at: now, cycle_started_at: now } : a,
            ),
          },
        }));
        return;
      }
      case 'superFertilize': {
        const cost = action.cost ?? 0;
        await this.runEntity(id, 'USE_SUPER_FERTILIZER', { plant_id: ref.id }, d, 'happy', `${d.title} đã lớn vượt bậc nhờ phân bón siêu cấp.`, (s) => ({
          ...s,
          balance: s.balance - cost,
        }));
        return;
      }
      case 'rotate': {
        const rotation = nextRotation(d.decor?.rotation ?? 0);
        await this.runEntity(id, 'ROTATE_DECOR', { decor_id: ref.id, rotation }, d, null, `Đã xoay ${d.title} sang ${rotation}°.`, (s) => ({
          ...s,
          state: { ...s.state, decors: s.state.decors.map((x) => (x.id === ref.id ? { ...x, rotation } : x)) },
        }));
        return;
      }
    }
  }

  private async runEntity<C extends FarmCommandCode>(
    id: EntityActionId,
    command: C,
    payload: FarmCommandPayloadMap[C],
    d: EntityDetail,
    fx: FarmEffectKind | null,
    successMessage: string,
    optimistic?: FarmOptimisticPatch,
  ): Promise<void> {
    this.menuError.set(null);
    this.busyAction.set(id);
    try {
      const result = await this.store.dispatch(command, payload, optimistic ? { optimistic } : {});
      if (result.ok) {
        if (fx) this.playEffect(d.cell, fx);
        this.playSound(command, d);
        this.afterSuccess(result, command, successMessage);
      } else {
        // Menu nổi phía trên alert chung → hiển thị lỗi ngay trong menu.
        this.menuError.set(result.error.message);
        this.store.clearError();
      }
    } finally {
      this.busyAction.set(null);
    }
  }

  private async tryMove(mode: MoveMode, tap: FarmCanvasTap): Promise<void> {
    const state = this.store.state();
    const pick = tap.pick;
    if (!state || !pick) {
      this.moveError.set('Hãy chạm vào một ô trên nông trại để chọn ô đích.');
      return;
    }
    if (pick.kind === 'tree') {
      this.moveError.set('Ô trung tâm dành riêng cho Cây OCB.');
      return;
    }
    if (pick.kind === 'entity') {
      if (pick.id === mode.ref.id) {
        this.moveError.set('Đây là vị trí hiện tại — hãy chọn một ô khác.');
        return;
      }
      this.moveError.set('Ô này đã có vật nuôi, cây hoặc vật trang trí khác.');
      return;
    }
    const target = pick.cell;
    const reason = moveBlockReason(state, mode.ref, target);
    if (reason) {
      // Ô không hợp lệ → nêu lý do, giữ nguyên vị trí cũ (US-15, US-34).
      this.moveError.set(reason);
      return;
    }
    if (!this.host.canAct()) {
      this.moveError.set('Chưa thể di chuyển lúc này. Vui lòng thử lại sau.');
      return;
    }
    this.moveMode.set(null);
    this.moveError.set(null);
    this.selection.set(null);
    const result = await this.store.dispatch(
      'MOVE_ENTITY',
      { entity_kind: mode.ref.entityKind, entity_id: mode.ref.id, to_cell: target },
      { optimistic: (s) => ({ ...s, state: withEntityMoved(s.state, mode.ref, target) }) },
    );
    // Lỗi (store đã hoàn tác vị trí) hiển thị qua alert chung kèm thao tác bị huỷ.
    this.afterSuccess(result, 'MOVE_ENTITY', `Đã di chuyển ${mode.label} sang ô ${target}.`);
  }

  // ---------------------------------------------------------------------------
  // Hộp xác nhận: thao tác hàng loạt và bán
  // ---------------------------------------------------------------------------

  openBulk(id: BulkActionId): void {
    this.openConfirm({ kind: 'bulk', id });
  }

  closeConfirm(): void {
    if (this.confirmBusy()) return;
    this.confirmState.set(null);
    this.confirmError.set(null);
    this.confirmResult.set(null);
  }

  async submitConfirm(): Promise<void> {
    const c = this.confirmState();
    if (!c || !this.confirmCanSubmit() || this.confirmBusy()) return;
    this.confirmError.set(null);
    this.confirmBusy.set(true);
    try {
      if (c.kind === 'sell') await this.submitSell(c.ref, c.detail);
      else if (c.id === 'feed_all') await this.submitFeedAll();
      else if (c.id === 'water_all') await this.submitWaterAll();
      else await this.submitHarvestAll();
    } finally {
      this.confirmBusy.set(false);
    }
  }

  private openConfirm(state: ConfirmState): void {
    this.confirmError.set(null);
    this.confirmResult.set(null);
    this.confirmState.set(state);
  }

  private async submitSell(ref: EntityRef, d: EntityDetail): Promise<void> {
    const refund = d.animal?.refund ?? d.decor?.refund ?? 0;
    const optimistic: FarmOptimisticPatch = (s) => ({
      balance: s.balance + refund,
      state:
        ref.entityKind === 'animal'
          ? { ...s.state, animals: s.state.animals.filter((a) => a.id !== ref.id) }
          : { ...s.state, decors: s.state.decors.filter((x) => x.id !== ref.id) },
    });
    const result =
      ref.entityKind === 'animal'
        ? await this.store.dispatch('SELL_ANIMAL', { animal_id: ref.id }, { optimistic })
        : await this.store.dispatch('SELL_DECOR', { decor_id: ref.id }, { optimistic });
    if (!this.handleConfirmFailure(result)) return;
    this.playSound(ref.entityKind === 'animal' ? 'SELL_ANIMAL' : 'SELL_DECOR', d);
    this.selection.set(null);
    this.confirmState.set(null);
    this.afterSuccess(result, ref.entityKind === 'animal' ? 'SELL_ANIMAL' : 'SELL_DECOR', `Đã bán ${d.title}, nhận lại ${formatSeeds(refund)} Hạt OCB.`);
  }

  private async submitFeedAll(): Promise<void> {
    const summary = this.feedAll();
    const state = this.store.state();
    const result = await this.store.dispatch('FEED_ALL', {});
    if (!this.handleConfirmFailure(result)) return;
    const partial = result.notices.find((n) => n.code === 'FEED_ALL_PARTIAL');
    const fed = Number(partial?.data?.['fed_count'] ?? summary.count);
    const notFed = Number(partial?.data?.['not_fed_count'] ?? 0);
    this.playEffect((state?.animals ?? []).map((a) => a.cell), 'happy');
    this.sound.playSfx('feed');
    this.confirmResult.set({
      level: notFed > 0 ? 'warning' : 'success',
      message:
        notFed > 0
          ? 'Không đủ Hạt OCB cho toàn bộ — đã ưu tiên vật nuôi có độ no thấp nhất trước.'
          : 'Đã cho ăn toàn bộ vật nuôi đang đói.',
      rows: [
        { label: 'Đã được cho ăn', value: `${fed} vật nuôi` },
        { label: 'Chưa được cho ăn', value: `${notFed} vật nuôi` },
      ],
    });
    this.afterSuccess(result, 'FEED_ALL', null);
  }

  private async submitWaterAll(): Promise<void> {
    const before = this.store.state();
    const ctx = this.ctx();
    const thirstyCells = (before?.plants ?? []).filter((p) => plantStatus(p, ctx).thirsty).map((p) => p.cell);
    const result = await this.store.dispatch('WATER_ALL', {});
    if (!this.handleConfirmFailure(result)) return;
    const notice = result.notices.find((n) => n.code === 'RAIN_WATERED_PLANTS');
    const count = Number(notice?.data?.['watered_count'] ?? thirstyCells.length);
    this.playEffect(thirstyCells, 'water');
    this.sound.playSfx('water');
    this.confirmResult.set({
      level: 'success',
      message: `Đã tưới ${count} cây đang thiếu nước. Các cây đủ nước được bỏ qua.`,
      rows: [],
    });
    this.afterSuccess(result, 'WATER_ALL', null);
  }

  /**
   * Thu hoạch tất cả: `HARVEST_ALL` cho sản phẩm vật nuôi, rồi `HARVEST_PLANT` từng cây đang
   * sẵn sàng. Bảng tổng hợp lấy từ chênh lệch kho trước / sau (US-13, US-20).
   */
  private async submitHarvestAll(): Promise<void> {
    const summary = this.harvestAll();
    const before: FarmStorage = { ...(this.store.state()?.storage ?? {}) };
    const cells = this.harvestCells(this.store.state(), summary.readyPlantIds);
    let firstError: string | null = null;
    let anyOk = false;

    if (summary.hasAnimalProducts) {
      const r = await this.store.dispatch('HARVEST_ALL', {});
      if (r.ok) anyOk = true;
      else firstError = r.error.message;
    }
    for (const plantId of summary.readyPlantIds) {
      if (firstError && !anyOk) break;
      const r = await this.store.dispatch('HARVEST_PLANT', { plant_id: plantId });
      if (r.ok) anyOk = true;
      else {
        firstError ??= r.error.message;
        // Kho đầy → các cây còn lại cũng sẽ bị từ chối.
        if (r.error.code === 'STORAGE_FULL') break;
      }
    }
    this.store.clearError();

    if (!anyOk) {
      this.confirmError.set(firstError ?? 'Không thu hoạch được sản phẩm nào.');
      return;
    }
    const rows = harvestResultRows(before, this.store.state()?.storage ?? {});
    this.playEffect(cells, 'harvest');
    this.sound.playSfx('harvest');
    this.confirmResult.set({
      level: firstError ? 'warning' : 'success',
      message: firstError
        ? `Đã thu hoạch một phần. ${firstError}`
        : 'Đã thu hoạch toàn bộ sản phẩm sẵn sàng vào kho.',
      rows: rows.map((r) => ({ label: r.label, value: `+${r.quantity}` })),
    });
    this.analytics.trackAppUsage('ocb-farm', 'farm_action', { command: 'HARVEST_ALL' });
  }

  /** Lỗi trong hộp xác nhận hiển thị ngay trong hộp (giữ mở để thử lại hoặc huỷ). */
  private handleConfirmFailure(result: DispatchResult): result is Extract<DispatchResult, { ok: true }> {
    if (result.ok) return true;
    this.confirmError.set(result.error.message);
    this.store.clearError();
    return false;
  }

  private summaryOf(id: BulkActionId) {
    return id === 'feed_all' ? this.feedAll() : id === 'water_all' ? this.waterAll() : this.harvestAll();
  }

  private bulkContent(id: BulkActionId): FarmConfirmContent {
    const s = this.summaryOf(id);
    const meta = BULK_TITLES[id];
    const balance = this.store.balance();
    const base = { title: meta.title, icon: meta.icon, danger: false, warning: s.disabledReason };
    switch (id) {
      case 'feed_all':
        return {
          ...base,
          message: 'Cho ăn mọi vật nuôi có độ no dưới mức tối đa.',
          rows: [
            { label: 'Vật nuôi đang đói', value: `${s.count}` },
            { label: 'Tổng chi phí', value: `${formatSeeds(s.totalCost)} Hạt OCB` },
            { label: 'Số dư hiện tại', value: `${formatSeeds(balance)} Hạt OCB` },
          ],
          warning:
            s.disabledReason ??
            (s.affordableCount < s.count
              ? `Không đủ Hạt OCB cho cả ${s.count} vật nuôi — dự kiến cho ăn ${s.affordableCount} vật nuôi có độ no thấp nhất trước.`
              : null),
          confirmLabel: `Cho ăn (${formatSeeds(s.totalCost)} Hạt OCB)`,
        };
      case 'water_all':
        return {
          ...base,
          message: 'Tưới mọi cây đang thiếu nước; cây đủ nước được bỏ qua.',
          rows: [
            { label: 'Cây đang thiếu nước', value: `${s.count}` },
            { label: 'Chi phí', value: 'Miễn phí' },
          ],
          confirmLabel: 'Tưới tất cả',
        };
      case 'harvest_all':
        return {
          ...base,
          message: 'Thu toàn bộ sản phẩm đang chờ của vật nuôi và cây sẵn sàng thu hoạch.',
          rows: [
            { label: 'Đối tượng có sản phẩm', value: `${s.count}` },
            { label: 'Sản phẩm dự kiến', value: `${s.units}` },
            { label: 'Chi phí', value: 'Miễn phí' },
          ],
          confirmLabel: 'Thu hoạch tất cả',
        };
    }
  }

  private sellContent(d: EntityDetail): FarmConfirmContent {
    const refund = d.animal?.refund ?? d.decor?.refund ?? 0;
    const pending = d.animal?.status.pending ?? 0;
    return {
      title: `Bán ${d.title}`,
      icon: 'bi bi-cash-coin',
      danger: true,
      message: `Bán ${d.title} ở ô ${d.cell}? Ô sẽ trở về trạng thái trống.`,
      rows: [{ label: 'Hạt OCB hoàn lại', value: `+${formatSeeds(refund)}` }],
      warning: d.animal
        ? pending > 0
          ? `${pending} ${d.animal.productLabel ?? 'sản phẩm'} chưa thu hoạch của vật nuôi này sẽ bị mất. Hãy thu hoạch trước nếu muốn giữ.`
          : 'Các sản phẩm chưa thu hoạch (nếu có) của vật nuôi này sẽ bị mất.'
        : null,
      confirmLabel: `Bán (+${formatSeeds(refund)} Hạt OCB)`,
    };
  }

  // ---------------------------------------------------------------------------
  // Phản hồi
  // ---------------------------------------------------------------------------

  private afterSuccess(result: DispatchResult, command: FarmCommandCode, message: string | null): void {
    if (!result.ok) return;
    this.analytics.trackAppUsage('ocb-farm', 'farm_action', { command });
    if (message) this.toast.success(message);
    for (const a of result.achievements) this.toast.success(`Mở khoá thành tựu: ${a.name}`);
  }

  private playEffect(cells: FarmCellRef | readonly FarmCellRef[], kind: FarmEffectKind): void {
    const list = typeof cells === 'string' ? [cells] : [...cells];
    if (list.length > 0) this.effectEvent.set({ cells: list, kind, seq: ++this.fxSeq });
  }

  private playSound(command: FarmCommandCode, d: EntityDetail): void {
    const variant = d.animal?.species ?? d.plant?.kind;
    switch (command) {
      case 'FEED_ANIMAL':
        this.sound.playSfx('feed', variant);
        break;
      case 'WATER_PLANT':
        this.sound.playSfx('water', variant);
        break;
      case 'HARVEST_ANIMAL':
      case 'HARVEST_PLANT':
        this.sound.playSfx('harvest', variant);
        break;
      case 'SELL_ANIMAL':
      case 'SELL_DECOR':
        this.sound.playSfx('sell');
        break;
    }
  }

  private harvestCells(state: FarmStateJson | null, plantIds: readonly string[]): FarmCellRef[] {
    if (!state) return [];
    const ids = new Set(plantIds);
    return [
      ...state.animals.filter((a) => a.pending > 0).map((a) => a.cell),
      ...state.plants.filter((p) => ids.has(p.id)).map((p) => p.cell),
    ];
  }
}

