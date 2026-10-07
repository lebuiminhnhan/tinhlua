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
import type { FarmOfflineSummary, FarmStateJson } from '../../models/ocb-farm.model';
import { cappedEntityRows, formatAwayDuration, offlineSummaryRows } from './offline-summary';

/**
 * OCB Farm — bảng tổng kết tích lũy khi vắng mặt (task 13.5, presentational).
 *
 * - Độ dài thời gian vắng mặt, từng loại sản phẩm đang chờ thu hoạch kèm số lượng,
 *   các vật nuôi / cây đã đạt trần tích lũy (thời gian vượt trần không tạo thêm sản phẩm).
 * - Một nút "Thu hoạch toàn bộ" → container gửi `HARVEST_ALL`.
 * - Container chỉ mở bảng khi có sản phẩm tích lũy (`hasOfflineAccumulation`).
 *
 * _Requirements: US-23_
 */
@Component({
  selector: 'app-offline-summary-dialog',
  templateUrl: './offline-summary-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'close()',
  },
})
export class OfflineSummaryDialogComponent {
  readonly summary = input.required<FarmOfflineSummary>();
  /** Trạng thái nông trại hiện tại — để gắn tên loài/cây cho đối tượng đạt trần. */
  readonly state = input<FarmStateJson | null>(null);
  readonly canHarvest = input(true);
  readonly harvesting = input(false);
  readonly error = input<string | null>(null);

  readonly harvestAll = output<void>();
  readonly closed = output<void>();

  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  readonly titleId = 'farm-offline-summary-title';

  readonly awayLabel = computed(() => formatAwayDuration(this.summary().away_ms));
  readonly rows = computed(() => offlineSummaryRows(this.summary()));
  readonly totalQuantity = computed(() => this.rows().reduce((sum, r) => sum + r.quantity, 0));
  readonly cappedEntities = computed(() => cappedEntityRows(this.summary(), this.state()));
  readonly rainCycles = computed(() => Math.max(0, this.summary().rain_cycles ?? 0));
  readonly harvestDisabled = computed(() => !this.canHarvest() || this.harvesting());

  constructor() {
    afterNextRender(() => this.dialog()?.nativeElement.focus());
  }

  onHarvestAll(): void {
    if (this.harvestDisabled()) return;
    this.harvestAll.emit();
  }

  close(): void {
    if (this.harvesting()) return;
    this.closed.emit();
  }
}
