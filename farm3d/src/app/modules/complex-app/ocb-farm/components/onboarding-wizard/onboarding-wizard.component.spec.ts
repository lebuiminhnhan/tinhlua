import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FarmJoinDateSuggestion } from '../../models/ocb-farm.model';
import { todayVnIso } from './join-date';
import { FARM_GUIDE_STEPS, OnboardingWizardComponent } from './onboarding-wizard.component';

const SUGGESTION_URL = '/api/ocb-farm/me/join-date-suggestion';
const INIT_URL = '/api/ocb-farm/me/init';
const ME_URL = '/api/ocb-farm/me';

describe('OnboardingWizardComponent', () => {
  let fixture: ComponentFixture<OnboardingWizardComponent>;
  let http: HttpTestingController;
  let el: HTMLElement;
  const today = todayVnIso();

  const suggestion = (patch: Partial<FarmJoinDateSuggestion>): FarmJoinDateSuggestion => ({
    available: false,
    join_date: null,
    source: null,
    reason: null,
    min_date: '1996-01-01',
    max_date: today,
    ...patch,
  });

  const q = <T extends Element>(testId: string): T | null =>
    el.querySelector<T>(`[data-testid="${testId}"]`);

  async function settle(): Promise<void> {
    // Chuỗi async (firstValueFrom → store.load) cần vài lượt macrotask để chạy hết.
    for (let i = 0; i < 3; i++) {
      await new Promise((resolve) => setTimeout(resolve));
      await fixture.whenStable();
    }
    fixture.detectChanges();
  }

  /** Mở chế độ khởi tạo và trả lời tra cứu dữ liệu nhân sự. */
  async function openSetup(s: FarmJoinDateSuggestion): Promise<void> {
    fixture.componentRef.setInput('mode', 'setup');
    fixture.detectChanges();
    await fixture.whenStable();
    http.expectOne(SUGGESTION_URL).flush(s);
    await settle();
  }

  function typeDate(value: string): void {
    const input = q<HTMLInputElement>('farm-join-date-input');
    if (!input) throw new Error('Không thấy ô nhập ngày');
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function clickConfirm(): void {
    q<HTMLButtonElement>('farm-join-date-confirm')?.click();
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [OnboardingWizardComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(OnboardingWizardComponent);
    el = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    // Analytics có thể gửi request riêng — chỉ kiểm tra các request của nông trại.
    http.match((r) => r.url.startsWith('/api/ocb-farm')).forEach((r) => {
      if (!r.cancelled) fail(`Request chưa xử lý: ${r.request.method} ${r.request.url}`);
    });
  });

  it('điền sẵn ngày từ dữ liệu nhân sự, xác nhận hiển thị thâm niên rồi gửi khởi tạo với nguồn hr', async () => {
    await openSetup(suggestion({ available: true, join_date: '2020-01-01', source: 'hr' }));

    expect(q<HTMLInputElement>('farm-join-date-input')?.value).toBe('2020-01-01');
    expect(q('farm-join-date-source')?.textContent).toContain('dữ liệu nhân sự');

    clickConfirm();
    expect(q('farm-onboarding-review')).not.toBeNull();
    expect(q('farm-onboarding-seniority')?.textContent).toContain('năm');

    // Quay lại sửa ngày rồi xác nhận lại vẫn giữ giá trị.
    q<HTMLButtonElement>('farm-onboarding-back')?.click();
    fixture.detectChanges();
    expect(q<HTMLInputElement>('farm-join-date-input')?.value).toBe('2020-01-01');
    clickConfirm();

    q<HTMLButtonElement>('farm-onboarding-submit')?.click();
    fixture.detectChanges();
    const init = http.expectOne(INIT_URL);
    expect(init.request.body).toEqual({ join_date: '2020-01-01', join_date_source: 'hr' });
    init.flush({});
    await settle();

    // Tải lại nông trại lỗi → không đóng màn hình khởi tạo, cho thử lại.
    http.expectOne(ME_URL).flush({ message: 'Lỗi' }, { status: 404, statusText: 'Not Found' });
    await settle();
    expect(q('farm-onboarding-error')).not.toBeNull();
    expect(q('farm-onboarding-submit')?.textContent).toContain('Thử lại');
  });

  it('sửa ngày điền sẵn → nhãn nguồn chuyển sang tự khai', async () => {
    await openSetup(suggestion({ available: true, join_date: '2020-01-01', source: 'hr' }));
    typeDate('2019-05-10');
    expect(q('farm-join-date-source')?.textContent).toContain('tự khai');
    expect(fixture.componentInstance.source()).toBe('self');
  });

  it('không lấy được dữ liệu nhân sự → nhập thủ công kèm thông báo lý do', async () => {
    await openSetup(suggestion({ reason: 'Tra cứu dữ liệu nhân sự quá thời gian chờ.' }));
    expect(q<HTMLInputElement>('farm-join-date-input')?.value).toBe('');
    expect(q('farm-onboarding-notice')?.textContent).toContain('quá thời gian chờ');
    expect(q('farm-join-date-source')?.textContent).toContain('tự khai');
  });

  it('chưa chọn ngày hoặc ngày ngoài khoảng → từ chối, giữ giá trị và ở lại bước nhập', async () => {
    await openSetup(suggestion({ reason: 'Không có dữ liệu.' }));

    clickConfirm();
    expect(el.textContent).toContain('Vui lòng chọn ngày vào làm');
    expect(q('farm-onboarding-review')).toBeNull();

    typeDate('1990-06-01');
    clickConfirm();
    expect(el.textContent).toContain('Chỉ chấp nhận ngày từ 01/01/1996');
    expect(q<HTMLInputElement>('farm-join-date-input')?.value).toBe('1990-06-01');
    expect(q('farm-onboarding-review')).toBeNull();
  });

  it('hướng dẫn 5 bước: tiến qua các bước, bỏ qua ở giữa và mở lại từ bước 1', () => {
    fixture.componentRef.setInput('mode', 'guide');
    fixture.detectChanges();
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => closed++);

    expect(FARM_GUIDE_STEPS.length).toBe(5);
    expect(q('farm-guide-step')?.textContent).toContain('Bước 1/5');

    q<HTMLButtonElement>('farm-guide-next')?.click();
    q<HTMLButtonElement>('farm-guide-next')?.click();
    fixture.detectChanges();
    expect(q('farm-guide-step')?.textContent).toContain('Bước 3/5');

    q<HTMLButtonElement>('farm-guide-skip')?.click();
    fixture.detectChanges();
    expect(closed).toBe(1);
    expect(q('farm-guide-step')?.textContent).toContain('Bước 1/5');

    for (let i = 0; i < 5; i++) q<HTMLButtonElement>('farm-guide-next')?.click();
    expect(closed).toBe(2);
  });
});
