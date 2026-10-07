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
  FarmConfigResponse,
  FarmMeResponse,
  FarmOwnerProfile,
  FarmSeniority,
  FarmTreeState,
  JoinDateSource,
} from '../../models/ocb-farm.model';

const EMPTY_SENIORITY: FarmSeniority = {
  join_date: null,
  years: 0,
  months: 0,
  total_months: 0,
  milestone: 0,
  branches: 0,
  days_to_next_milestone: null,
  at_max_milestone: false,
};
import type { OcbTreeBranchInfo } from '../../scene/geometry/ocb-tree.geometry';
import { formatSeniority, formatViDate } from '../onboarding-wizard/join-date';
import {
  DEFAULT_ANNIVERSARY_GRACE_DAYS,
  DEFAULT_ANNIVERSARY_MIN_YEARS,
  DEFAULT_TREE_MAX_MILESTONE,
  anniversaryStatus,
  milestoneLabel,
  treeBranches,
  treeTimeline,
} from './ocb-tree';

export type OcbTreePanelTab = 'overview' | 'branches' | 'timeline';

interface PanelTabDef {
  id: OcbTreePanelTab;
  label: string;
  icon: string;
}

const SOURCE_LABELS: Record<JoinDateSource, string> = {
  hr: 'Theo dữ liệu nhân sự',
  self: 'Do bạn tự khai',
  admin: 'Đã được quản trị viên điều chỉnh',
};

/** Các bước yêu cầu quản trị viên sửa ngày vào làm (US-4). */
export const JOIN_DATE_REQUEST_STEPS: readonly string[] = [
  'Chuẩn bị giấy tờ chứng minh ngày vào làm đúng (quyết định tiếp nhận, hợp đồng lao động hoặc xác nhận của Khối Quản trị nguồn nhân lực).',
  'Gửi yêu cầu tới quản trị viên OCB IT Hub qua email hoặc Microsoft Teams nội bộ, tiêu đề "OCB Farm – Đề nghị điều chỉnh ngày vào làm".',
  'Trong yêu cầu ghi rõ: họ tên, tên đăng nhập, phòng ban, ngày vào làm đang hiển thị, ngày vào làm đúng và đính kèm giấy tờ ở bước 1.',
  'Chờ quản trị viên xác nhận. Lần mở nông trại kế tiếp sau khi được sửa, ngày mới và thâm niên được tính lại; vật nuôi, cây trồng và Hạt OCB giữ nguyên.',
];

/**
 * OCB Farm — bảng thông tin Cây OCB (task 12.2, presentational).
 *
 * - Tổng quan: ngày vào làm chỉ đọc + ghi chú chỉ quản trị viên sửa được + hướng dẫn từng
 *   bước cách yêu cầu (US-4); thâm niên năm/tháng, số ngày tới mốc kế tiếp hoặc nhãn đã
 *   đạt mốc cao nhất (US-5); banner chúc mừng suốt ngày kỷ niệm kèm nút hái quả (US-7).
 * - Nhánh: mỗi nhánh lớn tượng trưng một năm dương lịch và năm gắn bó thứ mấy (US-6);
 *   chọn được từ danh sách hoặc bằng cách bấm nhánh trên khung 3D (raycast ở scene).
 * - Dòng thời gian: các mốc đã đi qua tăng dần kèm ngày đạt, mốc kế tiếp tách riêng (US-51).
 *
 * Container (`ocb-farm-main`) gửi lệnh `PICK_ANNIVERSARY_FRUIT` khi nhận `pickFruit`.
 *
 * _Requirements: US-4, US-5, US-6, US-7, US-51_
 */
