import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FarmEnvironment, FarmLimits, FarmStateJson } from '../../models/ocb-farm.model';
import { FarmHudComponent } from './farm-hud.component';

function makeState(overrides: Partial<FarmStateJson> = {}): FarmStateJson {
  return {
    schema: 1,
    plots: [],
    animals: [],
    plants: [],
    decors: [],
    storage: {},
    tree: { milestone: 0, branches: 0, last_evaluated_at: '2025-01-01T00:00:00Z' },
    badges_shown: [],
    counters: { harvest_count: 0, water_count: 0, help_given: 0, species_owned: [] },
    ...overrides,
  };
}

const LIMITS: FarmLimits = {
  animals: { current: 0, max: 2 },
  plants: { current: 0, max: 10 },
  decors: { current: 0, max: 5 },
  storage: { current: 0, max: 100 },
  badges_shown: { current: 0, max: 3 },
};

const ENV: FarmEnvironment = {
  day_phase: 'noon',
  weather: 'rainy',
  season_theme: 'tet',
  season_theme_name: 'Tết Ất Tỵ',
  weather_cycle_started_at: '2025-01-01T00:00:00Z',
  weather_cycle_ends_at: '2025-01-01T01:00:00Z',
  server_time: '2025-01-01T00:30:00Z',
};

describe('FarmHudComponent', () => {
  let fixture: ComponentFixture<FarmHudComponent>;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [FarmHudComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(FarmHudComponent);
    el = fixture.nativeElement as HTMLElement;
  });

  it('hiển thị số Hạt OCB là số nguyên không âm và cập nhật khi input đổi', () => {
    fixture.componentRef.setInput('balance', -5);
    fixture.detectChanges();
    expect(el.querySelector('[aria-live="polite"]')?.textContent?.trim()).toBe('0');

    fixture.componentRef.setInput('balance', 1234.7);
    fixture.detectChanges();
    expect(el.querySelector('[aria-live="polite"]')?.textContent?.trim()).toBe('1.234');
  });

  it('hiển thị buổi khoá cảnh thay cho buổi thực, thời tiết và dịp lễ', () => {
    fixture.componentRef.setInput('balance', 0);
    fixture.componentRef.setInput('environment', ENV);
    fixture.componentRef.setInput('sceneLock', 'night');
    fixture.detectChanges();
    const text = el.textContent ?? '';
    expect(text).toContain('Buổi đêm');
    expect(text).not.toContain('Buổi trưa');
    expect(text).toContain('Mưa');
    expect(text).toContain('Tết Ất Tỵ');
  });

  it('đếm số hiện tại từ state và đánh dấu nhóm đã đầy', () => {
    const state = makeState({
      animals: [
        { id: 'a1', species: 'chicken', cell: '1,1', fed_at: '', fullness: 50, cycle_started_at: '', pending: 0 },
        { id: 'a2', species: 'cow', cell: '1,2', fed_at: '', fullness: 50, cycle_started_at: '', pending: 0 },
      ],
      storage: { egg: 3, milk: 4 },
      badges_shown: ['STREAK_7'],
    });
    fixture.componentRef.setInput('balance', 10);
    fixture.componentRef.setInput('state', state);
    fixture.componentRef.setInput('limits', LIMITS);
    fixture.detectChanges();

    const rows = fixture.componentInstance.limitRows();
    const animals = rows.find((r) => r.key === 'animals');
    expect(animals?.current).toBe(2);
    expect(animals?.full).toBeTrue();
    expect(rows.find((r) => r.key === 'storage')?.current).toBe(7);
    expect(rows.find((r) => r.key === 'plants')?.full).toBeFalse();
    expect(el.textContent).toContain('Một tuần đều đặn');
  });

  it('mặc định đọc số Hạt OCB từ FarmStateStore khi không truyền input', () => {
    fixture.detectChanges();
    expect(el.querySelector('[aria-live="polite"]')?.textContent?.trim()).toBe('0');
    expect(fixture.componentInstance.limitRows().length).toBe(0);
  });

  it('phát ledgerRequested khi bấm vào số Hạt OCB', () => {
    fixture.componentRef.setInput('balance', 10);
    fixture.detectChanges();
    let emitted = false;
    fixture.componentInstance.ledgerRequested.subscribe(() => (emitted = true));
    (el.querySelector('button') as HTMLButtonElement).click();
    expect(emitted).toBeTrue();
  });
});
