import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  FarmAchievementUnlocked,
  FarmCommandCode,
  FarmCommandPayloadMap,
  FarmErrorCode,
  FarmInitRequest,
  FarmLedgerEntry,
  FarmMeResponse,
  FarmMeResult,
  FarmNotice,
  FarmStateJson,
} from '../models/ocb-farm.model';
import { FarmApiService, FarmCommandOutcome, httpErrorMessage } from './farm-api.service';
import { todayVnIso } from '../components/onboarding-wizard/join-date';

/**
 * OCB Farm — read-model phía client bằng signals.
 *
 * Mô hình dữ liệu:
 * - `confirmed`: ảnh chụp server xác nhận gần nhất (`state`, `balance`, `version`).
 * - `pending`: danh sách lệnh đã gửi/đang chờ, mỗi lệnh có thể kèm một hàm cập nhật
 *   lạc quan (`optimistic`).
 * - `state` / `balance` hiển thị = `confirmed` + lần lượt áp các `optimistic` còn treo.
 *   Khi server trả kết quả, `confirmed` được thay bằng dữ liệu server và các lệnh còn
 *   treo được "rebase" lên trên — nên hoàn tác chỉ là bỏ lệnh khỏi `pending`.
 *
 * Xử lý kết quả lệnh:
 * - 200 → nhận state server, gỡ lệnh khỏi `pending`.
 * - 409 → nhận state mới nhất từ server, hoàn tác lệnh và huỷ các lệnh xếp sau
 *   (chúng được dựng trên dữ liệu cũ), báo rõ thao tác nào bị huỷ.
 * - 422 → hoàn tác riêng lệnh đó, báo mã lỗi nghiệp vụ.
 * - Mất kết nối (hết lượt thử lại) → chuyển `connection` sang `offline`, hoàn tác
 *   lệnh và huỷ hàng chờ, báo rõ các thao tác bị huỷ.
 *
 * _Requirements: US-21, US-40_
 */

/** Phần dữ liệu mà cập nhật lạc quan được phép thay đổi. */
export interface FarmSnapshot {
  state: FarmStateJson;
  balance: number;
}

/** Hàm cập nhật lạc quan — thuần, không được sửa trực tiếp `snapshot` đầu vào. */
export type FarmOptimisticPatch = (snapshot: FarmSnapshot) => FarmSnapshot;

export interface FarmPendingCommand {
  idempotency_key: string;
  command: FarmCommandCode;
  /** Nhãn tiếng Việt của thao tác, dùng khi báo lệnh bị huỷ. */
  label: string;
  status: 'queued' | 'sending';
}

export type FarmConnectionStatus = 'online' | 'reconnecting' | 'offline';

export type FarmStoreErrorKind = 'load' | 'conflict' | 'rejected' | 'network' | 'http';

export interface FarmStoreError {
  kind: FarmStoreErrorKind;
  /** Mã lỗi nghiệp vụ khi có (409/422). */
  code: FarmErrorCode | null;
  message: string;
  /** Các thao tác đã bị huỷ / hoàn tác vì lỗi này — luôn nêu rõ cho người dùng. */
  cancelled: FarmPendingCommand[];
  occurred_at: number;
}

/** Đích đang ghé thăm — khi khác `null`, mọi lệnh ghi đều bị chặn (BR-21). */
export interface FarmVisitTarget {
  user_id: number;
  full_name: string;
  farm_name: string;
  department_name?: string | null;
  /** Thâm niên (tháng) của chủ nông trại — dùng cho chú thích ảnh chụp (US-41). */
  seniority_months?: number;
  /** `true` khi hôm nay là ngày kỷ niệm vào làm của chủ nông trại (US-8). */
  is_anniversary_today?: boolean;
  anniversary_years?: number | null;
}

export interface DispatchOptions {
  optimistic?: FarmOptimisticPatch;
  /** Ghi đè nhãn mặc định của lệnh. */
  label?: string;
}

export type DispatchResult =
  | { ok: true; achievements: FarmAchievementUnlocked[]; notices: FarmNotice[] }
  | { ok: false; error: FarmStoreError };

