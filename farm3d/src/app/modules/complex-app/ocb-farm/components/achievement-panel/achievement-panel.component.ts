import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Subscription } from 'rxjs';
import type { AchievementCode, FarmAchievementView } from '../../models/ocb-farm.model';
import { ACHIEVEMENT_NAMES } from '../farm-hud/farm-hud.component';
import { FarmApiService, httpErrorMessage } from '../../services/farm-api.service';
import { FarmStateStore } from '../../services/farm-state.store';
import {
  achievementProgressPercent,
  formatAchievementDate,
  resolveBadgesShownMax,
  sortAchievements,
  toggleBadgeSelection,
} from './achievement';

/**
 * Discriminated union cho trạng thái tải — theo quy ước TypeScript steering
 * (`{ status: ...; data?: T; error?: string }`).
 */
type AchievementAsyncState =
  | { status: 'loading' }
  | { status: 'success'; data: FarmAchievementView[] }
  | { status: 'error'; error: string };

/** Một thành tựu đã dựng sẵn để hiển thị. */
export interface AchievementRow {
  code: AchievementCode;
  name: string;
  description: string;
  reward: number;
  unlocked: boolean;
  unlockedLabel: string | null;
  progress: number;
  target: number;
  progressPercent: number;
  progressLabel: string;
  selected: boolean;
}

/**
 * OCB Farm — `achievement-panel` (task 14.4, US-29, BR-12).
 *
 * - Danh sách toàn bộ thành tựu từ `GET /me/achievements`: đã đạt hiển thị ngày đạt,
 *   chưa đạt hiển thị điều kiện (mô tả) kèm tiến trình hiện tại so với mốc cần đạt.
 * - Thông báo lần lượt khi nhiều thành tựu đạt cùng lúc đã được xử lý ở
 *   `OcbFarmMainComponent.afterAction()` (toast nối tiếp theo thứ tự `achievements_unlocked`
 *   trả về từ MỌI lệnh, không riêng của panel này) — panel chỉ hiển thị trạng thái đã đạt.
 * - Chọn huy hiệu hiển thị: giới hạn theo `me().limits.badges_shown.max` (BR-12). Vượt giới
 *   hạn thì KHÔNG cho chọn thêm — các checkbox còn lại tự khoá và hiện thông báo rõ, đúng
 *   quy ước "ngăn chọn vượt" thay vì chặn ở bước lưu.
 * - Lưu lựa chọn qua lệnh `SELECT_BADGES` (tái dùng `FarmStateStore.dispatch`, cùng cơ chế
 *   với `UPDATE_SETTINGS` ở `settings-panel`) — chỉ huy hiệu đã đạt mới chọn được.
 *
 * _Requirements: US-29, BR-12_
 */
@Component({
  selector: 'app-achievement-panel',
  templateUrl: './achievement-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'close()',
  },
})
export class AchievementPanelComponent {
  private readonly api = inject(FarmApiService);
  private readonly store = inject(FarmStateStore);

  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  readonly closed = output<void>();

  readonly titleId = 'achievement-panel-title';

  private readonly state = signal<AchievementAsyncState>({ status: 'loading' });
  readonly status = computed(() => this.state().status);
  readonly errorMessage = computed(() => {
    const s = this.state();
    return s.status === 'error' ? s.error : null;
  });
  private readonly achievements = computed(() => {
    const s = this.state();
    return s.status === 'success' ? s.data : [];
  });

  /** Huy hiệu đang được chọn hiển thị, lạc quan trên client (US-29). */
  private readonly selectedOverride = signal<AchievementCode[] | null>(null);
  readonly selectedBadges = computed<AchievementCode[]>(
    () => this.selectedOverride() ?? this.store.state()?.badges_shown ?? [],
  );

  readonly badgesMax = computed(() => resolveBadgesShownMax(this.store.me()?.limits.badges_shown.max));
  readonly badgesCount = computed(() => this.selectedBadges().length);
  readonly atBadgeLimit = computed(() => this.badgesCount() >= this.badgesMax());

  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  /** Thông báo khi nhân viên thử chọn thêm huy hiệu lúc đã đạt giới hạn (BR-12). */
  readonly limitNotice = signal(false);

  readonly rows = computed<AchievementRow[]>(() => {
    const selected = new Set(this.selectedBadges());
    return sortAchievements(this.achievements()).map((a) => this.toRow(a, selected));
  });

  readonly isEmpty = computed(() => this.status() === 'success' && this.rows().length === 0);

  private sub: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.sub?.unsubscribe());
    afterNextRender(() => {
      this.dialog()?.nativeElement.focus();
      this.load();
    });
  }

  retry(): void {
    this.load();
  }

  close(): void {
    this.closed.emit();
  }

  dismissLimitNotice(): void {
    this.limitNotice.set(false);
  }

  /**
   * Bật/tắt một huy hiệu trong danh sách hiển thị. Vượt giới hạn (BR-12) thì không cho
   * chọn thêm — hiện thông báo rõ, giữ nguyên lựa chọn hiện tại.
   */
  toggleBadge(code: AchievementCode): void {
    if (!this.store.initialized() || this.store.isVisiting() || this.saving()) return;
    const row = this.rows().find((r) => r.code === code);
    if (!row?.unlocked) return;

    const { next, blocked } = toggleBadgeSelection(this.selectedBadges(), code, this.badgesMax());
    if (blocked) {
      this.limitNotice.set(true);
      return;
    }
    this.limitNotice.set(false);
    this.selectedOverride.set(next);
    void this.save(next);
  }

  private async save(badges: AchievementCode[]): Promise<void> {
    this.saveError.set(null);
    this.saving.set(true);
    try {
      const result = await this.store.dispatch('SELECT_BADGES', { badges }, { label: 'Chọn huy hiệu' });
      if (!result.ok) {
        // Lưu thất bại — hoàn tác về lựa chọn đã xác nhận gần nhất của server.
        this.selectedOverride.set(null);
        this.saveError.set(result.error.message);
        this.store.clearError();
      }
    } finally {
      this.saving.set(false);
    }
  }

  private toRow(a: FarmAchievementView, selected: ReadonlySet<AchievementCode>): AchievementRow {
    const percent = achievementProgressPercent(a.progress, a.target);
    return {
      code: a.code,
      name: a.name || ACHIEVEMENT_NAMES[a.code] || a.code,
      description: a.description,
      reward: a.reward,
      unlocked: a.unlocked,
      unlockedLabel: a.unlocked && a.unlocked_at ? formatAchievementDate(a.unlocked_at) : null,
      progress: Math.min(a.progress, a.target),
      target: a.target,
      progressPercent: percent,
      progressLabel: `${Math.min(a.progress, a.target)}/${a.target}`,
      selected: selected.has(a.code),
    };
  }

  /** Tải danh sách thành tựu; huỷ request trước còn dở (ví dụ mở lại nhanh). */
  private load(): void {
    this.sub?.unsubscribe();
    this.state.set({ status: 'loading' });
    this.sub = this.api.getAchievements().subscribe({
      next: (data) => this.state.set({ status: 'success', data }),
      error: (err: unknown) => this.state.set({ status: 'error', error: httpErrorMessage(err) }),
    });
  }
}
