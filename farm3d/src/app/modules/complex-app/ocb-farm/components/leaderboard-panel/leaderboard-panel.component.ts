import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Subscription } from 'rxjs';
import type { FarmLeaderboardResponse, LeaderboardMetric } from '../../models/ocb-farm.model';
import { FarmApiService, httpErrorMessage } from '../../services/farm-api.service';
import {
  LEADERBOARD_DEFAULT_METRIC,
  LEADERBOARD_METRIC_TABS,
  formatLeaderboardValue,
  formatRefreshedAt,
  isSelfInRows,
} from './leaderboard';

/**
 * Discriminated union cho trạng thái tải — theo quy ước TypeScript steering
 * (`{ status: ...; data?: T; error?: string }`).
 */
type LeaderboardAsyncState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: FarmLeaderboardResponse }
  | { status: 'error'; error: string };

/**
 * OCB Farm — bảng xếp hạng (task 14.3, US-28, BR-23).
 *
 * - 3 tiêu chí (`seniority` mặc định khi mở lần đầu trong phiên, `assets`, `streak`),
 *   lọc được theo phòng ban của chính nhân viên (bật/tắt — server không cung cấp danh
 *   sách phòng ban cho endpoint này, BR-23 chỉ cho phép hiển thị tên/phòng ban/giá trị).
 * - Top 20 hiển thị ĐÚNG số dòng server trả, không chèn dòng trống/giữ chỗ.
 * - Dòng của chính nhân viên (`me`) luôn hiển thị và được đánh dấu khác biệt: nếu đã
 *   nằm trong top hiển thị thì đánh dấu ngay dòng đó; nếu không, ghim thêm một dòng
 *   riêng ở cuối danh sách.
 * - Lỗi tải → thông báo rõ kèm nút thử lại, KHÔNG hiển thị danh sách một phần (giữ
 *   nguyên dữ liệu cũ ẩn đi, chỉ còn thông báo lỗi).
 *
 * _Requirements: US-28, BR-23_
 */
@Component({
  selector: 'app-leaderboard-panel',
  templateUrl: './leaderboard-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'close()',
  },
})
export class LeaderboardPanelComponent {
  private readonly api = inject(FarmApiService);

  /** Mã + tên phòng ban của chính nhân viên — dùng cho lựa chọn lọc (BR-23: không gọi API phòng ban khác). */
  readonly selfDepartmentId = input<number | null>(null);
  readonly selfDepartmentName = input<string | null>(null);

  readonly closed = output<void>();

  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  readonly titleId = 'leaderboard-panel-title';
  readonly metricTabs = LEADERBOARD_METRIC_TABS;

  readonly metric = signal<LeaderboardMetric>(LEADERBOARD_DEFAULT_METRIC);
  /** `true` → lọc theo phòng ban của chính nhân viên; `false` → toàn công ty. */
  readonly filterOwnDepartment = signal(false);

  private readonly state = signal<LeaderboardAsyncState>({ status: 'idle' });
  readonly status = computed(() => this.state().status);
  readonly errorMessage = computed(() => {
    const s = this.state();
    return s.status === 'error' ? s.error : null;
  });
  private readonly data = computed(() => {
    const s = this.state();
    return s.status === 'success' ? s.data : null;
  });

  readonly rows = computed(() => this.data()?.rows ?? []);
  readonly me = computed(() => this.data()?.me ?? null);
  /** Dòng của chính nhân viên đã nằm trong top hiển thị → không ghim dòng riêng nữa. */
  readonly selfInRows = computed(() => isSelfInRows(this.rows(), this.me()));
  /** Ghim riêng khi có `me` và `me` chưa xuất hiện trong top hiển thị (US-28). */
  readonly pinnedSelf = computed(() => (this.selfInRows() ? null : this.me()));
  readonly isEmpty = computed(() => this.status() === 'success' && this.rows().length === 0);
  readonly refreshedAtLabel = computed(() => {
    const d = this.data();
    return d ? formatRefreshedAt(d.refreshed_at) : '';
  });
  readonly canFilterOwnDepartment = computed(() => this.selfDepartmentId() !== null);

  valueLabel(value: number): string {
    return formatLeaderboardValue(this.metric(), value);
  }

  private sub: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.sub?.unsubscribe());
    afterNextRender(() => {
      this.dialog()?.nativeElement.focus();
      this.load();
    });
  }

  selectMetric(metric: LeaderboardMetric): void {
    if (metric === this.metric()) return;
    this.metric.set(metric);
    this.load();
  }

  toggleOwnDepartment(): void {
    if (!this.canFilterOwnDepartment()) return;
    this.filterOwnDepartment.set(!this.filterOwnDepartment());
    this.load();
  }

  retry(): void {
    this.load();
  }

  close(): void {
    this.closed.emit();
  }

  /** Tải bảng xếp hạng theo tiêu chí + lọc phòng ban hiện tại; huỷ request trước còn dở. */
  private load(): void {
    this.sub?.unsubscribe();
    this.state.set({ status: 'loading' });
    const departmentId = this.filterOwnDepartment() ? this.selfDepartmentId() : null;
    this.sub = this.api.getLeaderboard(this.metric(), departmentId).subscribe({
      next: (res) => this.state.set({ status: 'success', data: res }),
      error: (err: unknown) => this.state.set({ status: 'error', error: httpErrorMessage(err) }),
    });
  }
}
