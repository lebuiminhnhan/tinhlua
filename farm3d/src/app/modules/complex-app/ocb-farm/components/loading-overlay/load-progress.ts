import { Signal, computed, signal } from '@angular/core';

/**
 * OCB Farm — theo dõi tiến trình tải (US-39).
 *
 * `FarmLoadTracker` là lớp thuần (không DI) do component chính sở hữu. Mọi nguồn tải
 * (dữ liệu nông trại, cấu hình, và sau này là `AssetLoaderService` / `farm-canvas` ở
 * task 11.2/11.5) báo tiến trình theo từng hạng mục qua tracker này.
 *
 * Bất biến:
 * - Phần trăm hiển thị trong cùng một lần tải (`session`) chỉ tăng hoặc giữ nguyên.
 * - Hạng mục lỗi được tính là "đã xử lý" vào phần trăm để không chặn hoàn tất;
 *   hạng mục `critical` lỗi → `phase = 'error'` (chặn), còn lại → `ready` kèm danh sách lỗi.
 * - Quá `timeoutMs` mà còn hạng mục chưa xong → `phase = 'timeout'`, các hạng mục dở dang
 *   bị đánh dấu lỗi với lý do quá thời gian chờ; kết quả về muộn bị bỏ qua.
 * - Thử lại chỉ tải lại các hạng mục lỗi, hạng mục đã xong được giữ nguyên.
 *
 * _Requirements: US-39_
 */

export type FarmLoadItemStatus = 'pending' | 'loading' | 'done' | 'failed';

export type FarmLoadPhase = 'idle' | 'loading' | 'ready' | 'timeout' | 'error';

export interface FarmLoadItemDef {
  id: string;
  /** Nhãn tiếng Việt hiển thị khi đang tải hạng mục này. */
  label: string;
  /** Trọng số trong tổng phần trăm (mặc định 1). */
  weight?: number;
  /** Lỗi hạng mục này làm nông trại không dùng được → chặn bằng màn hình lỗi. */
  critical?: boolean;
}

export interface FarmLoadItem {
  id: string;
  label: string;
  weight: number;
  critical: boolean;
  status: FarmLoadItemStatus;
  /** Tiến trình riêng của hạng mục, 0..1. */
  fraction: number;
  error: string | null;
}

/** Thời gian chờ tối đa mặc định theo XN-1 (30 giây). */
export const FARM_LOAD_TIMEOUT_MS = 30_000;

export const FARM_LOAD_TIMEOUT_REASON = 'Quá thời gian chờ';

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Phần trăm thô (0..100) theo trọng số; hạng mục lỗi tính như đã xử lý xong. */
export function computeRawPercent(items: readonly FarmLoadItem[]): number {
  const total = items.reduce((sum, i) => sum + i.weight, 0);
  if (total <= 0) return 0;
  const progressed = items.reduce((sum, i) => {
    const f = i.status === 'done' || i.status === 'failed' ? 1 : clamp(i.fraction, 0, 1);
    return sum + i.weight * f;
  }, 0);
  return clamp((progressed / total) * 100, 0, 100);
}

/** Bước monotonic: không bao giờ thấp hơn giá trị trước trong cùng lần tải. */
export function nextMonotonicPercent(previous: number, raw: number): number {
  return clamp(Math.max(previous, raw), 0, 100);
}

function isSettled(item: FarmLoadItem): boolean {
  return item.status === 'done' || item.status === 'failed';
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return 'Không tải được';
}

export class FarmLoadTracker {
  private readonly _items = signal<FarmLoadItem[]>([]);
  private readonly _percent = signal(0);
  private readonly _phase = signal<FarmLoadPhase>('idle');
  private readonly _session = signal(0);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timeoutMs = FARM_LOAD_TIMEOUT_MS;

  readonly items: Signal<FarmLoadItem[]> = this._items.asReadonly();
  /** Phần trăm làm tròn xuống, monotonic trong một `session`. */
  readonly percent = computed(() => Math.floor(this._percent()));
  readonly phase = this._phase.asReadonly();
  /** Tăng mỗi lần bắt đầu / thử lại — overlay dùng để biết khi nào được reset phần trăm. */
  readonly session = this._session.asReadonly();

  /** Nhãn hạng mục đang tải (ưu tiên hạng mục `loading`, rồi tới `pending`). */
  readonly currentLabel = computed<string | null>(() => {
    const items = this._items();
    return (
      items.find((i) => i.status === 'loading')?.label ??
      items.find((i) => i.status === 'pending')?.label ??
      null
    );
  });

  readonly failedItems = computed(() => this._items().filter((i) => i.status === 'failed'));
  readonly criticalFailure = computed(
    () => this.failedItems().find((i) => i.critical) ?? null,
  );
  readonly timeoutSeconds = computed(() => Math.round(this.timeoutMs / 1000));

  /** Bắt đầu một lần tải mới với danh sách hạng mục; phần trăm về 0. */
  begin(defs: readonly FarmLoadItemDef[], timeoutMs = FARM_LOAD_TIMEOUT_MS): void {
    this.timeoutMs = timeoutMs > 0 ? timeoutMs : FARM_LOAD_TIMEOUT_MS;
    this._items.set(defs.map((d) => this.toItem(d)));
    this._percent.set(0);
    this.openSession();
  }

