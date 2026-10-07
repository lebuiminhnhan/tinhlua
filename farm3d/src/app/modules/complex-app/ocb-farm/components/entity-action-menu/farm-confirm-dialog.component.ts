import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  input,
  output,
  viewChild,
} from '@angular/core';

export interface FarmConfirmRow {
  label: string;
  value: string;
}

/** Kết quả sau khi thực hiện — hộp chuyển sang chế độ chỉ xem. */
export interface FarmConfirmResult {
  level: 'success' | 'warning';
  message: string;
  rows: FarmConfirmRow[];
}

/** Nội dung hộp xác nhận do container dựng (thao tác hàng loạt, bán vật nuôi / trang trí). */
export interface FarmConfirmContent {
  title: string;
  icon: string;
  message: string | null;
  rows: FarmConfirmRow[];
  warning: string | null;
  confirmLabel: string;
  danger: boolean;
}

/**
 * OCB Farm — hộp xác nhận dùng chung cho thao tác hàng loạt (cho ăn / tưới / thu hoạch tất
 * cả) và bán vật nuôi / vật trang trí (task 13.6, presentational).
 *
 * Nêu rõ số lượng, tổng chi phí hoặc số Hạt OCB hoàn lại trước khi xác nhận; huỷ thì không
 * gửi lệnh. Sau khi thực hiện hiển thị kết quả (ví dụ số vật nuôi đã / chưa được cho ăn).
 *
 * _Requirements: US-11, US-13, US-15, US-18, US-34_
 */
@Component({
  selector: 'app-farm-confirm-dialog',
  templateUrl: './farm-confirm-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'close()',
  },
})
export class FarmConfirmDialogComponent {
  readonly content = input.required<FarmConfirmContent>();
  readonly busy = input(false);
  readonly canConfirm = input(true);
  readonly error = input<string | null>(null);
  readonly result = input<FarmConfirmResult | null>(null);

  readonly confirm = output<void>();
  readonly closed = output<void>();

  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  readonly titleId = 'farm-confirm-dialog-title';

  constructor() {
    afterNextRender(() => this.dialog()?.nativeElement.focus());
  }

  onConfirm(): void {
    if (this.busy() || !this.canConfirm() || this.result()) return;
    this.confirm.emit();
  }

  close(): void {
    if (this.busy()) return;
    this.closed.emit();
  }
}
