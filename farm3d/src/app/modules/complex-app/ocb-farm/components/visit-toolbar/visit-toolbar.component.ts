import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { FarmHelpAvailability, FarmStateJson, HelpActionType } from '../../models/ocb-farm.model';
import { FarmApiService, httpErrorMessage } from '../../services/farm-api.service';
import type { FarmVisitTarget } from '../../services/farm-state.store';
import {
  DEFAULT_GREETING_MAX_LEN,
  containsForbiddenWord,
  formatResetTime,
  greetingBlockReason,
  helpBlockMessage,
  helpBlockReason,
} from './visit-toolbar';

type HelpBusy = HelpActionType | null;

/**
 * OCB Farm — thanh công cụ chế độ ghé thăm (task 14.1, presentational).
 *
 * - Nhãn "Đang ghé thăm …" hiển thị liên tục trong suốt thời gian xem, cùng nút thoát để
 *   quay về nông trại của chính mình (US-26).
 * - Mọi hành động mua/bán/di chuyển/xoá đều KHÔNG xuất hiện ở đây — chỉ còn giúp đỡ
 *   (tưới cây / cho ăn) và gửi lời chúc, khớp BR-21.
 * - Hiệu ứng lễ hội + banner chúc mừng khi chủ nông trại đang trong ngày kỷ niệm (US-8).
 * - Container gọi `GET /farms/:userId` trước khi mở toolbar; toolbar tự gọi
 *   `POST /farms/:userId/help` và `POST /farms/:userId/greeting`, rồi phát `helped` /
 *   `greeted` để container làm mới dữ liệu nếu cần (ví dụ tải lại hộp thư của chính mình
 *   không áp dụng ở đây vì đó là nông trại của đồng nghiệp).
 *
 * _Requirements: US-8, US-26, US-27, BR-21_
 */
@Component({
  selector: 'app-visit-toolbar',
  templateUrl: './visit-toolbar.component.html',
  styleUrl: './visit-toolbar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
})
export class VisitToolbarComponent {
  private readonly api = inject(FarmApiService);

  readonly target = input.required<FarmVisitTarget>();
  readonly hasFarm = input(true);
  readonly state = input<FarmStateJson | null>(null);
  readonly help = input<FarmHelpAvailability | null>(null);
  readonly greetingMaxLen = input(DEFAULT_GREETING_MAX_LEN);

  /** Thoát ghé thăm, quay về nông trại của chính mình. */
  readonly exited = output<void>();
  /** Giúp thành công — container có thể làm mới dữ liệu đang hiển thị nếu cần. */
  readonly helped = output<{ action: HelpActionType; help: FarmHelpAvailability }>();
  readonly greeted = output<void>();

  readonly greetingOpen = signal(false);
  readonly greetingMessage = signal('');
  readonly greetingSending = signal(false);
  readonly greetingError = signal<string | null>(null);
  readonly greetingSentJustNow = signal(false);
  /** Đặt `true` ngay sau khi gửi thành công — chặn gửi lần hai trong cùng phiên xem. */
  private greetingSentThisVisit = false;

  readonly helpBusy = signal<HelpBusy>(null);
  readonly helpError = signal<string | null>(null);
  readonly helpResultMessage = signal<string | null>(null);

  readonly resetsAtLabel = computed(() => formatResetTime(this.help()?.resets_at ?? ''));

  // Server (`help.can_water` / `help.can_feed`) là nguồn chân lý duy nhất. Trước đây nút còn
  // bị chặn thêm bởi một suy đoán phía client (cây luôn "đủ nước", vật nuôi chỉ đói khi
  // fullness = 0) → hầu như không bao giờ giúp được dù server cho phép.
  readonly waterBlock = computed(() => helpBlockReason(this.help(), 'water', this.hasFarm()));
  readonly feedBlock = computed(() => helpBlockReason(this.help(), 'feed', this.hasFarm()));
  readonly waterMessage = computed(() => helpBlockMessage(this.waterBlock(), this.resetsAtLabel()));
  readonly feedMessage = computed(() => helpBlockMessage(this.feedBlock(), this.resetsAtLabel()));
  readonly canWater = computed(() => this.waterBlock() === null && this.helpBusy() === null);
  readonly canFeed = computed(() => this.feedBlock() === null && this.helpBusy() === null);

  readonly greetingTrimmedLength = computed(() => this.greetingMessage().trim().length);
  readonly greetingBlock = computed(() =>
    greetingBlockReason(this.greetingMessage(), this.greetingMaxLen(), this.greetingSentThisVisit),
  );
  readonly greetingForbidden = computed(() => containsForbiddenWord(this.greetingMessage()));
  readonly canSendGreeting = computed(
    () => this.greetingBlock() === null && !this.greetingForbidden() && !this.greetingSending(),
  );
  readonly greetingAlreadySentToday = computed(() => this.greetingBlock() === 'quota_exceeded');

  /** Nhãn thâm niên hiển thị trên banner kỷ niệm (US-8). */
  readonly anniversaryLabel = computed(() => {
    const years = this.target().anniversary_years;
    if (!years || years <= 0) return 'Chúc mừng ngày gắn bó với OCB!';
    return `Chúc mừng ${years} năm đồng hành cùng OCB!`;
  });

  exit(): void {
    this.exited.emit();
  }

  openGreeting(): void {
    this.greetingError.set(null);
    this.greetingSentJustNow.set(false);
    this.greetingOpen.set(true);
  }

  closeGreeting(): void {
    this.greetingOpen.set(false);
  }

  async water(): Promise<void> {
    await this.runHelp('water');
  }

  async feed(): Promise<void> {
    await this.runHelp('feed');
  }

  async sendGreeting(): Promise<void> {
    if (!this.canSendGreeting()) return;
    this.greetingSending.set(true);
    this.greetingError.set(null);
    try {
      await firstValueFrom(
        this.api.sendGreeting(this.target().user_id, { kind: 'text', message: this.greetingMessage().trim() }),
      );
      this.greetingSentThisVisit = true;
      this.greetingSentJustNow.set(true);
      this.greetingMessage.set('');
      this.greeted.emit();
    } catch (err: unknown) {
      // Nội dung đã nhập được giữ lại để nhân viên sửa, kể cả khi bị từ chối (US-8).
      this.greetingError.set(httpErrorMessage(err));
    } finally {
      this.greetingSending.set(false);
    }
  }

  private async runHelp(action: HelpActionType): Promise<void> {
    const blocked = action === 'water' ? this.waterBlock() : this.feedBlock();
    if (blocked !== null || this.helpBusy() !== null) return;
    this.helpBusy.set(action);
    this.helpError.set(null);
    this.helpResultMessage.set(null);
    try {
      const res = await firstValueFrom(this.api.helpFarm(this.target().user_id, { action_type: action }));
      this.helpResultMessage.set(
        action === 'water'
          ? 'Đã tưới cây giúp đồng nghiệp. Cả hai bên đều được cộng Hạt OCB.'
          : 'Đã cho vật nuôi ăn giúp đồng nghiệp. Cả hai bên đều được cộng Hạt OCB.',
      );
      this.helped.emit({ action, help: res.help });
    } catch (err: unknown) {
      // Thất bại thì không trừ lượt, không đổi trạng thái nông trại — chỉ báo lỗi (US-27).
      this.helpError.set(httpErrorMessage(err));
    } finally {
      this.helpBusy.set(null);
    }
  }
}
