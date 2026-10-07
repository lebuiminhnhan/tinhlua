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
import { FormsModule } from '@angular/forms';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import type { FarmListItem } from '../../models/ocb-farm.model';
import { FarmApiService, httpErrorMessage } from '../../services/farm-api.service';
import {
  VISIT_PAGE_SIZE,
  VISIT_SEARCH_MIN_CHARS,
  VisitDepartmentOption,
  collectDepartmentOptions,
  isSearchableQuery,
  seniorityLabel,
} from './visit-browser';

type VisitBrowserStatus = 'loading' | 'success' | 'error';

/** Một đồng nghiệp được chọn để ghé thăm — container gọi `GET /farms/:userId`. */
export interface VisitSelection {
  userId: number;
  fullName: string;
  hasFarm: boolean;
}

/**
 * OCB Farm — danh sách nông trại đồng nghiệp để ghé thăm (task 14.1, presentational).
 *
 * - Tìm theo tên từ {@link VISIT_SEARCH_MIN_CHARS} ký tự (debounce 300ms), kết hợp được
 *   với lọc phòng ban; cả hai gửi cùng `GET /farms` nên luôn khớp quy tắc server (US-26).
 * - Trạng thái trống (không khớp từ khoá) có gợi ý đổi từ khoá; đồng nghiệp chưa có nông
 *   trại (`has_farm = false`) vẫn hiện trong danh sách kèm nhãn riêng, bấm vào vẫn báo rõ
 *   lý do không mở được khung nông trại thay vì coi là lỗi tải.
 * - Phân trang server-side; danh sách phòng ban cho bộ lọc được gộp dần từ các trang đã
 *   tải (không có endpoint riêng cho `ocb-farm`).
 *
 * _Requirements: US-8, US-26, BR-21_
 */
@Component({
  selector: 'app-visit-browser',
  templateUrl: './visit-browser.component.html',
  styleUrl: './visit-browser.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  host: {
    '(document:keydown.escape)': 'close()',
  },
})
export class VisitBrowserComponent {
  private readonly api = inject(FarmApiService);

  /** Container mở nông trại ở chế độ ghé thăm (US-26). */
  readonly selected = output<VisitSelection>();
  readonly closed = output<void>();

  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  readonly titleId = 'visit-browser-title';
  readonly minChars = VISIT_SEARCH_MIN_CHARS;

  readonly query = signal('');
  readonly departmentId = signal<number | null>(null);
  readonly departments = signal<VisitDepartmentOption[]>([]);

  readonly status = signal<VisitBrowserStatus>('loading');
  readonly errorMessage = signal<string | null>(null);
  readonly page = signal(1);
  private readonly items = signal<FarmListItem[]>([]);
  private readonly total = signal(0);
  private readonly hasMore = signal(false);

  readonly rows = computed(() =>
    this.items().map((item) => ({ ...item, seniorityText: seniorityLabel(item.seniority_months) })),
  );
  readonly isEmpty = computed(() => this.status() === 'success' && this.items().length === 0);
  readonly hasPrev = computed(() => this.page() > 1);
  readonly hasNext = computed(() => this.hasMore());
  readonly rangeLabel = computed(() => {
    const n = this.items().length;
    if (n === 0) return '';
    const from = (this.page() - 1) * VISIT_PAGE_SIZE + 1;
    return `${from}–${from + n - 1} / ${this.total()}`;
  });
  /** Từ khoá chưa đủ ký tự — không gửi request, chỉ nêu rõ cho người dùng (US-26). */
  readonly queryTooShort = computed(() => !isSearchableQuery(this.query()));

  private readonly querySubject = new Subject<string>();
  private sub: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.sub?.unsubscribe());
    this.querySubject.pipe(debounceTime(300), distinctUntilChanged()).subscribe(() => this.load(1));
    afterNextRender(() => {
      this.dialog()?.nativeElement.focus();
      this.load(1);
    });
  }

  onQueryInput(value: string): void {
    this.query.set(value);
    this.querySubject.next(value);
  }

  clearQuery(): void {
    this.onQueryInput('');
  }

  selectDepartment(value: string): void {
    this.departmentId.set(value ? Number(value) : null);
    this.load(1);
  }

  onDepartmentChange(event: Event): void {
    const value = (event.target as HTMLSelectElement | null)?.value ?? '';
    this.selectDepartment(value);
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

  pick(item: FarmListItem): void {
    this.selected.emit({ userId: item.user_id, fullName: item.full_name, hasFarm: item.has_farm });
  }

  close(): void {
    this.closed.emit();
  }

  private load(page: number): void {
    if (this.queryTooShort()) return;
    this.sub?.unsubscribe();
    this.page.set(page);
    this.status.set('loading');
    this.errorMessage.set(null);
    this.sub = this.api
      .getFarms({ q: this.query(), departmentId: this.departmentId(), page, pageSize: VISIT_PAGE_SIZE })
      .subscribe({
        next: (res) => {
          this.items.set(res.items);
          this.total.set(res.total);
          this.hasMore.set(res.has_more);
          this.page.set(res.page);
          this.departments.update((prev) => collectDepartmentOptions(res.items, prev));
          this.status.set('success');
        },
        error: (err: unknown) => {
          this.errorMessage.set(httpErrorMessage(err));
          this.status.set('error');
        },
      });
  }
}
