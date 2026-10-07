import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/**
 * OCB Farm — Fullscreen_Mode (task 14.1).
 *
 * - `fullscreenchange` trên `document` là nguồn chân lý duy nhất cho `_active` — mọi đường
 *   thoát (nút, Esc trong trang, Esc do OS, chuyển app) đều đi qua event này, cờ luôn đồng
 *   bộ đúng theo `document.fullscreenElement` (AC 1.6).
 * - `enter()`/`exit()` không tự đặt `_active` — tránh hai nguồn chân lý lệch nhau.
 * - `_unsupported` dùng để hiển thị thông báo tiếng Việt khi trình duyệt từ chối/không hỗ
 *   trợ Fullscreen API (AC 1.4).
 *
 * _Requirements: 1.1, 1.3, 1.4, 1.6_
 */
@Injectable({ providedIn: 'root' })
export class FullscreenService {
  private readonly _active = signal(false);
  private readonly _unsupported = signal(false);
  readonly active = this._active.asReadonly();
  readonly unsupported = this._unsupported.asReadonly();

  constructor() {
    const handler = () => this._active.set(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', handler);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('fullscreenchange', handler));
  }

  async enter(el: HTMLElement): Promise<boolean> {
    if (!el.requestFullscreen) {
      this._unsupported.set(true);
      return false;
    }
    try {
      await el.requestFullscreen();
      return true;
    } catch {
      this._unsupported.set(true);
      return false;
    }
  }

  async exit(): Promise<void> {
    if (document.fullscreenElement) await document.exitFullscreen();
  }
}