/** Nhãn tiếng Việt của từng lệnh — dùng trong thông báo "thao tác bị huỷ". */
export const FARM_COMMAND_LABELS: Record<FarmCommandCode, string> = {
  BUY_ANIMAL: 'Mua vật nuôi',
  FEED_ANIMAL: 'Cho vật nuôi ăn',
  FEED_ALL: 'Cho ăn tất cả',
  HARVEST_ANIMAL: 'Thu hoạch vật nuôi',
  HARVEST_ALL: 'Thu hoạch tất cả',
  MOVE_ENTITY: 'Di chuyển vật thể',
  SELL_ANIMAL: 'Bán vật nuôi',
  PLANT_SEED: 'Gieo hạt',
  WATER_PLANT: 'Tưới cây',
  WATER_ALL: 'Tưới tất cả',
  FERTILIZE_PLANT: 'Bón phân',
  HARVEST_PLANT: 'Thu hoạch cây',
  USE_GROWTH_POTION: 'Dùng thuốc tăng trưởng',
  USE_SUPER_FERTILIZER: 'Dùng phân bón siêu cấp',
  SELL_PRODUCT: 'Bán sản phẩm',
  EXPAND_PLOT: 'Mở rộng đất',
  BUY_DECOR: 'Mua vật trang trí',
  MOVE_DECOR: 'Di chuyển vật trang trí',
  ROTATE_DECOR: 'Xoay vật trang trí',
  SELL_DECOR: 'Bán vật trang trí',
  RENAME_FARM: 'Đổi tên nông trại',
  CLAIM_CHECKIN: 'Nhận thưởng check-in',
  PICK_ANNIVERSARY_FRUIT: 'Hái quả kỷ niệm',
  SELECT_BADGES: 'Chọn huy hiệu',
  UPDATE_SETTINGS: 'Lưu cài đặt',
};

interface PendingEntry {
  idempotency_key: string;
  command: FarmCommandCode;
  label: string;
  optimistic: FarmOptimisticPatch | null;
}

interface ConfirmedSnapshot extends FarmSnapshot {
  version: number;
}

const MAX_NOTICES = 20;

@Injectable({ providedIn: 'root' })
export class FarmStateStore {
  private api = inject(FarmApiService);
  private destroyRef = inject(DestroyRef);

  // ---------------------------------------------------------------------------
  // Signals nội bộ
  // ---------------------------------------------------------------------------

  private readonly _confirmed = signal<ConfirmedSnapshot | null>(null);
  /** Snapshot của chính mình, lưu lại khi vào chế độ ghé thăm để khôi phục lúc thoát. */
  private ownSnapshotBeforeVisit: ConfirmedSnapshot | null = null;
  private readonly _pending = signal<PendingEntry[]>([]);
  private readonly _me = signal<FarmMeResponse | null>(null);
  private readonly _initialized = signal<boolean | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<FarmStoreError | null>(null);
  private readonly _visitMode = signal<FarmVisitTarget | null>(null);
  private readonly _offlineFlag = signal(false);
  private readonly _notices = signal<FarmNotice[]>([]);
  private readonly _achievements = signal<FarmAchievementUnlocked[]>([]);
  private readonly _ledgerDelta = signal<FarmLedgerEntry[]>([]);

  // ---------------------------------------------------------------------------
  // Signals công khai (chỉ đọc)
  // ---------------------------------------------------------------------------

  /** Snapshot hiển thị = dữ liệu server + các cập nhật lạc quan còn treo. */
  private readonly view = computed<FarmSnapshot | null>(() => {
    const confirmed = this._confirmed();
    if (!confirmed) return null;
    let snapshot: FarmSnapshot = { state: confirmed.state, balance: confirmed.balance };
    for (const entry of this._pending()) {
      if (entry.optimistic) snapshot = entry.optimistic(snapshot);
    }
    return snapshot;
  });

  readonly state = computed<FarmStateJson | null>(() => this.view()?.state ?? null);
  readonly version = computed<number>(() => this._confirmed()?.version ?? 0);
  /** Số Hạt OCB hiển thị — không bao giờ âm kể cả khi cập nhật lạc quan tính sai (BR-9). */
  readonly balance = computed<number>(() => Math.max(0, this.view()?.balance ?? 0));
  /** Số dư server đã xác nhận (không gồm cập nhật lạc quan). */
  readonly confirmedBalance = computed<number>(() => Math.max(0, this._confirmed()?.balance ?? 0));

  /** Lệnh đang treo; trạng thái queued/sending lấy trực tiếp từ hàng chờ của API. */
  readonly pending = computed<FarmPendingCommand[]>(() => {
    const sending = new Set(
      this.api
        .queued()
        .filter((q) => q.status === 'sending')
        .map((q) => q.idempotency_key),
    );
    return this._pending().map((p) =>
      this.toPublic(p, sending.has(p.idempotency_key) ? 'sending' : 'queued'),
    );
  });
  readonly hasPending = computed(() => this._pending().length > 0);

