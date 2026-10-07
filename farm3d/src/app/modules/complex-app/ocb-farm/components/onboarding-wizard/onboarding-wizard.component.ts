import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { AnalyticsService } from '../../../../../core/services/analytics.service';
import { JoinDateSource } from '../../models/ocb-farm.model';
import { FarmApiService, httpErrorMessage } from '../../services/farm-api.service';
import { FarmStateStore } from '../../services/farm-state.store';
import {
  DEFAULT_OCB_FOUNDED_YEAR,
  JoinDateRange,
  formatSeniority,
  formatViDate,
  joinDateRange,
  seniorityBetween,
  validateJoinDate,
} from './join-date';

/** Thời gian chờ tối đa phía client cho tra cứu dữ liệu nhân sự (server tự timeout 3s). */
const SUGGESTION_TIMEOUT_MS = 6000;

export type OnboardingMode = 'setup' | 'guide';

type SetupPhase = 'lookup' | 'input' | 'review' | 'submitting';

interface GuideStep {
  icon: string;
  title: string;
  body: string;
  tips: string[];
}

export const FARM_GUIDE_STEPS: readonly GuideStep[] = [
  {
    icon: 'bi bi-tree',
    title: 'Chào mừng đến Nông trại OCB',
    body: 'Ở trung tâm nông trại là Cây OCB của bạn. Cây lớn dần theo thâm niên làm việc tại OCB.',
    tips: ['Bấm vào Cây OCB để xem thâm niên và các mốc phát triển.', 'Bạn bắt đầu với một số Hạt OCB để mua vật nuôi và hạt giống.'],
  },
  {
    icon: 'bi bi-droplet',
    title: 'Chăm sóc cây và vật nuôi',
    body: 'Tưới nước cho cây và cho vật nuôi ăn để chúng tiếp tục lớn và cho sản phẩm.',
    tips: ['Cây thiếu nước chỉ tạm dừng lớn, không bao giờ chết.', 'Vật nuôi bị đói sẽ buồn nhưng không chết.'],
  },
  {
    icon: 'bi bi-basket',
    title: 'Thu hoạch sản phẩm',
    body: 'Khi cây hoặc vật nuôi có sản phẩm sẵn sàng, hãy thu hoạch để đưa vào kho.',
    tips: ['Nút "Thu hoạch tất cả" gom mọi sản phẩm sẵn sàng bằng một lần bấm.', 'Sản phẩm vẫn tích luỹ khi bạn không mở ứng dụng.'],
  },
  {
    icon: 'bi bi-shop',
    title: 'Bán sản phẩm lấy Hạt OCB',
    body: 'Mở kho để bán sản phẩm và nhận Hạt OCB. Dùng Hạt OCB để mua thêm vật nuôi, hạt giống và trang trí.',
    tips: ['Bạn tự chọn thời điểm bán.', 'Lịch sử thu chi ghi lại mọi khoản nhận và tiêu Hạt OCB.'],
  },
  {
    icon: 'bi bi-calendar-check',
    title: 'Ghé mỗi ngày',
    body: 'Check-in hằng ngày để nhận thưởng và giữ chuỗi ngày liên tiếp. Ghé thăm và giúp đồng nghiệp để cả hai cùng được thưởng.',
    tips: ['Có thể mở lại hướng dẫn này bất cứ lúc nào từ nút "Hướng dẫn".'],
  },
];

/**
 * OCB Farm — màn hình khởi tạo nông trại và hướng dẫn 5 bước.
 *
 * - `mode = 'setup'`: nhập/xác nhận ngày vào làm (gợi ý từ dữ liệu nhân sự nếu có),
 *   xem lại thâm niên, xác nhận lần hai mới gọi `POST /me/init` rồi tải lại nông trại
 *   qua store. Rời màn hình trước xác nhận lần hai thì không lưu gì (US-2).
 * - `mode = 'guide'`: hộp thoại hướng dẫn 5 bước, bỏ qua được ở mọi bước và luôn bắt
 *   đầu từ bước 1 khi mở lại (US-1).
 *
 * _Requirements: US-1, US-2, US-3_
 */
