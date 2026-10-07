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
import { formatSeeds } from '../shop-panel/shop-catalog';
import { EntityAction, EntityActionId, EntityDetail, formatCountdown } from './entity-actions';

/** Kích thước ước lượng của menu để giữ menu trong khung nhìn. */
const MENU_WIDTH = 300;
const MENU_HEIGHT = 380;
const MENU_GAP = 12;

/**
 * OCB Farm — menu tương tác trên vật nuôi / cây trồng / vật trang trí (task 13.6, presentational).
 *
 * - Hiển thị trạng thái: độ no + trạng thái buồn, sản phẩm chờ, tên giai đoạn + đếm ngược,
 *   dấu hiệu thiếu nước / tạm dừng, sẵn sàng thu hoạch.
 * - Mỗi thao tác bị vô hiệu hoá đều kèm lý do (đọc được bằng trình đọc màn hình).
 * - Nổi gần vị trí chạm trên khung 3D; màn hình hẹp → dạng tấm dưới đáy (CSS).
 *
 * Container gửi lệnh khi nhận `action`; xác nhận bán do container mở hộp xác nhận.
 *
 * _Requirements: US-11, US-12, US-13, US-15, US-17, US-18, US-19, US-20, US-34_
 */
@Component({
  selector: 'app-entity-action-menu',
  templateUrl: './entity-action-menu.component.html',
  styleUrl: './entity-action-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'closed.emit()',
  },
})
export class EntityActionMenuComponent {
  readonly detail = input.required<EntityDetail>();
  readonly clientX = input(0);
  readonly clientY = input(0);
  /** Có thể gửi lệnh ghi (không ghé thăm, có mạng, không bận). */
  readonly canAct = input(true);
  readonly busyAction = input<EntityActionId | null>(null);
  readonly error = input<string | null>(null);

  readonly action = output<EntityActionId>();
  readonly closed = output<void>();

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  readonly titleId = 'farm-entity-menu-title';

  /** Vị trí cố định gần điểm chạm, kẹp trong khung nhìn. */
  readonly position = computed(() => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
    let left = this.clientX() + MENU_GAP;
    if (left + MENU_WIDTH > vw - MENU_GAP) left = this.clientX() - MENU_WIDTH - MENU_GAP;
    const top = Math.min(Math.max(MENU_GAP, this.clientY() - 40), Math.max(MENU_GAP, vh - MENU_HEIGHT - MENU_GAP));
    return { left: Math.max(MENU_GAP, left), top };
  });

  readonly animal = computed(() => this.detail().animal ?? null);
  readonly plant = computed(() => this.detail().plant ?? null);
  readonly decor = computed(() => this.detail().decor ?? null);

  readonly fullnessPercent = computed(() => Math.round(this.animal()?.status.fullness ?? 0));
  readonly fullnessBarClass = computed(() => {
    const f = this.fullnessPercent();
    return f <= 0 ? 'bg-secondary' : f < 30 ? 'bg-danger' : f < 60 ? 'bg-warning' : 'bg-success';
  });
  readonly nextProductLabel = computed(() => {
    const ms = this.animal()?.status.msToNextProduct;
    return ms !== null && ms !== undefined ? formatCountdown(ms) : null;
  });
  readonly plantCountdown = computed(() => {
    const ms = this.plant()?.status.remainingMs;
    return ms !== null && ms !== undefined ? formatCountdown(ms) : null;
  });

  /** Lý do vô hiệu hoá của các thao tác (để hiển thị gom dưới danh sách nút). */
  readonly reasons = computed(() =>
    this.detail()
      .actions.filter((a) => a.disabledReason)
      .map((a) => ({ id: a.id, label: a.label, reason: a.disabledReason as string })),
  );

  /** Nút thao tác kèm trạng thái vô hiệu hoá (không gọi hàm trong template). */
  readonly buttons = computed(() => {
    const blocked = !this.canAct() || this.busyAction() !== null;
    return this.detail().actions.map((a) => ({
      ...a,
      disabled: blocked || a.disabledReason !== null,
      busy: this.busyAction() === a.id,
      costLabel: a.cost !== undefined && a.cost > 0 ? `${formatSeeds(a.cost)} Hạt` : null,
    }));
  });

  readonly feedCostLabel = computed(() => formatSeeds(this.animal()?.feedCost ?? 0));
  readonly animalRefund = computed(() => formatSeeds(this.animal()?.refund ?? 0));
  readonly decorRefund = computed(() => formatSeeds(this.decor()?.refund ?? 0));

  constructor() {
    afterNextRender(() => this.panel()?.nativeElement.focus());
  }

  onAction(a: EntityAction & { disabled: boolean }): void {
    if (a.disabled) return;
    this.action.emit(a.id);
  }
}
