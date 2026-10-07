import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { FarmStateStore } from '../../services/farm-state.store';
import {
  AchievementCode,
  DayPhase,
  FarmEnvironment,
  FarmLimitCounter,
  FarmLimits,
  FarmSceneLock,
  FarmStateJson,
  SeasonTheme,
  Weather,
} from '../../models/ocb-farm.model';

/**
 * OCB Farm — HUD (lớp thông tin cố định phủ trên khung 3D).
 *
 * Mặc định đọc trực tiếp từ `FarmStateStore` (không gọi API); container có thể ghi đè
 * từng giá trị qua input (ví dụ khi ghé thăm nông trại đồng nghiệp).
 *
 * - Số Hạt OCB luôn hiển thị (không phụ thuộc góc nhìn/mức chất lượng vì nằm ngoài
 *   canvas), cập nhật ngay khi signal `balance` của store đổi — gồm cả cập nhật lạc quan,
 *   nên luôn trong ≤ 2 giây sau giao dịch (US-21).
 * - Buổi trong ngày (kèm trạng thái khoá cảnh), thời tiết, dịp lễ (US-30, US-31, US-33).
 * - Huy hiệu đang chọn hiển thị (US-29).
 * - Đếm số hiện tại / giới hạn cho từng nhóm (US-37): số hiện tại đếm từ `state`
 *   hiển thị (đã gồm cập nhật lạc quan), giới hạn lấy từ `limits` của `GET /me`.
 *
 * Host đặt `position: absolute` phủ mép trên — container phải là `position-relative`.
 *
 * _Requirements: US-21, US-30, US-31, US-33, US-37_
 */

interface HudOption {
  label: string;
  icon: string;
}

/** Một dòng đếm giới hạn đã dựng sẵn cho template. */
export interface HudLimitRow {
  key: 'animals' | 'plants' | 'decors' | 'storage';
  label: string;
  icon: string;
  current: number;
  max: number;
  /** Đã đạt (hoặc vượt — khi admin hạ giới hạn) mức tối đa. */
  full: boolean;
  /** Đạt ≥ 80% giới hạn nhưng chưa đầy. */
  near: boolean;
  ariaLabel: string;
}

export interface HudBadge {
  code: AchievementCode;
  name: string;
}

const DAY_PHASE_OPTIONS: Record<DayPhase, HudOption> = {
  morning: { label: 'Buổi sáng', icon: 'bi bi-sunrise' },
  noon: { label: 'Buổi trưa', icon: 'bi bi-sun' },
  afternoon: { label: 'Buổi chiều', icon: 'bi bi-sunset' },
  night: { label: 'Buổi đêm', icon: 'bi bi-moon-stars' },
};

const WEATHER_OPTIONS: Record<Weather, HudOption> = {
  sunny: { label: 'Nắng', icon: 'bi bi-brightness-high' },
  cloudy: { label: 'Nhiều mây', icon: 'bi bi-clouds' },
  rainy: { label: 'Mưa', icon: 'bi bi-cloud-rain-heavy' },
};

const SEASON_LABELS: Record<SeasonTheme, string> = {
  tet: 'Tết Nguyên Đán',
  christmas: 'Giáng sinh',
  mid_autumn: 'Trung thu',
  ocb_birthday: 'Sinh nhật OCB',
};

/** Tên huy hiệu — khớp `ACHIEVEMENT_CATALOG` ở backend (farm-achievement.ts). */
export const ACHIEVEMENT_NAMES: Record<AchievementCode, string> = {
  ALL_SPECIES: 'Đủ mặt anh tài',
  HARVEST_10: 'Tay thu hoạch',
  HARVEST_100: 'Nông dân chăm chỉ',
  HARVEST_500: 'Bậc thầy nông trại',
  STREAK_3: 'Khởi động',
  STREAK_7: 'Một tuần đều đặn',
  STREAK_14: 'Nửa tháng bền bỉ',
  STREAK_30: 'Một tháng gắn bó',
  HELP_10: 'Bạn tốt',
  HELP_50: 'Người hàng xóm tốt bụng',
  HELP_200: 'Trái tim nông trại',
  TREE_6M: 'Mầm đầu tiên',
  TREE_1Y: 'Một năm đồng hành',
  TREE_3Y: 'Ba năm gắn bó',
  TREE_5Y: 'Nửa thập kỷ',
  TREE_10Y: 'Một thập kỷ OCB',
  ALL_PLOTS_UNLOCKED: 'Điền chủ',
};