  readonly me = this._me.asReadonly();
  /** `null` khi chưa tải lần nào; `false` khi cần mở màn hình khởi tạo. */
  readonly initialized = this._initialized.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly visitMode = this._visitMode.asReadonly();
  readonly isVisiting = computed(() => this._visitMode() !== null);
  readonly notices = this._notices.asReadonly();
  readonly achievementsUnlocked = this._achievements.asReadonly();
  readonly lastLedgerDelta = this._ledgerDelta.asReadonly();

  readonly connection = computed<FarmConnectionStatus>(() => {
    if (this._offlineFlag()) return 'offline';
    if (this.api.retrying()) return 'reconnecting';
    return 'online';
  });
  readonly isOffline = computed(() => this.connection() === 'offline');

  constructor() {
    this.watchBrowserConnectivity();
  }

  // ---------------------------------------------------------------------------
  // Tải dữ liệu
  // ---------------------------------------------------------------------------

  /** Tải `GET /me` và thay toàn bộ dữ liệu xác nhận. Không đụng tới lệnh đang treo. */
  async load(): Promise<boolean> {
    this._loading.set(true);
    try {
      const result = await firstValueFrom(this.api.getMe());
      this.applyMe(result);
      this._offlineFlag.set(false);
      if (this._error()?.kind === 'load') this._error.set(null);
      return true;
    } catch (err: unknown) {
      this.setError({ kind: 'load', code: null, message: httpErrorMessage(err), cancelled: [] });
      return false;
    } finally {
      this._loading.set(false);
    }
  }

  /** Khởi tạo nông trại rồi tải lại `/me` để có đủ thâm niên, giới hạn, môi trường. */
  async initFarm(request: FarmInitRequest): Promise<boolean> {
    this._loading.set(true);
    try {
      await firstValueFrom(this.api.initFarm(request));
    } catch (err: unknown) {
      this._loading.set(false);
      this.setError({ kind: 'load', code: null, message: httpErrorMessage(err), cancelled: [] });
      return false;
    }
    return this.load();
  }

  // ---------------------------------------------------------------------------
  // Gửi lệnh
  // ---------------------------------------------------------------------------

  /**
   * Gửi một lệnh qua hàng chờ, áp cập nhật lạc quan ngay lập tức (nếu có) và
   * hoà giải theo kết quả server.
   */
  async dispatch<C extends FarmCommandCode>(
    command: C,
    payload: FarmCommandPayloadMap[C],
    options: DispatchOptions = {},
  ): Promise<DispatchResult> {
    const label = options.label ?? FARM_COMMAND_LABELS[command];

    const blocked = this.blockReason(command, label);
    if (blocked) {
      return this.fail(blocked);
    }

    const { idempotencyKey, result } = this.api.enqueue(command, payload, () => this.version());
    this._pending.update((list) => [
      ...list,
      {
        idempotency_key: idempotencyKey,
        command,
        label,
        optimistic: options.optimistic ?? null,
      },
    ]);

    const outcome = await result;
    return this.reconcile(idempotencyKey, outcome);
  }

  // ---------------------------------------------------------------------------
  // Chế độ ghé thăm, thông báo, lỗi
  // ---------------------------------------------------------------------------

  /**
   * Vào chế độ ghé thăm: hiển thị `state` chỉ-xem của đồng nghiệp trên khung 3D và chặn
   * mọi lệnh ghi (BR-21, kiểm tra ở {@link blockReason}). Snapshot của chính mình được
   * lưu lại để khôi phục nguyên vẹn khi thoát — không gọi lại `/me`.
   */
  enterVisit(target: FarmVisitTarget, farmState: FarmStateJson): void {
    if (this._visitMode() === null) {
      this.ownSnapshotBeforeVisit = this._confirmed();
    }
    this._visitMode.set(target);
    // `version: -1` là giá trị canh gác: không khớp bất kỳ version thật nào ở server nên
    // một lệnh ghi lọt qua `blockReason` (lẽ ra không thể) sẽ bị từ chối an toàn ở 409
    // thay vì áp nhầm lên nông trại của đồng nghiệp.
    this._confirmed.set({ state: farmState, balance: 0, version: -1 });
  }

  /** Thoát chế độ ghé thăm, trả lại đúng dữ liệu nông trại của chính mình. */
  exitVisit(): void {
    this._visitMode.set(null);
    if (this.ownSnapshotBeforeVisit) {
      this._confirmed.set(this.ownSnapshotBeforeVisit);
      this.ownSnapshotBeforeVisit = null;
    }
  }