@Component({
  selector: 'app-onboarding-wizard',
  templateUrl: './onboarding-wizard.component.html',
  styleUrl: './onboarding-wizard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown)': 'onDocumentKeydown($event)',
  },
})
export class OnboardingWizardComponent {
  private readonly api = inject(FarmApiService);
  private readonly store = inject(FarmStateStore);
  private readonly analytics = inject(AnalyticsService);

  readonly mode = input<OnboardingMode>('setup');

  /** Khởi tạo xong và đã tải lại nông trại. */
  readonly completed = output<void>();
  /** Đóng hướng dẫn (bỏ qua hoặc hoàn tất). */
  readonly closed = output<void>();

  private readonly dateInput = viewChild<ElementRef<HTMLInputElement>>('dateInput');
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  readonly steps = FARM_GUIDE_STEPS;
  readonly titleId = 'farm-onboarding-title';
  readonly dateInputId = 'farm-join-date';
  readonly dateHelpId = 'farm-join-date-help';
  readonly dateErrorId = 'farm-join-date-error';

  // ---------------------------------------------------------------------------
  // Hướng dẫn 5 bước
  // ---------------------------------------------------------------------------

  readonly stepIndex = signal(0);
  readonly currentStep = computed(() => this.steps[this.stepIndex()]);
  readonly isFirstStep = computed(() => this.stepIndex() === 0);
  readonly isLastStep = computed(() => this.stepIndex() === this.steps.length - 1);
  readonly guidePercent = computed(() => Math.round(((this.stepIndex() + 1) / this.steps.length) * 100));

  // ---------------------------------------------------------------------------
  // Khởi tạo — ngày vào làm
  // ---------------------------------------------------------------------------

  readonly phase = signal<SetupPhase>('lookup');
  readonly range = signal<JoinDateRange>(joinDateRange(DEFAULT_OCB_FOUNDED_YEAR));
  readonly joinDate = signal('');
  readonly source = signal<Extract<JoinDateSource, 'hr' | 'self'>>('self');
  /** Thông báo vì sao phải tự nhập (HR ngoài khoảng / tra cứu lỗi). */
  readonly lookupNotice = signal<string | null>(null);
  readonly validationError = signal<string | null>(null);
  readonly submitError = signal<string | null>(null);

  readonly rangeLabel = computed(
    () => `từ ${formatViDate(this.range().min)} đến ${formatViDate(this.range().max)}`,
  );
  readonly joinDateLabel = computed(() => formatViDate(this.joinDate()));
  readonly seniorityLabel = computed(() =>
    formatSeniority(seniorityBetween(this.joinDate(), this.range().max)),
  );
  readonly sourceBadge = computed(() =>
    this.source() === 'hr'
      ? { cls: 'text-bg-info', icon: 'bi bi-person-badge', label: 'Theo dữ liệu nhân sự' }
      : { cls: 'text-bg-secondary', icon: 'bi bi-pencil', label: 'Do bạn tự khai' },
  );
  /** Bước hiện tại trên thanh tiến trình khởi tạo (1: chọn ngày, 2: xác nhận). */
  readonly setupStep = computed(() => (this.phase() === 'review' || this.phase() === 'submitting' ? 2 : 1));

  constructor() {
    afterNextRender(() => {
      if (this.mode() === 'guide') {
        this.dialog()?.nativeElement.focus();
      } else {
        void this.loadSuggestion();
      }
    });
  }

  // --- Hướng dẫn ---------------------------------------------------------------

  nextStep(): void {
    if (this.isLastStep()) {
      this.closeGuide();
      return;
    }
    this.stepIndex.update((i) => i + 1);
  }

  prevStep(): void {
    this.stepIndex.update((i) => Math.max(0, i - 1));
  }

  goToStep(index: number): void {
    if (index >= 0 && index < this.steps.length) this.stepIndex.set(index);
  }

  closeGuide(): void {
    this.stepIndex.set(0);
    this.closed.emit();
  }

