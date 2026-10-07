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
import type { FarmLedgerPage } from '../../models/ocb-farm.model';
import { FarmApiService, httpErrorMessage } from '../../services/farm-api.service';
import {
  LEDGER_DEFAULT_PAGE_SIZE,
  LEDGER_MIN_RECENT,
  formatSeeds,
  ledgerPageItems,
  toLedgerRow,
  totalLedgerPages,
} from './ledger';

type LedgerLoadStatus = 'loading' | 'success' | 'error';

/** Gợi ý cách phát sinh giao dịch đầu tiên cho trạng thái trống (US-21). */
export const LEDGER_EMPTY_TIPS: readonly { icon: string; text: string }[] = [
  { icon: 'bi bi-calendar-check', text: 'Bấm "Check-in" để nhận thưởng Hạt OCB mỗi ngày.' },
  { icon: 'bi bi-shop', text: 'Mở cửa hàng để mua vật nuôi hoặc hạt giống đầu tiên.' },
  { icon: 'bi bi-basket', text: 'Thu hoạch sản phẩm rồi bán trong kho để nhận Hạt OCB.' },
];

/**
 * OCB Farm — bảng lịch sử thu chi (task 13.3).
 *
 * - Tự gọi `GET /me/ledger` theo từng trang (số dòng mỗi trang do container truyền từ
 *   cấu hình), sắp xếp mới nhất trước — thứ tự do server bảo đảm.
 * - Mỗi dòng: ngày giờ phút (UTC+7), nội dung, dấu tăng/giảm, số thay đổi, số dư sau.
 * - Trống → hướng dẫn phát sinh giao dịch đầu tiên; lỗi tải → thông báo + nút thử lại,
 *   số Hạt OCB hiện tại (từ store, qua input) vẫn hiển thị ở đầu bảng.
 *
 * _Requirements: US-21_
 */
@Component({
  selector: 'app-ledger-panel',
  templateUrl: './ledger-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'close()',
  },
})
export class LedgerPanelComponent {
  private readonly api = inject(FarmApiService);

  /** Số Hạt OCB hiện tại — luôn hiển thị kể cả khi tải lịch sử lỗi. */
  readonly balance = input.required<number>();
  readonly pageSize = input<number>(LEDGER_DEFAULT_PAGE_SIZE);

  readonly closed = output<void>();

  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  readonly titleId = 'ledger-panel-title';
  readonly emptyTips = LEDGER_EMPTY_TIPS;
  readonly minRecent = LEDGER_MIN_RECENT;

  readonly status = signal<LedgerLoadStatus>('loading');
  readonly errorMessage = signal<string | null>(null);
  readonly page = signal(1);
  private readonly data = signal<FarmLedgerPage | null>(null);

  readonly rows = computed(() => (this.data()?.entries ?? []).map(toLedgerRow));
  readonly total = computed(() => this.data()?.total ?? 0);
  /** Số dòng mỗi trang thực tế (server có thể chặn trên). */
  private readonly effectivePageSize = computed(() => this.data()?.page_size ?? this.pageSize());
  readonly totalPages = computed(() => totalLedgerPages(this.total(), this.effectivePageSize()));
  readonly pageItems = computed(() => ledgerPageItems(this.page(), this.totalPages()));
  readonly hasPrev = computed(() => this.page() > 1);
  readonly hasNext = computed(() => this.data()?.has_more ?? false);
  readonly isEmpty = computed(
    () => this.status() === 'success' && this.total() === 0 && this.page() === 1,
  );
  readonly rangeLabel = computed(() => {
    const d = this.data();
    if (!d || d.entries.length === 0) return '';
    const from = (d.page - 1) * d.page_size + 1;
    return `${from}–${from + d.entries.length - 1} / ${d.total}`;
  });
  /** Tổng thu / chi của trang đang xem — giúp nhìn nhanh đang kiếm và tiêu vào đâu. */
  readonly pageSummary = computed(() => {
    let income = 0;
    let spend = 0;
    for (const r of this.rows()) {
      if (r.direction === 'in') income += r.amountAbs;
      else if (r.direction === 'out') spend += r.amountAbs;
    }
    return { income: formatSeeds(income), spend: formatSeeds(spend) };
  });
  readonly balanceLabel = computed(() => formatSeeds(Math.max(0, this.balance())));

  private sub: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.sub?.unsubscribe());
    afterNextRender(() => {
      this.dialog()?.nativeElement.focus();
      this.load(1);
    });
  }

  goTo(page: number): void {
    if (page < 1 || page > this.totalPages() || page === this.page()) return;
    this.load(page);
  }

  prev(): void {
    if (this.hasPrev()) this.load(this.page() - 1);
  }

  next(): void {
    if (this.hasNext()) this.load(this.page() + 1);
  }

  retry(): void {
    this.load(this.page());
  }

  close(): void {
    this.closed.emit();
  }

  /** Tải một trang; huỷ request trước còn dở để không bị response cũ ghi đè. */
  private load(page: number): void {
    this.sub?.unsubscribe();
    this.page.set(page);
    this.status.set('loading');
    this.errorMessage.set(null);
    this.sub = this.api.getLedger(page, this.pageSize()).subscribe({
      next: (res) => {
        this.data.set(res);
        this.page.set(res.page);
        this.status.set('success');
      },
      error: (err: unknown) => {
        this.errorMessage.set(httpErrorMessage(err));
        this.status.set('error');
      },
    });
  }
}
