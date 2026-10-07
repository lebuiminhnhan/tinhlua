import { DestroyRef, Injectable, NgZone, computed, inject, signal } from '@angular/core';
import type { DayPhase } from '../models/ocb-farm.model';
import {
  DayPhaseConfig,
  DEFAULT_DAY_PHASE_CONFIG,
  FarmEnvironmentInput,
  dayPhaseAtVn,
  dayPhaseConfigFrom,
  displayedPhase,
} from '../scene/farm-environment';
import { FarmApiService } from './farm-api.service';
import { FarmSettingsSyncService } from './farm-settings-sync.service';
import { FarmStateStore } from './farm-state.store';

/**
 * OCB Farm — môi trường hiển thị của khung 3D (task 11.4).
 *
 * - Buổi theo giờ thực: lấy `me.environment.day_phase` (backend là nguồn chính), và tự
 *   đánh giá lại ranh giới buổi bằng đồng hồ cục bộ đã khớp `server_time` + cấu hình
 *   `day_phase_*_start`, để trời đổi buổi mà không cần tải lại trang (US-30).
 * - Khoá cảnh (`settings.scene_lock`) chỉ đổi buổi được vẽ; thời tiết vẫn theo server.
 * - Thời tiết và chủ đề dịp lễ lấy nguyên từ `me.environment` (giống nhau cho mọi nông
 *   trại — BR-30), kể cả khi đang ghé thăm.
 * - Không gửi lệnh, không đổi state trò chơi.
 *
 * Phạm vi: theo component (cung cấp cùng `FarmSceneService` ở `farm-canvas`).
 *
 * _Requirements: US-30, US-31, US-33_
 */

/** Chu kỳ đánh giá lại buổi theo đồng hồ cục bộ (ms). */
export const ENV_CLOCK_INTERVAL_MS = 30_000;

@Injectable()
export class FarmEnvironmentService {
  private readonly store = inject(FarmStateStore);
  private readonly settings = inject(FarmSettingsSyncService);
  private readonly api = inject(FarmApiService);
  private readonly zone = inject(NgZone);

  private readonly now = signal(Date.now());
  private readonly phaseConfig = signal<DayPhaseConfig>({ ...DEFAULT_DAY_PHASE_CONFIG });

  /** Lệch đồng hồ server − client (ms) theo `me.server_time` gần nhất. */
  private readonly serverOffset = computed(() => {
    const serverTime = this.store.me()?.server_time;
    const parsed = serverTime ? Date.parse(serverTime) : NaN;
    // Đọc `Date.now()` một lần khi `me` đổi — gần đúng thời điểm nhận response.
    return Number.isFinite(parsed) ? parsed - Date.now() : 0;
  });

  /** Buổi theo giờ thực tại Việt Nam. */
  readonly livePhase = computed<DayPhase | null>(() => {
    const env = this.store.me()?.environment;
    if (!env) return null;
    return dayPhaseAtVn(this.now() + this.serverOffset(), this.phaseConfig());
  });

  readonly sceneLock = computed(() => this.settings.settings().scene_lock);

  /** Đầu vào hiển thị cho khung 3D (đã áp khoá cảnh); `null` khi chưa có dữ liệu. */
  readonly input = computed<FarmEnvironmentInput | null>(() => {
    const env = this.store.me()?.environment;
    const live = this.livePhase();
    if (!env || !live) return null;
    return {
      phase: displayedPhase(live, this.sceneLock()),
      weather: env.weather,
      theme: env.season_theme,
    };
  });

  constructor() {
    // Cấu hình giờ buổi; lỗi tải giữ mặc định 05/11/14/18 (khớp seed backend).
    this.api.getConfig().subscribe({
      next: (res) => this.phaseConfig.set(dayPhaseConfigFrom(res.values)),
      error: (err: unknown) => console.warn('[ocb-farm] Không tải được cấu hình buổi, dùng mặc định.', err),
    });

    const id = this.zone.runOutsideAngular(() =>
      setInterval(() => this.zone.run(() => this.now.set(Date.now())), ENV_CLOCK_INTERVAL_MS),
    );
    inject(DestroyRef).onDestroy(() => clearInterval(id));
  }
}
