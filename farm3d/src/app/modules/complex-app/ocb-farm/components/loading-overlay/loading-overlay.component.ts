import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import { FarmLoadItem, FarmLoadPhase } from './load-progress';

/**
 * OCB Farm — overlay tiến trình tải phủ lên khung 3D (US-39).
 *
 * Component trình bày thuần, dữ liệu lấy từ `FarmLoadTracker` của container:
 * - `loading`: thanh tiến trình 0–100% kèm nhãn hạng mục đang tải. Phần trăm hiển thị
 *   được chặn thêm một lớp ở đây: trong cùng `session` chỉ tăng hoặc giữ nguyên.
 * - `timeout` / `error`: dừng chờ, nêu nguyên nhân và nút thử lại (chặn sử dụng).
 * - `ready` + có hạng mục lỗi: thông báo KHÔNG chặn ở góc dưới, liệt kê hạng mục lỗi,
 *   có nút thử lại (chỉ tải lại hạng mục lỗi) và nút ẩn.
 *
 * Host đặt `position: absolute; inset: 0` — container phải là `position-relative`.
 *
 * _Requirements: US-39_
 */
@Component({
  selector: 'app-farm-loading-overlay',
  templateUrl: './loading-overlay.component.html',
  styleUrl: './loading-overlay.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.farm-loading-overlay--blocking]': 'blocking()',
  },
})
export class FarmLoadingOverlayComponent {
  readonly phase = input.required<FarmLoadPhase>();
  readonly percent = input<number>(0);
  /** Định danh lần tải — phần trăm chỉ được reset khi `session` đổi. */
  readonly session = input<number>(0);
  readonly currentLabel = input<string | null>(null);
  readonly failedItems = input<readonly FarmLoadItem[]>([]);
  /** Nguyên nhân lỗi chặn (thường là lỗi của hạng mục quan trọng). */
  readonly errorMessage = input<string | null>(null);
  readonly timeoutSeconds = input<number>(30);
  /** Đang chạy lại sau khi bấm thử lại — khoá nút để tránh bấm lặp. */
  readonly retrying = input<boolean>(false);

  /** Người dùng bấm thử lại — container chỉ tải lại các hạng mục lỗi. */
  readonly retry = output<void>();

  /** Phần trăm hiển thị: monotonic trong cùng `session`, luôn trong [0, 100]. */
  readonly displayPercent = linkedSignal<{ session: number; percent: number }, number>({
    source: () => ({ session: this.session(), percent: this.percent() }),
    computation: (src, previous) => {
      const value = Number.isFinite(src.percent) ? Math.min(100, Math.max(0, Math.floor(src.percent))) : 0;
      if (previous && previous.source.session === src.session) {
        return Math.max(previous.value, value);
      }
      return value;
    },
  });

  /** Ẩn thông báo lỗi không chặn; hiện lại khi danh sách lỗi đổi. */
  readonly failuresDismissed = linkedSignal<readonly FarmLoadItem[], boolean>({
    source: () => this.failedItems(),
    computation: () => false,
  });

  readonly blocking = computed(() => {
    const p = this.phase();
    return p === 'loading' || p === 'timeout' || p === 'error';
  });

  readonly showProgress = computed(() => this.phase() === 'loading');
  readonly showTimeout = computed(() => this.phase() === 'timeout');
  readonly showError = computed(() => this.phase() === 'error');

  readonly showFailureNotice = computed(
    () => this.phase() === 'ready' && this.failedItems().length > 0 && !this.failuresDismissed(),
  );

  readonly labelText = computed(() => this.currentLabel() || 'Đang chuẩn bị nông trại');

  readonly progressAria = computed(
    () => `Đang tải ${this.labelText().toLowerCase()}: ${this.displayPercent()}%`,
  );

  readonly failedCount = computed(() => this.failedItems().length);

  onRetry(): void {
    if (this.retrying()) return;
    this.retry.emit();
  }

  dismissFailures(): void {
    this.failuresDismissed.set(true);
  }
}
