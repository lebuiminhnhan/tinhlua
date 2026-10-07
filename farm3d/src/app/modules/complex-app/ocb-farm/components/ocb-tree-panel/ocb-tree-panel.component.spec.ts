import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { FarmMeResponse, FarmSeniority } from '../../models/ocb-farm.model';
import { OcbTreePanelComponent } from './ocb-tree-panel.component';

/** Chỉ dựng các trường bảng Cây OCB đọc tới. */
function buildMe(joinDate: string | null, seniority: Partial<FarmSeniority> = {}): FarmMeResponse {
  const s: FarmSeniority = {
    join_date: joinDate,
    years: 0,
    months: 0,
    total_months: 0,
    milestone: 0,
    branches: 0,
    days_to_next_milestone: null,
    at_max_milestone: false,
    ...seniority,
  };
  const partial: Partial<FarmMeResponse> = {
    initialized: true,
    join_date: joinDate,
    join_date_source: joinDate ? 'hr' : null,
    join_date_admin_locked: false,
    seniority: s,
    owner: {
      user_id: 1,
      full_name: 'Nhân viên A',
      department_id: 1,
      department_name: 'Phòng CNTT',
      farm_name: 'Nông trại A',
      seniority: s,
      badges_shown: [],
    },
  };
  return partial as FarmMeResponse;
}

describe('OcbTreePanelComponent', () => {
  let fixture: ComponentFixture<OcbTreePanelComponent>;
  let el: HTMLElement;

  const q = <T extends Element>(testId: string): T | null =>
    el.querySelector<T>(`[data-testid="${testId}"]`);

  function render(me: FarmMeResponse, todayIso: string, extra: Record<string, unknown> = {}): void {
    fixture = TestBed.createComponent(OcbTreePanelComponent);
    el = fixture.nativeElement;
    fixture.componentRef.setInput('me', me);
    fixture.componentRef.setInput('todayIso', todayIso);
    for (const [k, v] of Object.entries(extra)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [OcbTreePanelComponent] });
  });

  it('shows the join date read-only, the admin note, seniority and days to next milestone (US-4, US-5)', () => {
    render(
      buildMe('2022-03-15', { years: 3, months: 2, milestone: 6, branches: 1, days_to_next_milestone: 40 }),
      '2025-05-20',
    );
    const input = q<HTMLInputElement>('tree-join-date')!;
    expect(input.value).toBe('15/03/2022');
    expect(input.readOnly).toBeTrue();
    expect(q('tree-admin-note')?.textContent).toContain('quản trị viên');
    expect(q('tree-seniority')?.textContent).toContain('3 năm 2 tháng');
    expect(q('tree-next-milestone')?.textContent).toContain('40');

    q<HTMLButtonElement>('tree-request-guide-toggle')!.click();
    fixture.detectChanges();
    expect(q('tree-request-guide')?.querySelectorAll('li').length).toBe(4);
  });

  it('shows the max-milestone label instead of days remaining', () => {
    render(buildMe('2000-01-01', { years: 25, milestone: 40, at_max_milestone: true }), '2025-06-01');
    expect(q('tree-next-milestone')?.textContent).toContain('đạt mốc cao nhất');
  });

  it('warns when there is no join date', () => {
    render(buildMe(null), '2025-06-01');
    expect(q('tree-join-missing')).not.toBeNull();
  });

  it('shows the branch year and tenure year for the branch picked in 3D (US-6)', () => {
    render(buildMe('2018-04-20', { years: 7, branches: 5 }), '2025-06-01', {
      initialTab: 'branches',
      selectedBranchIndex: 4,
    });
    const detail = q('tree-branch-detail')!.textContent ?? '';
    expect(detail).toContain('2025');
    expect(detail).toContain('thứ 7');

    q<HTMLButtonElement>('tree-branch-0')!.click();
    fixture.detectChanges();
    expect(q('tree-branch-detail')!.textContent).toContain('2021');
  });

  it('shows the anniversary banner with a pick button, and keeps the banner after claiming (US-7)', () => {
    render(buildMe('2020-06-01', { years: 5 }), '2025-06-01');
    const emitted: number[] = [];
    fixture.componentInstance.pickFruit.subscribe((y) => emitted.push(y));
    expect(q('tree-anniversary-banner')?.textContent).toContain('5 năm');
    q<HTMLButtonElement>('tree-pick-fruit')!.click();
    expect(emitted).toEqual([2025]);

    fixture.componentRef.setInput('claimedYear', 2025);
    fixture.detectChanges();
    expect(q('tree-anniversary-banner')).not.toBeNull();
    expect(q('tree-pick-fruit')).toBeNull();
    expect(q('tree-fruit-claimed')).not.toBeNull();
  });

  it('has no banner under 3 years of seniority', () => {
    render(buildMe('2023-06-01', { years: 2 }), '2025-06-01');
    expect(q('tree-anniversary-banner')).toBeNull();
  });

  it('lists passed milestones ascending and the next milestone separately (US-51)', () => {
    render(buildMe('2024-01-10', { years: 1, months: 4, milestone: 2 }), '2025-05-20', { initialTab: 'timeline' });
    expect(q('tree-timeline-passed-1')?.textContent).toContain('10/07/2024');
    expect(q('tree-timeline-passed-2')?.textContent).toContain('10/01/2025');
    expect(q('tree-timeline-next')?.textContent).toContain('10/07/2025');
  });

  it('shows "no milestone yet" under 6 months', () => {
    render(buildMe('2025-03-01'), '2025-05-20', { initialTab: 'timeline' });
    expect(q('tree-timeline-empty')?.textContent).toContain('chưa đạt mốc nào');
  });
});