  onDocumentKeydown(event: KeyboardEvent): void {
    if (this.mode() !== 'guide') return;
    const target = event.target;
    // Không chiếm phím mũi tên khi người dùng đang thao tác trong ô nhập.
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        this.closeGuide();
        break;
      case 'ArrowRight':
        if (!this.isLastStep()) {
          event.preventDefault();
          this.nextStep();
        }
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.prevStep();
        break;
    }
  }

  // --- Khởi tạo ----------------------------------------------------------------

  /** Tra gợi ý từ dữ liệu nhân sự; mọi lỗi/hết giờ → nhập thủ công, không chặn (US-3). */
  async loadSuggestion(): Promise<void> {
    this.phase.set('lookup');
    try {
      const s = await firstValueFrom(
        this.api.getJoinDateSuggestion().pipe(timeout(SUGGESTION_TIMEOUT_MS)),
      );
      if (s.min_date && s.max_date) this.range.set({ min: s.min_date, max: s.max_date });

      if (s.available && s.join_date && validateJoinDate(s.join_date, this.range()).ok) {
        this.joinDate.set(s.join_date);
        this.source.set('hr');
        this.lookupNotice.set(null);
      } else if (s.join_date) {
        // HR có giá trị nhưng ngoài khoảng hợp lệ → không điền sẵn, nêu lý do.
        this.source.set('self');
        this.lookupNotice.set(
          s.reason ||
            `Ngày vào làm trong dữ liệu nhân sự (${formatViDate(s.join_date)}) nằm ngoài khoảng cho phép, vui lòng tự nhập.`,
        );
      } else {
        this.source.set('self');
        this.lookupNotice.set(
          (s.reason || 'Không lấy được dữ liệu nhân sự.') + ' Vui lòng tự nhập ngày vào làm.',
        );
      }
    } catch {
      this.source.set('self');
      this.lookupNotice.set(
        'Không lấy được dữ liệu nhân sự (lỗi hoặc quá thời gian chờ). Vui lòng tự nhập ngày vào làm.',
      );
      await this.loadFoundedYearFallback();
    }
    this.phase.set('input');
    this.focusDateInput();
  }

  onDateInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.value !== this.joinDate()) {
      this.joinDate.set(target.value);
      // Sửa giá trị điền sẵn → chuyển nhãn sang "tự khai" (US-3).
      this.source.set('self');
    }
    this.validationError.set(null);
  }

  /** Xác nhận lần 1: kiểm tra ngày, sang bước xem lại thâm niên. Không lưu gì. */
  confirmDate(event?: Event): void {
    event?.preventDefault();
    if (this.phase() !== 'input') return;
    const result = validateJoinDate(this.joinDate(), this.range());
    if (!result.ok) {
      this.validationError.set(
        result.reason === 'required'
          ? `Vui lòng chọn ngày vào làm (${this.rangeLabel()}).`
          : `Ngày vào làm không hợp lệ. Chỉ chấp nhận ngày ${this.rangeLabel()}.`,
      );
      this.focusDateInput();
      return;
    }
    this.validationError.set(null);
    this.submitError.set(null);
    this.phase.set('review');
  }

  backToEdit(): void {
    if (this.phase() !== 'review') return;
    this.submitError.set(null);
    this.phase.set('input');
    this.focusDateInput();
  }

  /** Xác nhận lần 2: gọi `POST /me/init` (idempotent) rồi tải lại nông trại. */
  async submit(): Promise<void> {
    if (this.phase() !== 'review') return;
    this.phase.set('submitting');
    this.submitError.set(null);
    try {
      await firstValueFrom(
        this.api.initFarm({ join_date: this.joinDate(), join_date_source: this.source() }),
      );
    } catch (err: unknown) {
      this.submitError.set(`Chưa tạo được nông trại: ${httpErrorMessage(err)}`);
      this.phase.set('review');
      return;
    }

    const loaded = await this.store.load();
    if (!loaded) {
      this.submitError.set(
        'Nông trại đã được tạo nhưng chưa tải được dữ liệu. Vui lòng bấm thử lại.',
      );
      this.phase.set('review');
      return;
    }
    this.analytics.trackAppUsage('ocb-farm', 'farm_init', { join_date_source: this.source() });
    this.completed.emit();
  }

  private async loadFoundedYearFallback(): Promise<void> {
    try {
      const config = await firstValueFrom(this.api.getConfig().pipe(timeout(SUGGESTION_TIMEOUT_MS)));
      const year = config.values['ocb_founded_year'];
      if (year !== undefined) this.range.set(joinDateRange(year));
    } catch {
      // Giữ năm thành lập mặc định.
    }
  }

  private focusDateInput(): void {
    queueMicrotask(() => setTimeout(() => this.dateInput()?.nativeElement.focus()));
  }
}
