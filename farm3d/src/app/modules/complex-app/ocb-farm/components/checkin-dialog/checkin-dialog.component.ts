import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  input,
  output,
  viewChild,
} from '@angular/core';
import type { FarmCheckinStatus } from '../../models/ocb-farm.model';
import { formatCheckinReset, previewNextStreak } from './checkin';

/** Các mốc chuỗi có thưởng (US-25) — chỉ để hiển thị tiến độ tới mốc kế tiếp. */
const STREAK_MILESTONES: readonly number[] = [3, 7, 14, 30];

/**
 * OCB Farm — hộp thưởng check-in hằng ngày (task 13.5, presentational).
 *
 * - Chưa nhận: số Hạt OCB sẽ nhận (thưởng cơ bản + thưởng mốc nếu có), chuỗi hiện tại,
 *   nút nhận thưởng. Lỗi → giữ hộp mở, hiển thị lỗi và cho thử lại trong ngày.
 * - Đã nhận: trạng thái đã check-in kèm mốc làm mới 00:00 giờ Việt Nam ngày kế tiếp.
 *
 * Container (`ocb-farm-main`) gửi lệnh `CLAIM_CHECKIN` khi nhận `claim`.
 *
 * _Requirements: US-25_
 */
@Component({
  selector: 'app-checkin-dialog',
  templateUrl: './checkin-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'close()',
  },
})
export class CheckinDialogComponent {
  readonly status = input.required<FarmCheckinStatus>();
  /** Hôm nay theo giờ Việt Nam (`YYYY-MM-DD`). */
  readonly todayIso = input.required<string>();
  readonly canClaim = input(true);
  readonly claiming = input(false);
  readonly error = input<string | null>(null);
  /** Tổng Hạt OCB vừa nhận trong phiên — hiển thị ở trạng thái đã check-in. */
  readonly receivedReward = input<number | null>(null);

  readonly claim = output<void>();
  readonly closed = output<void>();

  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  readonly titleId = 'farm-checkin-dialog-title';

  readonly claimed = computed(() => this.status().claimed_today);
  readonly streak = computed(() => Math.max(0, this.status().streak));
  readonly baseReward = computed(() => Math.max(0, this.status().next_reward));
  readonly bonus = computed(() => Math.max(0, this.status().next_streak_bonus));
  readonly totalReward = computed(() => this.baseReward() + this.bonus());
  /** Chuỗi sau khi nhận lượt này (tham khảo — server là nguồn chân lý). */
  readonly nextStreak = computed(() =>
    previewNextStreak(this.streak(), this.status().last_checkin_date, this.todayIso()),
  );
  readonly streakBroken = computed(
    () => !this.claimed() && this.streak() > 0 && this.nextStreak() === 1,
  );
  readonly resetLabel = computed(() => formatCheckinReset(this.status().resets_at) ?? '00:00 ngày mai (giờ Việt Nam)');

  /** Mốc thưởng kế tiếp tính từ chuỗi sẽ đạt (sau mốc 30 là bội số của 30). */
  readonly nextMilestone = computed(() => {
    const s = this.claimed() ? this.streak() : this.nextStreak();
    const fixed = STREAK_MILESTONES.find((m) => m > s);
    const target = fixed ?? (Math.floor(s / 30) + 1) * 30;
    return { target, remaining: target - s, percent: Math.min(100, Math.round((s / target) * 100)) };
  });

  readonly claimDisabled = computed(() => !this.canClaim() || this.claiming() || this.claimed());

  constructor() {
    afterNextRender(() => this.dialog()?.nativeElement.focus());
  }

  onClaim(): void {
    if (this.claimDisabled()) return;
    this.claim.emit();
  }

  close(): void {
    // Không đóng giữa chừng khi đang gửi lệnh để kết quả không bị "mất".
    if (this.claiming()) return;
    this.closed.emit();
  }
}