@Component({
  selector: 'app-ocb-tree-panel',
  templateUrl: './ocb-tree-panel.component.html',
  styleUrl: './ocb-tree-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'close()',
  },
})
export class OcbTreePanelComponent {
  /** Nông trại của chính mình. `null` khi đang xem Cây OCB của đồng nghiệp (`visitorOwner`). */
  readonly me = input<FarmMeResponse | null>(null);
  /**
   * Chủ nông trại đang được ghé thăm — bảng chuyển sang chế độ chỉ xem: không hái quả,
   * không có hướng dẫn yêu cầu sửa ngày vào làm.
   */
  readonly visitorOwner = input<FarmOwnerProfile | null>(null);
  /** Trạng thái cây đang hiển thị (gồm cập nhật mới nhất của store). */
  readonly tree = input<FarmTreeState | null>(null);
  /** Hôm nay theo giờ Việt Nam (`YYYY-MM-DD`) — container cập nhật khi qua ngày. */
  readonly todayIso = input.required<string>();
  readonly config = input<FarmConfigResponse | null>(null);
  readonly initialTab = input<OcbTreePanelTab>('overview');
  /** Nhánh được bấm trên khung 3D (chỉ số, 0 = nhánh đầu tiên). */
  readonly selectedBranchIndex = input<number | null>(null);
  /** Cho phép gửi lệnh hái quả (có mạng, không ghé thăm, không bận). */
  readonly canPick = input(true);
  readonly picking = input(false);
  /** Năm kỷ niệm đã nhận thưởng trong phiên (sau khi hái hoặc bị báo đã nhận). */
  readonly claimedYear = input<number | null>(null);
  /** Lỗi của lần hái quả gần nhất (ví dụ phần thưởng năm nay đã được nhận). */
  readonly pickError = input<string | null>(null);

  readonly closed = output<void>();
  readonly pickFruit = output<number>();

  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  readonly titleId = 'ocb-tree-panel-title';
  readonly requestSteps = JOIN_DATE_REQUEST_STEPS;
  readonly tabs: readonly PanelTabDef[] = [
    { id: 'overview', label: 'Tổng quan', icon: 'bi bi-info-circle' },
    { id: 'branches', label: 'Nhánh', icon: 'bi bi-diagram-3' },
    { id: 'timeline', label: 'Dòng thời gian', icon: 'bi bi-clock-history' },
  ];

  readonly tab = linkedSignal<OcbTreePanelTab>(() => this.initialTab());
  readonly activeBranch = linkedSignal<number | null>(() => this.selectedBranchIndex());
  readonly guideOpen = signal(false);
  readonly copyState = signal<'idle' | 'copied' | 'failed'>('idle');

  // --- Cấu hình -------------------------------------------------------------
  private readonly cfg = computed(() => this.config()?.values ?? {});
  private readonly maxMilestone = computed(() => this.cfg()['tree_max_milestone'] ?? DEFAULT_TREE_MAX_MILESTONE);
  private readonly minYears = computed(() => this.cfg()['anniversary_min_years'] ?? DEFAULT_ANNIVERSARY_MIN_YEARS);
  private readonly graceDays = computed(() => this.cfg()['anniversary_grace_days'] ?? DEFAULT_ANNIVERSARY_GRACE_DAYS);
  readonly fruitCount = computed(() => this.cfg()['anniversary_fruit_count'] ?? null);
  readonly reward = computed(() => this.cfg()['anniversary_reward'] ?? null);

  // --- Chủ cây (mình / đồng nghiệp) ------------------------------------------
  readonly isVisitor = computed(() => this.visitorOwner() !== null);
  /** "bạn" với cây của mình, tên đồng nghiệp khi ghé thăm. */
  readonly ownerLabel = computed(() => this.visitorOwner()?.full_name || (this.isVisitor() ? 'đồng nghiệp' : 'bạn'));

  // --- Ngày vào làm, thâm niên (US-4, US-5) ---------------------------------
  readonly joinIso = computed(() => this.visitorOwner()?.seniority.join_date ?? this.me()?.join_date ?? null);
  readonly joinLabel = computed(() => {
    const j = this.joinIso();
    return j ? formatViDate(j) : null;
  });
  readonly sourceLabel = computed(() => {
    if (this.isVisitor()) return null;
    const s = this.me()?.join_date_source;
    return s ? SOURCE_LABELS[s] : null;
  });
  readonly seniority = computed<FarmSeniority>(
    () => this.visitorOwner()?.seniority ?? this.me()?.seniority ?? EMPTY_SENIORITY,
  );
  readonly seniorityLabel = computed(() =>
    formatSeniority({ years: this.seniority().years, months: this.seniority().months }),
  );
  readonly milestone = computed(() => this.tree()?.milestone ?? this.seniority().milestone);
  readonly milestoneText = computed(() => milestoneLabel(this.milestone()));
  readonly atMax = computed(() => this.seniority().at_max_milestone || this.timeline()?.atMax === true);
  readonly daysToNext = computed(() => this.seniority().days_to_next_milestone ?? this.timeline()?.next?.daysRemaining ?? null);
  readonly nextLabel = computed(() => this.timeline()?.next?.label ?? milestoneLabel(this.milestone() + 1));

