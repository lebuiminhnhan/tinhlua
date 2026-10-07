import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { FarmSpecies, PlantKind } from '../models/ocb-farm.model';
import { FarmSettingsSyncService } from './farm-settings-sync.service';

/**
 * OCB Farm — nhạc nền và hiệu ứng âm thanh (US-32, BR-29).
 *
 * - Tắt theo mặc định; `bgm` và `sfx` bật/tắt độc lập, áp dụng ngay và lưu theo nhân viên
 *   (`settings.bgm` / `settings.sfx` qua `UPDATE_SETTINGS`).
 * - Khi tuỳ chọn đang tắt, service không tạo phần tử audio nào → không tải, không phát.
 * - Mọi lỗi tải/phát chỉ ghi log và bật thông báo "âm thanh hiện không khả dụng";
 *   không bao giờ ném lỗi ra hành động của nhân viên (cho ăn, tưới, thu hoạch...).
 */

/** Sự kiện có hiệu ứng âm thanh. */
export type FarmSfxEvent = 'feed' | 'water' | 'harvest' | 'checkin' | 'buy' | 'sell' | 'rain';

/** Biến thể theo loài vật nuôi / loại cây (US-32: âm phản hồi theo đối tượng được tác động). */
export type FarmSfxVariant = FarmSpecies | PlantKind;

/**
 * Toàn bộ đường dẫn tệp âm thanh (tương đối với base href). Chưa có tệp nào trong
 * `public/assets/ocb-farm/audio/` — service tự bỏ qua khi tệp thiếu.
 */
export const FARM_AUDIO_FILES = {
  bgm: 'assets/ocb-farm/audio/bgm-farm.mp3',
  sfx: {
    feed: 'assets/ocb-farm/audio/sfx-feed.mp3',
    water: 'assets/ocb-farm/audio/sfx-water.mp3',
    harvest: 'assets/ocb-farm/audio/sfx-harvest.mp3',
    checkin: 'assets/ocb-farm/audio/sfx-checkin.mp3',
    buy: 'assets/ocb-farm/audio/sfx-buy.mp3',
    sell: 'assets/ocb-farm/audio/sfx-sell.mp3',
    rain: 'assets/ocb-farm/audio/sfx-rain.mp3',
  } satisfies Record<FarmSfxEvent, string>,
  /** Ghi đè theo `${event}:${variant}`; thiếu thì dùng âm chung của sự kiện. */
  variants: {
    'feed:chicken': 'assets/ocb-farm/audio/sfx-chicken.mp3',
    'feed:fish': 'assets/ocb-farm/audio/sfx-fish.mp3',
    'feed:sheep': 'assets/ocb-farm/audio/sfx-sheep.mp3',
    'feed:pig': 'assets/ocb-farm/audio/sfx-pig.mp3',
    'feed:cow': 'assets/ocb-farm/audio/sfx-cow.mp3',
    'feed:horse': 'assets/ocb-farm/audio/sfx-horse.mp3',
    'harvest:chicken': 'assets/ocb-farm/audio/sfx-chicken.mp3',
    'harvest:fish': 'assets/ocb-farm/audio/sfx-fish.mp3',
    'harvest:sheep': 'assets/ocb-farm/audio/sfx-sheep.mp3',
    'harvest:pig': 'assets/ocb-farm/audio/sfx-pig.mp3',
    'harvest:cow': 'assets/ocb-farm/audio/sfx-cow.mp3',
  } as Partial<Record<`${FarmSfxEvent}:${FarmSfxVariant}`, string>>,
} as const;

export const FARM_BGM_VOLUME = 0.35;
export const FARM_SFX_VOLUME = 0.7;

const GESTURE_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;

const UNAVAILABLE_MESSAGE = 'Âm thanh hiện không khả dụng. Nông trại vẫn hoạt động bình thường.';

@Injectable({ providedIn: 'root' })
export class SoundService {
  private settingsSync = inject(FarmSettingsSyncService);
  private destroyRef = inject(DestroyRef);

  readonly bgmEnabled = computed(() => this.settingsSync.settings().bgm);
  readonly sfxEnabled = computed(() => this.settingsSync.settings().sfx);

  private readonly _unavailable = signal<string | null>(null);
  /** Thông báo không chặn khi tệp âm thanh không tải/phát được. */
  readonly unavailableMessage = this._unavailable.asReadonly();

  private bgmAudio: HTMLAudioElement | null = null;
  private readonly sfxCache = new Map<string, HTMLAudioElement>();
  /** URL đã lỗi — không thử lại trong phiên để tránh spam request/log. */
  private readonly failedUrls = new Set<string>();
  private gestureRetry: (() => void) | null = null;

  constructor() {
    effect(() => {
      const on = this.bgmEnabled();
      untracked(() => (on ? this.startBgm() : this.stopBgm()));
    });
    this.destroyRef.onDestroy(() => this.disposeAll());
  }

