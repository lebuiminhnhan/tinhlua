import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FarmLoadItem } from './load-progress';
import { FarmLoadingOverlayComponent } from './loading-overlay.component';

const FAILED: FarmLoadItem[] = [
  {
    id: 'model-cow',
    label: 'Mô hình bò',
    weight: 1,
    critical: false,
    status: 'failed',
    fraction: 0,
    error: 'Không tải được',
  },
];

describe('FarmLoadingOverlayComponent', () => {
  let fixture: ComponentFixture<FarmLoadingOverlayComponent>;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [FarmLoadingOverlayComponent] });
    fixture = TestBed.createComponent(FarmLoadingOverlayComponent);
    el = fixture.nativeElement as HTMLElement;
  });

  function set(inputs: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
  }

  const percentText = (): string =>
    el.querySelector('[data-testid="farm-load-percent"]')?.textContent?.trim() ?? '';

  it('hiển thị phần trăm và nhãn hạng mục; phần trăm không giảm trong cùng session', () => {
    set({ phase: 'loading', session: 1, percent: 40, currentLabel: 'Dữ liệu nông trại' });
    expect(percentText()).toBe('40%');
    expect(el.textContent).toContain('Dữ liệu nông trại');

    set({ percent: 20 });
    expect(percentText()).toBe('40%');

    set({ session: 2, percent: 10 });
    expect(percentText()).toBe('10%');
  });

  it('quá thời gian chờ: nêu nguyên nhân và phát retry khi bấm thử lại', () => {
    set({ phase: 'timeout', timeoutSeconds: 30 });
    expect(el.textContent).toContain('30 giây');
    let retried = 0;
    fixture.componentInstance.retry.subscribe(() => retried++);
    (el.querySelector('[data-testid="farm-load-retry"]') as HTMLButtonElement).click();
    expect(retried).toBe(1);
  });

  it('hạng mục lỗi khi đã sẵn sàng: thông báo không chặn, ẩn được', () => {
    set({ phase: 'ready', failedItems: FAILED });
    expect(el.classList.contains('farm-loading-overlay--blocking')).toBeFalse();
    const notice = el.querySelector('[data-testid="farm-load-failures"]');
    expect(notice?.textContent).toContain('Mô hình bò');

    (el.querySelector('.btn-close') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="farm-load-failures"]')).toBeNull();
  });
});
