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
import type { FarmInboxResponse } from '../../models/ocb-farm.model';
import { FarmApiService, httpErrorMessage } from '../../services/farm-api.service';
import { InboxGreetingRowView, toInboxGreetingRow, toInboxHelpRow } from './inbox';

type InboxLoadStatus = 'loading' | 'success' | 'error';
type InboxTab = 'helps' | 'greetings';

/**
 * OCB Farm — hộp thư: người đã giúp + lời chúc (task 14.2, US-8, US-27, US-48).
 *
 * - Tự gọi `GET /me/inbox` khi mở, rồi `POST /me/inbox/read` ngay sau đó để xoá cờ "mới"
 *   (US-8, US-27: mục chưa xem được đánh dấu "mới" cho tới khi chủ nông trại MỞ danh sách).
 *   Đánh dấu đọc chạy khi mở panel (không phải khi đóng) nên lần mở kế tiếp không còn
 *   dấu "mới" của các mục đã thấy, kể cả khi nhân viên đóng panel ngay lập tức.
 * - Hai tab: "Người đã giúp" (chỉ xem — là nhật ký hoạt động, không xoá được) và
 *   "Lời chúc" (xoá được từng lời chúc hoặc xoá toàn bộ, US-48).
 * - Xoá toàn bộ yêu cầu xác nhận trước khi gọi API (hành động không hoàn tác được).
 *
 * _Requirements: US-8, US-27, US-48_
 */
@Component({
  selector: 'app-inbox-panel',
  templateUrl: './inbox-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'close()',
  },
})
export class InboxPanelComponent {
  private readonly api = inject(FarmApiService);

  readonly closed = output<void>();
  /** Phát sau khi `/me/inbox/read` thành công — container cập nhật lại `inbox_new_count` trên HUD. */
  readonly markedRead = output<void>();

  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  readonly titleId = 'inbox-panel-title';

  readonly status = signal<InboxLoadStatus>('loading');
  readonly errorMessage = signal<string | null>(null);
  readonly tab = signal<InboxTab>('helps');
  private readonly data = signal<FarmInboxResponse | null>(null);

  readonly helpRows = computed(() => (this.data()?.helps ?? []).map(toInboxHelpRow));
  readonly greetingRows = computed(() => (this.data()?.greetings ?? []).map(toInboxGreetingRow));
  readonly hasHelps = computed(() => this.helpRows().length > 0);
  readonly hasGreetings = computed(() => this.greetingRows().length > 0);

  readonly deletingId = signal<number | null>(null);
  readonly deleteError = signal<string | null>(null);
  readonly clearConfirming = signal(false);
  readonly clearing = signal(false);

  private sub: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.sub?.unsubscribe());
    afterNextRender(() => {
      this.dialog()?.nativeElement.focus();
      this.load();
    });
  }

  selectTab(tab: InboxTab): void {
    this.tab.set(tab);
    this.deleteError.set(null);
    this.clearConfirming.set(false);
  }

  retry(): void {
    this.load();
  }

  close(): void {
    this.closed.emit();
  }

  /** Xoá một lời chúc (US-48); lỗi hiển thị ngay trong panel, danh sách giữ nguyên. */
  deleteGreeting(id: number): void {
    if (this.deletingId() !== null) return;
    this.deleteError.set(null);
    this.deletingId.set(id);
    this.api.deleteGreeting(id).subscribe({
      next: () => {
        this.data.update((d) => (d ? { ...d, greetings: d.greetings.filter((g) => g.id !== id) } : d));
        this.deletingId.set(null);
      },
      error: (err: unknown) => {
        this.deleteError.set(httpErrorMessage(err));
        this.deletingId.set(null);
      },
    });
  }

  /** Mở hộp xác nhận "xoá toàn bộ" — hành động không hoàn tác được. */
  confirmClearAll(): void {
    this.clearConfirming.set(true);
    this.deleteError.set(null);
  }

  cancelClearAll(): void {
    this.clearConfirming.set(false);
  }

  clearAllGreetings(): void {
    if (this.clearing()) return;
    this.deleteError.set(null);
    this.clearing.set(true);
    this.api.clearGreetings().subscribe({
      next: () => {
        this.data.update((d) => (d ? { ...d, greetings: [] } : d));
        this.clearing.set(false);
        this.clearConfirming.set(false);
      },
      error: (err: unknown) => {
        this.deleteError.set(httpErrorMessage(err));
        this.clearing.set(false);
      },
    });
  }

  trackGreeting = (_: number, row: InboxGreetingRowView): number => row.id;

  /** Tải hộp thư rồi đánh dấu đã xem — mở panel LÀ hành động "mở danh sách" theo US-27. */
  private load(): void {
    this.sub?.unsubscribe();
    this.status.set('loading');
    this.errorMessage.set(null);
    this.sub = this.api.getInbox().subscribe({
      next: (res) => {
        this.data.set(res);
        this.status.set('success');
        this.markAsRead();
      },
      error: (err: unknown) => {
        this.errorMessage.set(httpErrorMessage(err));
        this.status.set('error');
      },
    });
  }

  /** Đánh dấu đã xem toàn bộ hộp thư; lỗi ở đây không chặn việc xem nội dung đã tải. */
  private markAsRead(): void {
    const d = this.data();
    if (!d || (d.helps.every((h) => !h.is_new) && d.greetings.every((g) => !g.is_new))) return;
    this.api.markInboxRead().subscribe({
      next: () => {
        this.data.update((cur) =>
          cur
            ? {
                ...cur,
                helps: cur.helps.map((h) => ({ ...h, is_new: false })),
                greetings: cur.greetings.map((g) => ({ ...g, is_new: false })),
                new_count: 0,
              }
            : cur,
        );
        this.markedRead.emit();
      },
      error: () => {
        // Không chặn hiển thị — lần mở sau sẽ thử đánh dấu lại.
      },
    });
  }
}
