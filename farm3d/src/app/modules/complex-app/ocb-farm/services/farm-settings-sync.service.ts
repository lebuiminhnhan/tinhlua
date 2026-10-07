import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { FarmSettings, UpdateSettingsPayload } from '../models/ocb-farm.model';
import { FarmStateStore } from './farm-state.store';

/**
 * OCB Farm — đồng bộ `settings` theo nhân viên (không theo thiết bị).
 *
 * - Nguồn ban đầu: `FarmStateStore.me().settings` (server). Chỉ nạp lại khi server trả
 *   một object `settings` mới (tham chiếu khác) — các lần `me` được vá số dư sau mỗi lệnh
 *   giữ nguyên tham chiếu nên không ghi đè lựa chọn cục bộ.
 * - `update(patch)` áp dụng NGAY trên client (signal), sau đó lưu qua lệnh
 *   `UPDATE_SETTINGS`. Khi chưa thể gửi (chưa khởi tạo, đang ghé thăm, mất mạng) bản vá
 *   được giữ lại và tự gửi khi đủ điều kiện, không gây lỗi chặn người dùng.
 *
 * Dùng chung cho `QualityService`, `SoundService` và `settings-panel` (scene_lock).
 *
 * _Requirements: US-30, US-32, US-36, BR-29_
 */

/** Mặc định cho nhân viên mới — âm thanh tắt (BR-29), chất lượng Thấp cho tới khi tự dò. */
export const DEFAULT_FARM_SETTINGS: Readonly<FarmSettings> = Object.freeze({
  quality: 'low',
  quality_manual: false,
  bgm: false,
  sfx: false,
  scene_lock: null,
});

@Injectable({ providedIn: 'root' })
export class FarmSettingsSyncService {
  private store = inject(FarmStateStore);

  private readonly _local = signal<FarmSettings | null>(null);
  private lastServerRef: FarmSettings | null = null;
  private pendingPatch: UpdateSettingsPayload = {};
  private inFlight = false;

  /** Thiết lập hiệu lực trên client (đã gồm thay đổi chưa kịp lưu). */
  readonly settings = computed<FarmSettings>(() => this._local() ?? DEFAULT_FARM_SETTINGS);
  /** `true` khi đã nhận settings từ server ít nhất một lần. */
  readonly hydrated = computed(() => this._local() !== null);

  private readonly _saving = signal(false);
  readonly saving = this._saving.asReadonly();

  constructor() {
    // Nạp settings từ server khi có tham chiếu mới.
    effect(() => {
      const server = this.store.me()?.settings ?? null;
      if (!server || server === this.lastServerRef) return;
      this.lastServerRef = server;
      untracked(() => this._local.set({ ...DEFAULT_FARM_SETTINGS, ...server, ...this.pendingPatch }));
    });

    // Đủ điều kiện gửi lại thì xả bản vá đang chờ.
    effect(() => {
      if (this.canPersist()) untracked(() => void this.flush());
    });
  }

  /** Áp dụng ngay trên client và lưu theo nhân viên. */
  update(patch: UpdateSettingsPayload): void {
    const keys = Object.keys(patch) as (keyof FarmSettings)[];
    if (keys.length === 0) return;
    this._local.update((current) => ({ ...(current ?? DEFAULT_FARM_SETTINGS), ...patch }));
    this.pendingPatch = { ...this.pendingPatch, ...patch };
    void this.flush();
  }

  private canPersist(): boolean {
    return (
      this.store.initialized() === true &&
      !this.store.isVisiting() &&
      !this.store.isOffline()
    );
  }

  private async flush(): Promise<void> {
    if (this.inFlight || Object.keys(this.pendingPatch).length === 0) return;
    if (!untracked(() => this.canPersist())) return;

    const patch = this.pendingPatch;
    this.pendingPatch = {};
    this.inFlight = true;
    this._saving.set(true);
    try {
      const result = await this.store.dispatch('UPDATE_SETTINGS', patch);
      if (!result.ok) {
        if (result.error.kind === 'network') {
          // Giữ lại để gửi khi có mạng; thay đổi mới hơn được ưu tiên.
          this.pendingPatch = { ...patch, ...this.pendingPatch };
        } else {
          console.warn('[ocb-farm] Không lưu được cài đặt:', result.error.message);
        }
      }
    } finally {
      this.inFlight = false;
      this._saving.set(false);
    }
    if (Object.keys(this.pendingPatch).length > 0) void this.flush();
  }
}
