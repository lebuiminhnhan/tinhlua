import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  input,
  linkedSignal,
  output,
  viewChild,
} from '@angular/core';
import type { FarmConfigResponse, FarmStateJson } from '../../models/ocb-farm.model';
import { formatSeeds } from '../shop-panel/shop-catalog';
import { ExpandPlotItem, buildExpandPlots, expandBlockMessage, expandSummary, plotLabel } from './expand-plan';

/** Yêu cầu mở vùng gửi cho container — container chuyển thành lệnh `EXPAND_PLOT`. */
export interface ExpandRequest {
  plotId: number;
  price: number;
  label: string;
}

interface ExpandPlotView extends ExpandPlotItem {
  priceLabel: string;
  missingLabel: string;
  requiredFirstLabel: string | null;
  message: string | null;
}

/**
 * OCB Farm — khu mở rộng vùng đất (task 13.4, presentational).
 *
 * - Mỗi vùng đang khoá hiển thị biểu tượng khoá và giá của chính vùng đó, kể cả khi chưa
 *   đủ Hạt OCB (nêu số còn thiếu).
 * - Vùng chưa kề phần đã mở bị chặn, nêu rõ vùng cần mở trước.
 * - Đã mở hết → trạng thái "đã mở hết", không còn thao tác mở rộng.
 * - Lỗi lưu: container hoàn tác cập nhật lạc quan (vùng vẫn khoá, số dư giữ nguyên) và
 *   truyền lỗi vào `expandError`; panel hiển thị lỗi kèm nút thử lại.
 *
 * _Requirements: US-24_
 */
@Component({
  selector: 'app-expand-panel',
  templateUrl: './expand-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'close()',
  },
})
export class ExpandPanelComponent {
  readonly state = input<FarmStateJson | null>(null);
  readonly balance = input(0);
  readonly config = input<FarmConfigResponse | null>(null);
  /** Vùng chọn sẵn (ví dụ vừa chạm một ô khoá trên khung 3D). */
  readonly preferredPlotId = input<number | null>(null);
  /** Được phép gửi lệnh (có mạng, không ghé thăm, không bận). */
  readonly canExpand = input(true);
  readonly expanding = input(false);
  /** Lỗi của lần mở gần nhất (server từ chối / lỗi lưu). */
  readonly expandError = input<string | null>(null);

  readonly expand = output<ExpandRequest>();
  readonly closed = output<void>();

  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  readonly titleId = 'ocb-expand-panel-title';
  readonly selectedId = linkedSignal<number | null>(() => this.preferredPlotId());

  readonly balanceLabel = computed(() => formatSeeds(this.balance()));
  readonly configMissing = computed(() => this.config() === null);
  readonly summary = computed(() => expandSummary(this.state()));

  readonly plots = computed<ExpandPlotView[]>(() =>
    buildExpandPlots(this.state(), this.config()?.values ?? null, this.balance()).map((p) => ({
      ...p,
      priceLabel: p.price === null ? '—' : formatSeeds(p.price),
      missingLabel: formatSeeds(p.missing),
      requiredFirstLabel: p.requiredFirstId === null ? null : plotLabel(p.requiredFirstId),
      message: expandBlockMessage(p),
    })),
  );

  readonly selected = computed<ExpandPlotView | null>(
    () => this.plots().find((p) => p.id === this.selectedId()) ?? null,
  );

  readonly balanceAfter = computed(() => {
    const p = this.selected();
    return p?.price != null && p.block === null ? formatSeeds(this.balance() - p.price) : null;
  });

  readonly confirmDisabled = computed(() => {
    const p = this.selected();
    return !p || p.block !== null || p.price === null || !this.canExpand() || this.expanding();
  });

  constructor() {
    afterNextRender(() => this.dialog()?.nativeElement.focus());
  }

  /** Vùng bị chặn vẫn chọn được để xem lý do (vùng cần mở trước, số Hạt OCB còn thiếu). */
  select(id: number): void {
    this.selectedId.set(this.selectedId() === id ? null : id);
  }

  cancelSelection(): void {
    this.selectedId.set(null);
  }

  confirm(): void {
    const p = this.selected();
    if (!p || p.price === null || this.confirmDisabled()) return;
    this.expand.emit({ plotId: p.id, price: p.price, label: p.label });
  }

  close(): void {
    this.closed.emit();
  }
}
