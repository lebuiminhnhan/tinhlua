import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type {
  FarmCellRef,
  FarmConfigResponse,
  FarmLimits,
  FarmStateJson,
  SeasonTheme,
} from '../../models/ocb-farm.model';
import {
  BoostTarget,
  DecorCatalogEntry,
  SHOP_TABS,
  boostTargets,
  isBoostCode,
  ShopItem,
  pickRandomItem,
  ShopTab,
  blockMessage,
  buildShopItems,
  formatHours,
  formatSeeds,
  freeCells,
  groupCount,
} from './shop-catalog';

/** Yêu cầu mua gửi cho container — container chuyển thành BUY_ANIMAL / PLANT_SEED / BUY_DECOR. */
export interface ShopPurchase {
  tab: ShopTab;
  code: string;
  /** Ô đặt (vật nuôi / hạt giống / trang trí). Rỗng với vật phẩm hỗ trợ. */
  cell: FarmCellRef;
  price: number;
  name: string;
  /** Vật nuôi / cây được dùng vật phẩm hỗ trợ (tab `boost`). */
  targetId?: string;
}

interface ShopItemView extends ShopItem {
  priceLabel: string;
  growLabel: string | null;
  cycleLabel: string | null;
  message: string | null;
}

/**
 * OCB Farm — cửa hàng (task 13.1, presentational).
 *
 * - 3 tab `.nav-pills`: vật nuôi / hạt giống / trang trí.
 * - Mỗi vật phẩm hiển thị giá, tổng thời gian sinh trưởng (hạt giống), nhãn vật phẩm giới
 *   hạn theo dịp (US-33), nhãn khoá / mở khoá theo thâm niên kèm mốc (US-49).
 * - Chặn mua khi thiếu Hạt OCB (nêu số còn thiếu), đạt giới hạn nhóm (US-37), hết ô trống.
 * - Chọn vật phẩm → chọn ô đặt (mặc định ô vừa chạm trên khung 3D nếu hợp lệ) → bấm
 *   "Xác nhận mua". Đóng / huỷ trước khi xác nhận thì không có gì bị trừ (US-10).
 *
 * _Requirements: US-10, US-16, US-33, US-34, US-37, US-49_
 */
@Component({
  selector: 'app-shop-panel',
  templateUrl: './shop-panel.component.html',
  styleUrl: './shop-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'close()',
  },
})
export class ShopPanelComponent {
  readonly state = input<FarmStateJson | null>(null);
  readonly balance = input(0);
  readonly limits = input<FarmLimits | null>(null);
  readonly config = input<FarmConfigResponse | null>(null);
  readonly seasonTheme = input<SeasonTheme | null>(null);
  readonly seasonName = input<string | null>(null);
  /** Tổng số tháng thâm niên hiện tại (US-49). */
  readonly seniorityMonths = input(0);
  /** Ô vừa chạm trên khung 3D — được chọn sẵn nếu hợp lệ với vật phẩm. */
  readonly preferredCell = input<FarmCellRef | null>(null);
  readonly initialTab = input<ShopTab>('animal');
  /** Được phép gửi lệnh mua (có mạng, không ghé thăm, không bận). */
  readonly canBuy = input(true);
  readonly buying = input(false);
  /** Lỗi của lần mua gần nhất (từ server). */
  readonly buyError = input<string | null>(null);
  /** Mã trang trí từ manifest 3D (mỗi mã một vật phẩm, giá theo nhóm). */
  readonly decorCatalog = input<readonly DecorCatalogEntry[]>([]);

  readonly purchase = output<ShopPurchase>();
  readonly closed = output<void>();

  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  readonly titleId = 'ocb-shop-panel-title';
  readonly tabs = SHOP_TABS;
  readonly tab = linkedSignal<ShopTab>(() => this.initialTab());
  readonly selectedCode = signal<string | null>(null);
  /** Ô người dùng tự chọn; `null` → dùng ô mặc định. */
  readonly chosenCell = signal<FarmCellRef | null>(null);

  readonly balanceLabel = computed(() => formatSeeds(this.balance()));
  readonly configMissing = computed(() => this.config() === null);

  private readonly ctx = computed(() => ({
    values: this.config()?.values ?? null,
    state: this.state(),
    balance: this.balance(),
    limits: this.limits(),
    seasonTheme: this.seasonTheme(),
    seasonName: this.seasonName(),
    seniorityMonths: this.seniorityMonths(),
    decorCatalog: this.decorCatalog(),
  }));

  /** Còn ít nhất một vật phẩm mua được trong tab — bật nút "Ngẫu nhiên". */
  readonly canPickRandom = computed(() => this.items().some((i) => i.block === null));

  readonly count = computed(() => groupCount(this.tab(), this.ctx()));
  readonly countLabel = computed(() => {
    const c = this.count();
    return c.max === null ? `${c.current}` : `${c.current}/${c.max}`;
  });
  readonly limitReached = computed(() => {
    const c = this.count();
    return c.max !== null && c.current >= c.max;
  });

