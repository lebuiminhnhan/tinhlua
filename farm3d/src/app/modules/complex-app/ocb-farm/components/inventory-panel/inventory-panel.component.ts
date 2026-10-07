import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type {
  FarmConfigResponse,
  FarmLimits,
  FarmStateJson,
  StorageKey,
} from '../../models/ocb-farm.model';
import { formatSeeds } from '../shop-panel/shop-catalog';
import {
  InventoryRow,
  SellBreakdown,
  buildInventoryRows,
  horseBonusInfo,
  horseBonusReasonText,
  inventoryTotal,
  sellBreakdown,
  validateSellQuantity,
} from './inventory';

/** Yêu cầu bán gửi cho container — container chuyển thành `SELL_PRODUCT`. */
export interface InventorySale {
  product: StorageKey;
  label: string;
  quantity: number;
  /** Số lượng panel đang thấy — server từ chối `QUANTITY_CHANGED` nếu lệch (US-22). */
  expectedQuantity: number;
  preview: SellBreakdown;
}

/** Hướng dẫn thu hoạch cho trạng thái kho trống (US-13, US-20, US-22). */
export const INVENTORY_EMPTY_TIPS: readonly { icon: string; text: string }[] = [
  { icon: 'bi bi-egg', text: 'Cho vật nuôi ăn đều để chúng tạo trứng, sữa, len, cá tươi hoặc phân hữu cơ.' },
  { icon: 'bi bi-basket', text: 'Bấm "Thu hoạch tất cả" để gom mọi sản phẩm đang chờ vào kho.' },
  { icon: 'bi bi-flower1', text: 'Trồng cây ăn quả và hoa, tưới nước đầy đủ rồi thu hoạch khi cây sẵn sàng.' },
];

/**
 * OCB Farm — kho và bán sản phẩm (task 13.2, presentational).
 *
 * - Bảng từng loại sản phẩm: số lượng, giá một đơn vị, giá trị ước tính; tổng giá trị
 *   ước tính nếu bán toàn bộ kho.
 * - Chọn loại → nhập số lượng trong [1, đang có] hoặc "Bán toàn bộ"; xem trước tách
 *   riêng giá gốc / thưởng ngựa / tổng nhận (thưởng chỉ tính ngựa bình thường, kẹp
 *   trần; bằng 0 thì nêu lý do).
 * - Số lượng bị đổi ở thiết bị khác → container làm mới state và truyền `notice`.
 *
 * _Requirements: US-13, US-14, US-20, US-22_
 */
@Component({
  selector: 'app-inventory-panel',
  templateUrl: './inventory-panel.component.html',
  styleUrl: './inventory-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'close()',
  },
})
export class InventoryPanelComponent {
  readonly state = input<FarmStateJson | null>(null);
  readonly balance = input(0);
  readonly limits = input<FarmLimits | null>(null);
  readonly config = input<FarmConfigResponse | null>(null);
  /** Được phép gửi lệnh bán (có mạng, không ghé thăm, không bận). */
  readonly canSell = input(true);
  readonly selling = input(false);
  readonly refreshing = input(false);
  /** Lỗi của lần bán gần nhất. */
  readonly sellError = input<string | null>(null);
  /** Thông báo kho đã được làm mới (ví dụ số lượng đổi ở thiết bị khác). */
  readonly notice = input<string | null>(null);

  readonly sell = output<InventorySale>();
  readonly refresh = output<void>();
  readonly closed = output<void>();

  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  readonly titleId = 'ocb-inventory-panel-title';
  readonly qtyInputId = 'ocb-inventory-qty';
  readonly qtyHelpId = 'ocb-inventory-qty-help';
  readonly emptyTips = INVENTORY_EMPTY_TIPS;

  readonly selectedKey = signal<StorageKey | null>(null);
  readonly quantityText = signal('1');

  private readonly values = computed(() => this.config()?.values ?? null);
  readonly configMissing = computed(() => this.config() === null);

