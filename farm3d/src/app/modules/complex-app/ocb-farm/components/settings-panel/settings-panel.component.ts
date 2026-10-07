import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  output,
  viewChild,
} from '@angular/core';
import type { DayPhase, FarmQuality } from '../../models/ocb-farm.model';
import { DAY_PHASES, FARM_QUALITIES } from '../../models/ocb-farm.model';
import { FARM_QUALITY_LABELS, QualityService } from '../../services/quality.service';
import { SoundService } from '../../services/sound.service';
import { FarmSettingsSyncService } from '../../services/farm-settings-sync.service';

/** Một lựa chọn buổi để khoá cảnh, kèm nhãn và icon hiển thị (US-30). */
interface SceneLockOption {
  value: DayPhase | null;
  label: string;
  icon: string;
}

/** Nhãn + icon của 4 buổi — khớp `farm-hud.component.ts`. */
const DAY_PHASE_LABELS: Record<DayPhase, { label: string; icon: string }> = {
  morning: { label: 'Buổi sáng', icon: 'bi bi-sunrise' },
  noon: { label: 'Buổi trưa', icon: 'bi bi-sun' },
  afternoon: { label: 'Buổi chiều', icon: 'bi bi-sunset' },
  night: { label: 'Buổi đêm', icon: 'bi bi-moon-stars' },
};

const QUALITY_ICONS: Record<FarmQuality, string> = {
  low: 'bi bi-battery-half',
  medium: 'bi bi-battery',
  high: 'bi bi-battery-full',
};

/**
 * OCB Farm — `settings-panel` (task 14.5, presentational nhẹ: tự đọc service, không cần
 * container truyền dữ liệu).
 *
 * - Nhạc nền và hiệu ứng âm thanh bật/tắt độc lập, mặc định tắt (US-32, BR-29) — qua
 *   `SoundService`, lưu `settings.bgm` / `settings.sfx` theo nhân viên.
 * - Khoá cảnh theo 1 trong 4 buổi hoặc "Theo giờ thực" (US-30) — qua
 *   `FarmSettingsSyncService`, lưu `settings.scene_lock`.
 * - Mức chất lượng đồ hoạ Thấp/Vừa/Cao, có lựa chọn "Tự động theo thiết bị" (US-36) — qua
 *   `QualityService`, lưu `settings.quality` + `settings.quality_manual`.
 * - Mọi lựa chọn áp dụng ngay (service đã cập nhật lạc quan) và lưu qua lệnh
 *   `UPDATE_SETTINGS` theo nhân viên — giữ nguyên khi đổi thiết bị (BR-29).
 *
 * _Requirements: US-30, US-32, US-36, BR-29_
 */
@Component({
  selector: 'app-settings-panel',
  templateUrl: './settings-panel.component.html',
  styleUrl: './settings-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'close()',
  },
})
export class SettingsPanelComponent {
  private readonly sound = inject(SoundService);
  private readonly quality = inject(QualityService);
  private readonly settingsSync = inject(FarmSettingsSyncService);

  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  readonly closed = output<void>();

  readonly titleId = 'ocb-settings-panel-title';

  // --- Âm thanh (US-32, BR-29) -------------------------------------------------
  readonly bgmEnabled = this.sound.bgmEnabled;
  readonly sfxEnabled = this.sound.sfxEnabled;
  readonly soundUnavailable = this.sound.unavailableMessage;

  // --- Khoá cảnh (US-30) -------------------------------------------------------
  readonly sceneLockOptions: readonly SceneLockOption[] = [
    { value: null, label: 'Theo giờ thực', icon: 'bi bi-clock-history' },
    ...DAY_PHASES.map((phase) => ({ value: phase, ...DAY_PHASE_LABELS[phase] })),
  ];
  readonly sceneLock = computed(() => this.settingsSync.settings().scene_lock);

  // --- Chất lượng đồ hoạ (US-36) -----------------------------------------------
  readonly qualities = FARM_QUALITIES;
  readonly qualityLabels = FARM_QUALITY_LABELS;
  readonly qualityIcons = QUALITY_ICONS;
  readonly qualityTier = this.quality.tier;
  readonly qualityIsManual = computed(() => this.quality.source() === 'manual');
  readonly qualityReason = this.quality.reason;

  readonly saving = this.settingsSync.saving;

  constructor() {
    afterNextRender(() => this.dialog()?.nativeElement.focus());
  }

  toggleBgm(enabled: boolean): void {
    this.sound.setBgm(enabled);
  }

  toggleSfx(enabled: boolean): void {
    this.sound.setSfx(enabled);
  }

  dismissSoundUnavailable(): void {
    this.sound.dismissUnavailable();
  }

  setSceneLock(value: DayPhase | null): void {
    this.settingsSync.update({ scene_lock: value });
  }

  setQuality(tier: FarmQuality): void {
    this.quality.setManualQuality(tier);
  }

  useAutoQuality(): void {
    this.quality.useAutoQuality();
  }

  close(): void {
    this.closed.emit();
  }
}