const NUMBER_FORMAT = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });

/** Ngưỡng "sắp đầy" để đổi màu cảnh báo. */
const NEAR_LIMIT_RATIO = 0.8;

@Component({
  selector: 'app-farm-hud',
  templateUrl: './farm-hud.component.html',
  styleUrl: './farm-hud.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FarmHudComponent {
  private readonly store = inject(FarmStateStore);

  // ---------------------------------------------------------------------------
  // Inputs — tuỳ chọn. Không truyền (`undefined`) thì đọc trực tiếp từ FarmStateStore,
  // nên `<app-farm-hud />` tự cập nhật theo signal `balance` (kể cả cập nhật lạc quan).
  // ---------------------------------------------------------------------------

  /** Ghi đè số Hạt OCB (mặc định `FarmStateStore.balance`). */
  readonly balanceInput = input<number | undefined>(undefined, { alias: 'balance' });
  /** Ghi đè state hiển thị (mặc định `FarmStateStore.state`). */
  readonly stateInput = input<FarmStateJson | null | undefined>(undefined, { alias: 'state' });
  /** Ghi đè giới hạn (mặc định `me().limits`). */
  readonly limitsInput = input<FarmLimits | null | undefined>(undefined, { alias: 'limits' });
  /** Ghi đè môi trường (mặc định `me().environment`). */
  readonly environmentInput = input<FarmEnvironment | null | undefined>(undefined, { alias: 'environment' });
  /** Ghi đè khoá cảnh (mặc định `me().settings.scene_lock`). */
  readonly sceneLockInput = input<FarmSceneLock | undefined>(undefined, { alias: 'sceneLock' });
  /** Ghi đè tên nông trại (mặc định `me().owner.farm_name`). */
  readonly farmNameInput = input<string | undefined>(undefined, { alias: 'farmName' });
  /** Ghi đè cờ đồng bộ (mặc định `FarmStateStore.hasPending`). */
  readonly syncingInput = input<boolean | undefined>(undefined, { alias: 'syncing' });
  /** Ghi đè số mục chưa xem trong hộp thư (mặc định `me().inbox_new_count`). */
  readonly inboxNewCountInput = input<number | undefined>(undefined, { alias: 'inboxNewCount' });

  // Giá trị hiệu lực: input nếu có, ngược lại lấy từ store.
  readonly balance = computed(() => this.balanceInput() ?? this.store.balance());
  readonly state = computed(() => {
    const v = this.stateInput();
    return v !== undefined ? v : this.store.state();
  });
  readonly limits = computed(() => {
    const v = this.limitsInput();
    return v !== undefined ? v : (this.store.me()?.limits ?? null);
  });
  readonly environment = computed(() => {
    const v = this.environmentInput();
    return v !== undefined ? v : (this.store.me()?.environment ?? null);
  });
  readonly sceneLock = computed<FarmSceneLock>(() => {
    const v = this.sceneLockInput();
    return v !== undefined ? v : (this.store.me()?.settings?.scene_lock ?? null);
  });
  readonly farmName = computed(() => this.farmNameInput() ?? this.store.me()?.owner?.farm_name ?? '');
  readonly syncing = computed(() => this.syncingInput() ?? this.store.hasPending());
  readonly inboxNewCount = computed(() => this.inboxNewCountInput() ?? this.store.me()?.inbox_new_count ?? 0);

  // ---------------------------------------------------------------------------
  // Outputs
  // ---------------------------------------------------------------------------

  /** Nhân viên bấm vào số Hạt OCB → container mở lịch sử thu chi (US-21). */
  readonly ledgerRequested = output<void>();
  /** Nhân viên bấm vào khu huy hiệu → container mở bảng thành tựu (US-29). */
  readonly badgesRequested = output<void>();
  /** Nhân viên bấm vào nút hộp thư → container mở `inbox-panel` (US-8, US-27, US-48). */
  readonly inboxRequested = output<void>();

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  /** Số nguyên không âm (BR-9). */
  private readonly safeBalance = computed(() => {
    const value = this.balance();
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  });

  readonly balanceText = computed(() => NUMBER_FORMAT.format(this.safeBalance()));

  /** Buổi đang hiển thị: buổi bị khoá (nếu có) hoặc buổi theo giờ thực. */
  readonly dayPhase = computed<HudOption | null>(() => {
    const phase = this.sceneLock() ?? this.environment()?.day_phase ?? null;
    return phase ? DAY_PHASE_OPTIONS[phase] : null;
  });
  readonly sceneLocked = computed(() => this.sceneLock() !== null);
  readonly dayPhaseTitle = computed(() => {
    const phase = this.dayPhase();
    if (!phase) return '';
    return this.sceneLocked() ? `${phase.label} (đang khoá cảnh)` : `${phase.label} (theo giờ Việt Nam)`;
  });

  readonly weather = computed<HudOption | null>(() => {
    const w = this.environment()?.weather;
    return w ? WEATHER_OPTIONS[w] : null;
  });

  /** Tên dịp lễ: ưu tiên tên do server dựng sẵn, fallback theo mã. `null` = chủ đề mặc định. */
  readonly seasonName = computed<string | null>(() => {
    const env = this.environment();
    if (!env?.season_theme) return null;
    return env.season_theme_name || SEASON_LABELS[env.season_theme];
  });

  readonly badges = computed<HudBadge[]>(() =>
    (this.state()?.badges_shown ?? []).map((code) => ({
      code,
      name: ACHIEVEMENT_NAMES[code] ?? code,
    })),
  );

  readonly limitRows = computed<HudLimitRow[]>(() => {
    const limits = this.limits();
    if (!limits) return [];
    const state = this.state();
    const storageTotal = state
      ? Object.values(state.storage).reduce<number>((sum, qty) => sum + (qty ?? 0), 0)
      : limits.storage.current;

    return [
      this.buildRow('animals', 'Vật nuôi', 'bi bi-piggy-bank', state?.animals.length, limits.animals),
      this.buildRow('plants', 'Cây trồng', 'bi bi-flower1', state?.plants.length, limits.plants),
      this.buildRow('decors', 'Trang trí', 'bi bi-lamp', state?.decors.length, limits.decors),
      this.buildRow('storage', 'Kho', 'bi bi-box-seam', storageTotal, limits.storage),
    ];
  });

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  onBalanceClick(): void {
    this.ledgerRequested.emit();
  }

  onBadgesClick(): void {
    this.badgesRequested.emit();
  }

  onInboxClick(): void {
    this.inboxRequested.emit();
  }

  private buildRow(
    key: HudLimitRow['key'],
    label: string,
    icon: string,
    current: number | undefined,
    limit: FarmLimitCounter,
  ): HudLimitRow {
    const value = current ?? limit.current;
    const max = limit.max;
    const full = max > 0 && value >= max;
    const near = !full && max > 0 && value >= max * NEAR_LIMIT_RATIO;
    const suffix = full ? ', đã đạt giới hạn' : near ? ', sắp đạt giới hạn' : '';
    return {
      key,
      label,
      icon,
      current: value,
      max,
      full,
      near,
      ariaLabel: `${label}: ${value} trên tối đa ${max}${suffix}`,
    };
  }
}