  setBgm(enabled: boolean): void {
    this.settingsSync.update({ bgm: enabled });
  }

  setSfx(enabled: boolean): void {
    this.settingsSync.update({ sfx: enabled });
  }

  dismissUnavailable(): void {
    this._unavailable.set(null);
  }

  /**
   * Phát hiệu ứng cho một hành động. Không bao giờ ném lỗi và không cần `await` —
   * gọi sau khi hành động đã thực hiện, kết quả hành động không phụ thuộc vào âm thanh.
   */
  playSfx(event: FarmSfxEvent, variant?: FarmSfxVariant): void {
    if (!this.sfxEnabled() || !this.audioSupported()) return;
    const variantUrl = variant ? FARM_AUDIO_FILES.variants[`${event}:${variant}`] : undefined;
    const url = variantUrl && !this.failedUrls.has(variantUrl) ? variantUrl : FARM_AUDIO_FILES.sfx[event];
    if (this.failedUrls.has(url)) return;

    try {
      let base = this.sfxCache.get(url);
      if (!base) {
        base = this.createAudio(url, false, FARM_SFX_VOLUME);
        this.sfxCache.set(url, base);
      }
      // Clone để các hiệu ứng liên tiếp có thể chồng lên nhau.
      const instance = base.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA ? (base.cloneNode(true) as HTMLAudioElement) : base;
      instance.volume = FARM_SFX_VOLUME;
      this.safePlay(instance, url);
    } catch (err: unknown) {
      this.markFailed(url, err);
    }
  }

  // -------------------------------------------------------------------------
  // Nội bộ
  // -------------------------------------------------------------------------

  private startBgm(): void {
    if (!this.audioSupported()) return;
    const url = FARM_AUDIO_FILES.bgm;
    if (this.failedUrls.has(url)) return;
    try {
      this.bgmAudio ??= this.createAudio(url, true, FARM_BGM_VOLUME);
      this.safePlay(this.bgmAudio, url);
    } catch (err: unknown) {
      this.markFailed(url, err);
    }
  }

  private stopBgm(): void {
    this.removeGestureListeners();
    this.bgmAudio?.pause();
  }

  /** Đăng ký phát lại nhạc nền một lần khi có thao tác người dùng (chính sách autoplay). */
  private retryBgmOnGesture(): void {
    if (this.gestureRetry || typeof document === 'undefined') return;
    const retry = (): void => {
      this.removeGestureListeners();
      if (untracked(() => this.bgmEnabled())) this.startBgm();
    };
    this.gestureRetry = retry;
    for (const type of GESTURE_EVENTS) document.addEventListener(type, retry, { capture: true, passive: true });
  }

  private removeGestureListeners(): void {
    const retry = this.gestureRetry;
    if (!retry || typeof document === 'undefined') return;
    this.gestureRetry = null;
    for (const type of GESTURE_EVENTS) document.removeEventListener(type, retry, { capture: true });
  }

  private createAudio(url: string, loop: boolean, volume: number): HTMLAudioElement {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.loop = loop;
    audio.volume = volume;
    audio.addEventListener('error', () => this.markFailed(url, audio.error), { once: true });
    audio.src = url;
    return audio;
  }

  private safePlay(audio: HTMLAudioElement, url: string): void {
    audio.currentTime = 0;
    const result = audio.play();
    // Trình duyệt cũ có thể không trả Promise.
    if (result && typeof result.catch === 'function') {
      result.catch((err: unknown) => {
        // Chặn tự phát (chưa có thao tác người dùng) không phải lỗi tệp.
        if (err instanceof DOMException && err.name === 'NotAllowedError') {
          // Nhạc nền đã bật từ phiên trước: phát lại ở thao tác đầu tiên của nhân viên.
          if (url === FARM_AUDIO_FILES.bgm) this.retryBgmOnGesture();
          return;
        }
        if (err instanceof DOMException && err.name === 'AbortError') return;
        this.markFailed(url, err);
      });
    }
  }

  private markFailed(url: string, err: unknown): void {
    if (this.failedUrls.has(url)) return;
    this.failedUrls.add(url);
    console.warn(`[ocb-farm] Không tải/phát được âm thanh "${url}"`, err);
    this.sfxCache.delete(url);
    if (this.bgmAudio && url === FARM_AUDIO_FILES.bgm) {
      this.bgmAudio.removeAttribute('src');
      this.bgmAudio = null;
    }
    this._unavailable.set(UNAVAILABLE_MESSAGE);
  }

  private audioSupported(): boolean {
    return typeof Audio !== 'undefined';
  }

  private disposeAll(): void {
    this.removeGestureListeners();
    this.bgmAudio?.pause();
    this.bgmAudio = null;
    for (const audio of this.sfxCache.values()) audio.pause();
    this.sfxCache.clear();
  }
}