  readonly horse = computed(() => horseBonusInfo(this.state()?.animals ?? [], this.values()));
  readonly horseReason = computed(() => horseBonusReasonText(this.horse()));

  readonly rows = computed<InventoryRow[]>(() =>
    buildInventoryRows(this.state()?.storage, this.values(), this.horse().percent),
  );
  readonly isEmpty = computed(() => this.rows().length === 0);
  readonly total = computed(() => inventoryTotal(this.rows()));
  readonly storageCount = computed(() => this.rows().reduce((s, r) => s + r.quantity, 0));
  readonly storageMax = computed(() => this.limits()?.storage.max ?? this.values()?.['storage_cap'] ?? null);

  readonly selected = computed<InventoryRow | null>(
    () => this.rows().find((r) => r.key === this.selectedKey()) ?? null,
  );

  readonly quantityCheck = computed(() => {
    const row = this.selected();
    return row ? validateSellQuantity(this.quantityText(), row.quantity) : null;
  });
  readonly quantityError = computed(() => {
    const c = this.quantityCheck();
    return c && !c.ok ? c.message : null;
  });
  readonly isSellAll = computed(() => {
    const c = this.quantityCheck();
    const row = this.selected();
    return !!row && !!c && c.ok && c.value === row.quantity;
  });

  readonly preview = computed<SellBreakdown | null>(() => {
    const row = this.selected();
    const c = this.quantityCheck();
    if (!row || !c || !c.ok || row.unitPrice === null) return null;
    return sellBreakdown(row.unitPrice, c.value, this.horse().percent);
  });

  readonly confirmDisabled = computed(
    () => !this.preview() || !this.canSell() || this.selling() || this.refreshing(),
  );

  // --- Nhãn đã định dạng cho template (không gọi hàm trong template) -------------
  readonly rowViews = computed(() =>
    this.rows().map((r) => ({
      ...r,
      unitLabel: r.unitPrice === null ? '—' : formatSeeds(r.unitPrice),
      estimateLabel: r.estimate === null ? '—' : formatSeeds(r.estimate.total),
    })),
  );
  readonly totalLabels = computed(() => {
    const t = this.total();
    return { base: formatSeeds(t.base), bonus: formatSeeds(t.bonus), total: formatSeeds(t.total) };
  });
  readonly previewLabels = computed(() => {
    const p = this.preview();
    if (!p) return null;
    return {
      base: formatSeeds(p.base),
      bonus: formatSeeds(p.bonus),
      total: formatSeeds(p.total),
      balanceAfter: formatSeeds(Math.max(0, this.balance()) + p.total),
    };
  });
  readonly balanceLabel = computed(() => formatSeeds(Math.max(0, this.balance())));

  constructor() {
    afterNextRender(() => this.dialog()?.nativeElement.focus());
  }

  select(key: StorageKey): void {
    if (this.selectedKey() === key) {
      this.selectedKey.set(null);
      return;
    }
    this.selectedKey.set(key);
    this.quantityText.set('1');
  }

  setQuantity(value: string): void {
    this.quantityText.set(value);
  }

  step(delta: number): void {
    const row = this.selected();
    if (!row) return;
    const c = this.quantityCheck();
    const current = c?.ok ? c.value : 1;
    const next = Math.min(row.quantity, Math.max(1, current + delta));
    this.quantityText.set(String(next));
  }

  sellAll(): void {
    const row = this.selected();
    if (row) this.quantityText.set(String(row.quantity));
  }

  cancelSelection(): void {
    this.selectedKey.set(null);
  }

  confirm(): void {
    const row = this.selected();
    const c = this.quantityCheck();
    const preview = this.preview();
    if (!row || !c || !c.ok || !preview || this.confirmDisabled()) return;
    this.sell.emit({
      product: row.key,
      label: row.label,
      quantity: c.value,
      expectedQuantity: row.quantity,
      preview,
    });
  }

  requestRefresh(): void {
    if (!this.refreshing()) this.refresh.emit();
  }

  close(): void {
    this.closed.emit();
  }
}