  // --- Dòng thời gian (US-51) -----------------------------------------------
  readonly timeline = computed(() => treeTimeline(this.joinIso(), this.todayIso(), this.maxMilestone()));
  /** Mốc đã đi qua, tăng dần theo thời gian, ngày đã định dạng `dd/MM/yyyy`. */
  readonly passed = computed(() =>
    (this.timeline()?.passed ?? []).map((e) => ({ ...e, dateLabel: formatViDate(e.reachedOn) })),
  );
  readonly next = computed(() => {
    const n = this.timeline()?.next;
    return n ? { ...n, dateLabel: formatViDate(n.reachedOn) } : null;
  });
  readonly anniversaryDateLabel = computed(() => {
    const a = this.anniversary();
    return a ? formatViDate(a.date) : '';
  });

  // --- Nhánh (US-6) ---------------------------------------------------------
  readonly branches = computed(() =>
    treeBranches(this.tree()?.branches ?? this.seniority().branches, this.joinIso()),
  );
  readonly selectedBranch = computed<OcbTreeBranchInfo | null>(() => {
    const i = this.activeBranch();
    return i === null ? null : this.branches()[i] ?? null;
  });

  // --- Kỷ niệm (US-7) -------------------------------------------------------
  readonly anniversary = computed(() =>
    anniversaryStatus(this.joinIso(), this.todayIso(), this.minYears(), this.graceDays()),
  );
  /** Banner hiển thị suốt ngày kỷ niệm (kể cả sau khi đã hái). */
  readonly showBanner = computed(() => {
    const a = this.anniversary();
    return !!a && a.isToday && a.eligible;
  });
  /** Ngoài ngày kỷ niệm nhưng còn ân hạn → nhắc nhận quả. */
  readonly showGraceReminder = computed(() => {
    const a = this.anniversary();
    return !this.isVisitor() && !!a && !a.isToday && a.claimable && this.claimedYear() !== a.year;
  });
  readonly claimed = computed(() => {
    const a = this.anniversary();
    return !!a && this.claimedYear() === a.year;
  });
  readonly pickDisabled = computed(
    () => this.isVisitor() || !this.canPick() || this.picking() || this.claimed(),
  );

  constructor() {
    afterNextRender(() => this.dialog()?.nativeElement.focus());
  }

  selectTab(tab: OcbTreePanelTab): void {
    this.tab.set(tab);
  }

  selectBranch(index: number): void {
    this.activeBranch.set(this.activeBranch() === index ? null : index);
  }

  toggleGuide(): void {
    this.guideOpen.update((v) => !v);
  }

  onPick(): void {
    const a = this.anniversary();
    if (!a || !a.claimable || this.pickDisabled()) return;
    this.pickFruit.emit(a.year);
  }

  close(): void {
    this.closed.emit();
  }

  /** Sao chép nội dung yêu cầu sửa ngày vào làm (điền sẵn thông tin hiện có). */
  async copyRequest(): Promise<void> {
    const me = this.me();
    if (!me) return;
    const text = [
      'OCB Farm – Đề nghị điều chỉnh ngày vào làm',
      `Họ tên: ${me.owner.full_name || ''}`,
      'Tên đăng nhập: ',
      `Phòng ban: ${me.owner.department_name || ''}`,
      `Ngày vào làm đang hiển thị: ${this.joinLabel() ?? 'Chưa có'}`,
      'Ngày vào làm đúng: ',
      'Giấy tờ đính kèm: ',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      this.copyState.set('copied');
    } catch {
      this.copyState.set('failed');
    }
  }
}