  /** Thêm hạng mục vào lần tải đang chạy (ví dụ khi biết danh sách mô hình cần nạp). */
  add(defs: readonly FarmLoadItemDef[]): void {
    const existing = new Set(this._items().map((i) => i.id));
    const fresh = defs.filter((d) => !existing.has(d.id)).map((d) => this.toItem(d));
    if (fresh.length === 0) return;
    this._items.update((list) => [...list, ...fresh]);
    if (this._phase() !== 'loading') {
      // Lần tải trước đã kết thúc (100%) → mở `session` mới với phần trăm thô hiện tại,
      // để thanh tiến trình không đứng yên ở 100% trong khi hạng mục mới đang tải.
      this._percent.set(computeRawPercent(this._items()));
      this.openSession();
    }
    // Thêm hạng mục có thể làm phần trăm thô giảm — giá trị hiển thị vẫn giữ nguyên.
    this.recompute();
  }

  /**
   * Thử lại: chỉ đặt lại các hạng mục lỗi (hoặc `ids` chỉ định), giữ nguyên hạng mục
   * đã xong. Trả về id các hạng mục cần tải lại.
   */
  retry(ids?: readonly string[]): string[] {
    const target = new Set(ids ?? this.failedItems().map((i) => i.id));
    this._items.update((list) =>
      list.map((i) =>
        target.has(i.id) && i.status !== 'done'
          ? { ...i, status: 'pending', fraction: 0, error: null }
          : i,
      ),
    );
    this._percent.set(computeRawPercent(this._items()));
    this.openSession();
    return this._items()
      .filter((i) => target.has(i.id) && i.status === 'pending')
      .map((i) => i.id);
  }

  start(id: string): void {
    this.patch(id, (i) => (i.status === 'pending' ? { ...i, status: 'loading' } : i));
  }

  progress(id: string, fraction: number): void {
    this.patch(id, (i) =>
      i.status === 'loading' || i.status === 'pending'
        ? { ...i, status: 'loading', fraction: Math.max(i.fraction, clamp(fraction, 0, 1)) }
        : i,
    );
  }

  complete(id: string): void {
    this.patch(id, (i) =>
      i.status === 'loading' || i.status === 'pending' ? { ...i, status: 'done', fraction: 1 } : i,
    );
  }

  fail(id: string, reason: string): void {
    this.patch(id, (i) =>
      i.status === 'loading' || i.status === 'pending'
        ? { ...i, status: 'failed', error: reason }
        : i,
    );
  }

  /**
   * Chạy một tác vụ tải gắn với hạng mục `id`. Kết quả về sau khi lần tải đã kết thúc
   * (quá thời gian chờ hoặc đã bắt đầu lần tải mới) bị bỏ qua.
   */
  async track(id: string, task: () => Promise<unknown>): Promise<boolean> {
    const session = this._session();
    this.start(id);
    try {
      await task();
      if (session !== this._session()) return false;
      this.complete(id);
      return true;
    } catch (err: unknown) {
      if (session === this._session()) this.fail(id, errorMessage(err));
      return false;
    }
  }

  dispose(): void {
    this.clearTimer();
  }

  // ---------------------------------------------------------------------------

  private toItem(def: FarmLoadItemDef): FarmLoadItem {
    return {
      id: def.id,
      label: def.label,
      weight: def.weight !== undefined && def.weight > 0 ? def.weight : 1,
      critical: def.critical ?? false,
      status: 'pending',
      fraction: 0,
      error: null,
    };
  }

  private openSession(): void {
    this._session.update((s) => s + 1);
    this._phase.set('loading');
    this.clearTimer();
    this.timer = setTimeout(() => this.onTimeout(), this.timeoutMs);
    this.settleIfDone();
  }

  private patch(id: string, fn: (item: FarmLoadItem) => FarmLoadItem): void {
    if (this._phase() !== 'loading') return;
    this._items.update((list) => list.map((i) => (i.id === id ? fn(i) : i)));
    this.recompute();
    this.settleIfDone();
  }

  private recompute(): void {
    this._percent.update((prev) => nextMonotonicPercent(prev, computeRawPercent(this._items())));
  }

  private settleIfDone(): void {
    if (this._phase() !== 'loading') return;
    const items = this._items();
    if (!items.every(isSettled)) return;
    this.clearTimer();
    this._percent.set(100);
    this._phase.set(items.some((i) => i.critical && i.status === 'failed') ? 'error' : 'ready');
  }

  private onTimeout(): void {
    this.timer = null;
    if (this._phase() !== 'loading') return;
    this._items.update((list) =>
      list.map((i) =>
        isSettled(i) ? i : { ...i, status: 'failed', error: FARM_LOAD_TIMEOUT_REASON },
      ),
    );
    this._phase.set('timeout');
    // Bỏ qua mọi kết quả về muộn của lần tải này.
    this._session.update((s) => s + 1);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