  clearError(): void {
    this._error.set(null);
  }

  dismissNotice(index: number): void {
    this._notices.update((list) => list.filter((_, i) => i !== index));
  }

  clearAchievementsUnlocked(): void {
    this._achievements.set([]);
  }

  // ---------------------------------------------------------------------------
  // Nội bộ
  // ---------------------------------------------------------------------------

  private reconcile(key: string, outcome: FarmCommandOutcome): DispatchResult {
    const entry = this._pending().find((p) => p.idempotency_key === key);
    const self: FarmPendingCommand[] = entry ? [this.toPublic(entry)] : [];

    switch (outcome.kind) {
      case 'ok': {
        const body = outcome.body;
        this._confirmed.set({ state: body.state, balance: body.balance, version: body.version });
        this.patchMeBalance(body.balance, body.version);
        if (outcome.request.command === 'CLAIM_CHECKIN') {
          this.patchMeCheckin(body.notices);
        }
        this.removePending(key);
        this._offlineFlag.set(false);
        this._ledgerDelta.set(body.ledger_delta);
        if (body.achievements_unlocked.length > 0) {
          this._achievements.update((list) => [...list, ...body.achievements_unlocked]);
        }
        this.pushNotices(body.notices);
        return { ok: true, achievements: body.achievements_unlocked, notices: body.notices };
      }

      case 'conflict': {
        const body = outcome.body;
        this._confirmed.set({ state: body.state, balance: body.balance, version: body.version });
        this.patchMeBalance(body.balance, body.version);
        this.removePending(key);
        const later = this.cancelQueuedAfterFailure();
        return this.fail({
          kind: 'conflict',
          code: 'VERSION_CONFLICT',
          message:
            body.message ||
            'Dữ liệu nông trại đã thay đổi ở thiết bị khác. Nông trại đã được cập nhật theo dữ liệu mới nhất.',
          cancelled: [...self, ...later],
        });
      }

      case 'rejected': {
        this.removePending(key);
        return this.fail({
          kind: 'rejected',
          code: outcome.body.code,
          message: outcome.body.message,
          cancelled: self,
        });
      }

      case 'network': {
        this.removePending(key);
        this._offlineFlag.set(true);
        const later = this.cancelQueuedAfterFailure();
        return this.fail({
          kind: 'network',
          code: null,
          message: 'Mất kết nối tới máy chủ. Các thao tác dưới đây chưa được thực hiện, vui lòng thử lại khi có mạng.',
          cancelled: [...self, ...later],
        });
      }

      case 'http': {
        this.removePending(key);
        return this.fail({ kind: 'http', code: null, message: outcome.message, cancelled: self });
      }

      case 'cancelled': {
        // Đã được báo trong lỗi của lệnh gây huỷ; chỉ cần dọn khỏi `pending`.
        this.removePending(key);
        return {
          ok: false,
          error: this._error() ?? this.buildError({
            kind: 'network',
            code: null,
            message: 'Thao tác đã bị huỷ.',
            cancelled: self,
          }),
        };
      }
    }
  }

  /** Huỷ lệnh chưa gửi trong hàng chờ và gỡ cập nhật lạc quan của chúng. */
  private cancelQueuedAfterFailure(): FarmPendingCommand[] {
    const cancelledKeys = new Set(this.api.cancelQueued().map((c) => c.idempotency_key));
    if (cancelledKeys.size === 0) return [];
    const cancelled = this._pending()
      .filter((p) => cancelledKeys.has(p.idempotency_key))
      .map((p) => this.toPublic(p));
    this._pending.update((list) => list.filter((p) => !cancelledKeys.has(p.idempotency_key)));
    return cancelled;
  }

  private blockReason(command: FarmCommandCode, label: string): Omit<FarmStoreError, 'occurred_at'> | null {
    const self: FarmPendingCommand[] = [
      { idempotency_key: '', command, label, status: 'queued' },
    ];
    if (this._visitMode()) {
      return {
        kind: 'rejected',
        code: 'VISIT_MODE_READ_ONLY',
        message: 'Bạn đang ghé thăm nông trại của đồng nghiệp nên chỉ có thể xem và giúp đỡ.',
        cancelled: self,
      };
    }
    if (!this._confirmed() || this._initialized() === false) {
      return {
        kind: 'rejected',
        code: 'FARM_NOT_INITIALIZED',
        message: 'Nông trại chưa sẵn sàng, vui lòng hoàn tất khởi tạo trước.',
        cancelled: self,
      };
    }
    if (this._offlineFlag()) {
      return {
        kind: 'network',
        code: null,
        message: 'Đang mất kết nối tới máy chủ, thao tác chưa được thực hiện.',
        cancelled: self,
      };
    }
    return null;
  }