  readonly items = computed<ShopItemView[]>(() => {
    const count = this.count();
    return buildShopItems(this.tab(), this.ctx()).map((item) => ({
      ...item,
      priceLabel: item.price === null ? '—' : formatSeeds(item.price),
      growLabel: item.growHours === null ? null : formatHours(item.growHours),
      cycleLabel: item.cycleHours === null ? null : formatHours(item.cycleHours),
      message: blockMessage(item, count),
    }));
  });

  readonly selected = computed<ShopItemView | null>(
    () => this.items().find((i) => i.code === this.selectedCode()) ?? null,
  );

  /** Ô trống phù hợp địa hình của vật phẩm đang chọn. */
  readonly cells = computed<FarmCellRef[]>(() => {
    const item = this.selected();
    return item ? freeCells(this.state(), item.terrain) : [];
  });

  readonly cell = computed<FarmCellRef | null>(() => {
    const cells = this.cells();
    const chosen = this.chosenCell();
    if (chosen && cells.includes(chosen)) return chosen;
    const preferred = this.preferredCell();
    if (preferred && cells.includes(preferred)) return preferred;
    return cells[0] ?? null;
  });

  /** Ô vừa chạm không dùng được cho vật phẩm đang chọn → báo để người dùng biết. */
  readonly preferredInvalid = computed(() => {
    const p = this.preferredCell();
    return !!p && !!this.selected() && !this.cells().includes(p);
  });

  // --- Vật phẩm hỗ trợ: chọn vật nuôi / cây thay cho chọn ô ---------------
  readonly isBoost = computed(() => this.selected()?.tab === 'boost');
  readonly chosenTarget = signal<string | null>(null);
  readonly targets = computed<BoostTarget[]>(() => {
    const item = this.selected();
    return item && isBoostCode(item.code) ? boostTargets(item.code, this.state(), this.config()?.values ?? null) : [];
  });
  readonly target = computed<string | null>(() => {
    const list = this.targets();
    const chosen = this.chosenTarget();
    if (chosen && list.some((t) => t.id === chosen)) return chosen;
    return list[0]?.id ?? null;
  });

  readonly confirmDisabled = computed(() => {
    const item = this.selected();
    const placed = this.isBoost() ? !!this.target() : !!this.cell();
    return !item || item.block !== null || !placed || !this.canBuy() || this.buying();
  });

  readonly balanceAfter = computed(() => {
    const item = this.selected();
    return item?.price != null ? formatSeeds(Math.max(0, this.balance() - item.price)) : null;
  });

  constructor() {
    afterNextRender(() => this.dialog()?.nativeElement.focus());
  }

  selectTab(tab: ShopTab): void {
    if (this.tab() === tab) return;
    this.tab.set(tab);
    this.selectedCode.set(null);
    this.chosenCell.set(null);
  }

  /** Chọn vật phẩm; vật phẩm bị khoá vẫn chọn được để xem lý do nhưng không mua được. */
  selectItem(code: string): void {
    this.selectedCode.set(this.selectedCode() === code ? null : code);
    this.chosenCell.set(null);
    this.chosenTarget.set(null);
  }

  chooseCell(value: string): void {
    this.chosenCell.set(value || null);
  }

  chooseTarget(value: string): void {
    this.chosenTarget.set(value || null);
  }

  /** Chọn ngẫu nhiên một vật phẩm mua được + một ô trống ngẫu nhiên; vẫn cần bấm xác nhận. */
  pickRandom(): void {
    const item = pickRandomItem(this.items());
    if (!item) return;
    this.selectedCode.set(item.code);
    if (isBoostCode(item.code)) {
      const list = boostTargets(item.code, this.state(), this.config()?.values ?? null);
      this.chosenTarget.set(list.length > 0 ? list[Math.floor(Math.random() * list.length)].id : null);
      return;
    }
    const cells = freeCells(this.state(), item.terrain);
    this.chosenCell.set(cells.length > 0 ? cells[Math.floor(Math.random() * cells.length)] : null);
  }

  cancelSelection(): void {
    this.selectedCode.set(null);
    this.chosenCell.set(null);
  }

  confirm(): void {
    const item = this.selected();
    if (!item || item.price === null || this.confirmDisabled()) return;
    if (item.tab === 'boost') {
      const targetId = this.target();
      if (!targetId) return;
      this.purchase.emit({ tab: item.tab, code: item.code, cell: '', price: item.price, name: item.name, targetId });
      return;
    }
    const cell = this.cell();
    if (!cell) return;
    this.purchase.emit({ tab: item.tab, code: item.code, cell, price: item.price, name: item.name });
  }

  close(): void {
    this.closed.emit();
  }
}
