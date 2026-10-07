import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { AnalyticsService } from '../../../../../core/services/analytics.service';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { FarmSceneService } from '../../services/farm-scene.service';
import { FarmStateStore } from '../../services/farm-state.store';
import { seniorityBetween, todayVnIso, type SeniorityYm } from '../onboarding-wizard/join-date';
import {
  canvasToPng,
  composeSnapshot,
  downloadBlob,
  seniorityFromMonths,
  snapshotCaption,
  snapshotFileName,
} from './snapshot';

/**
 * OCB Farm — nút chụp ảnh nông trại (US-41).
 *
 * Nằm trong phạm vi provider của `farm-canvas` để dùng chung `FarmSceneService`: vẽ một
 * khung hình, sao chép sang canvas ngoài luồng, chèn tên nông trại + tên nhân viên +
 * thâm niên tại thời điểm chụp rồi tải PNG về (`ocb-farm-{tên}-{YYYY-MM-DD}.png`, UTC+7).
 * Chế độ ghé thăm ghi rõ "Nông trại của đồng nghiệp …". Lỗi → toast + nút thử lại;
 * góc nhìn giữ nguyên. Không gửi lệnh, không đổi state trò chơi.
 *
 * _Requirements: US-41_
 */
@Component({
  selector: 'app-snapshot-button',
  templateUrl: './snapshot-button.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .farm-snapshot-touch {
        min-width: 44px;
        min-height: 44px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 1.125rem;
      }
    `,
  ],
})
export class SnapshotButtonComponent {
  private readonly scene = inject(FarmSceneService);
  private readonly store = inject(FarmStateStore);
  private readonly toast = inject(ToastService);
  private readonly analytics = inject(AnalyticsService);

  readonly disabled = input(false);

  readonly busy = signal(false);
  /** Lỗi lần chụp gần nhất — hiện nút "Thử lại" cạnh nút chụp. */
  readonly failed = signal(false);

  readonly visiting = this.store.isVisiting;
  readonly canCapture = computed(() => this.scene.ready() && !this.disabled() && !this.busy());
  readonly label = computed(() =>
    this.visiting() ? 'Chụp ảnh nông trại của đồng nghiệp' : 'Chụp ảnh nông trại',
  );

  async capture(): Promise<void> {
    if (!this.canCapture()) return;
    this.busy.set(true);
    try {
      const nowMs = Date.now();
      const frame = this.scene.captureFrame();
      if (!frame) throw new Error('Khung hình 3D chưa sẵn sàng.');
      const info = this.captionInfo(nowMs);
      const image = composeSnapshot(frame, snapshotCaption({ ...info, nowMs }));
      const blob = await canvasToPng(image);
      downloadBlob(blob, snapshotFileName(info.farmName, nowMs));
      this.failed.set(false);
      this.toast.success('Đã tải ảnh nông trại về máy.');
      this.analytics.trackAppUsage('ocb-farm', 'farm_snapshot', { visiting: info.visiting });
    } catch (err: unknown) {
      console.warn('[ocb-farm] Không chụp được ảnh nông trại.', err);
      this.failed.set(true);
      this.toast.error('Không tạo hoặc tải được ảnh nông trại. Vui lòng bấm "Thử lại".');
    } finally {
      this.busy.set(false);
    }
  }

  private captionInfo(nowMs: number): {
    farmName: string;
    ownerName: string;
    seniority: SeniorityYm | null;
    visiting: boolean;
  } {
    const visit = this.store.visitMode();
    if (visit) {
      return {
        farmName: visit.farm_name,
        ownerName: visit.full_name,
        seniority: visit.seniority_months !== undefined ? seniorityFromMonths(visit.seniority_months) : null,
        visiting: true,
      };
    }
    const me = this.store.me();
    const s = me?.seniority ?? me?.owner.seniority ?? null;
    // Thâm niên tính đến thời điểm chụp (cùng quy tắc tháng tròn với backend).
    const seniority: SeniorityYm | null = s?.join_date
      ? seniorityBetween(s.join_date, todayVnIso(nowMs))
      : s
        ? { years: s.years, months: s.months }
        : null;
    return {
      farmName: me?.owner.farm_name ?? '',
      ownerName: me?.owner.full_name ?? '',
      seniority,
      visiting: false,
    };
  }
}