  private applyMe(result: FarmMeResult): void {
    if (!result.initialized) {
      this._initialized.set(false);
      this._me.set(null);
      this._confirmed.set(null);
      return;
    }
    this._initialized.set(true);
    this._me.set(result);
    this._confirmed.set({ state: result.state, balance: result.balance, version: result.version });
    this.pushNotices(result.notices);
  }

  /** Giữ `me.balance`/`me.version` khớp với dữ liệu xác nhận mới nhất. */
  private patchMeBalance(balance: number, version: number): void {
    const me = this._me();
    if (me) this._me.set({ ...me, balance, version });
  }

  /**
   * Cập nhật `me.checkin` ngay sau khi `CLAIM_CHECKIN` thành công, đọc từ notice
   * `CHECKIN_CLAIMED` (`streak`, `base_reward`, `streak_bonus` — xem
   * `backend/src/services/ocb-farm/commands/daily.commands.ts`).
   *
   * TRƯỚC bản sửa này, `dispatch('CLAIM_CHECKIN', ...)` chỉ gọi {@link patchMeBalance}
   * (balance/version) — `me().checkin.claimed_today`/`streak` giữ nguyên giá trị CŨ từ
   * lần tải `/me` gần nhất cho tới khi gọi `load()` lại. Component bù đắp bằng một signal
   * tạm chỉ sống trong phiên Angular hiện tại (mất khi F5 vì component dựng lại từ đầu),
   * khiến `me().checkin` lúc đó vẫn là dữ liệu cũ (`claimed_today: false`): hộp thưởng
   * check-in tự mở lại dù đã nhận trong ngày, và bất kỳ nơi nào đọc trực tiếp
   * `me().checkin.streak` thấy chuỗi CHƯA cộng. Patch trực tiếp vào `me()` ở đây để đúng
   * ngay sau khi lệnh thành công, không phụ thuộc signal tạm nào ở component.
   */
  private patchMeCheckin(notices: readonly FarmNotice[]): void {
    const me = this._me();
    if (!me) return;
    const notice = notices.find((n) => n.code === 'CHECKIN_CLAIMED');
    const streak = Number(notice?.data?.['streak']);
    if (!notice || !Number.isFinite(streak)) return;
    this._me.set({
      ...me,
      checkin: {
        ...me.checkin,
        claimed_today: true,
        streak,
        last_checkin_date: todayVnIso(),
        next_reward: 0,
        next_streak_bonus: 0,
      },
    });
  }

  /**
   * Cập nhật `me.inbox_new_count` ngay sau khi `inbox-panel` đánh dấu đã xem, không chờ
   * tải lại `GET /me` (US-8, US-27, US-48).
   */
  patchInboxNewCount(newCount: number): void {
    const me = this._me();
    if (me) this._me.set({ ...me, inbox_new_count: newCount });
  }

  private pushNotices(notices: FarmNotice[]): void {
    if (notices.length === 0) return;
    this._notices.update((list) => [...list, ...notices].slice(-MAX_NOTICES));
  }

  private removePending(key: string): void {
    this._pending.update((list) => list.filter((p) => p.idempotency_key !== key));
  }

  private fail(error: Omit<FarmStoreError, 'occurred_at'>): DispatchResult {
    return { ok: false, error: this.setError(error) };
  }

  private setError(error: Omit<FarmStoreError, 'occurred_at'>): FarmStoreError {
    const full = this.buildError(error);
    this._error.set(full);
    return full;
  }

  private buildError(error: Omit<FarmStoreError, 'occurred_at'>): FarmStoreError {
    return { ...error, occurred_at: Date.now() };
  }

  private toPublic(entry: PendingEntry, status: FarmPendingCommand['status'] = 'queued'): FarmPendingCommand {
    return {
      idempotency_key: entry.idempotency_key,
      command: entry.command,
      label: entry.label,
      status,
    };
  }

  /** Theo dõi sự kiện online/offline của trình duyệt; có mạng lại thì tải lại `/me`. */
  private watchBrowserConnectivity(): void {
    if (typeof window === 'undefined') return;
    const onOffline = (): void => this._offlineFlag.set(true);
    const onOnline = (): void => {
      this._offlineFlag.set(false);
      if (this._initialized() !== null) void this.load();
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    });
  }
}
