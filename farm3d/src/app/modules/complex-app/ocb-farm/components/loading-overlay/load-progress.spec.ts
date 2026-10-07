import {
  FARM_LOAD_TIMEOUT_REASON,
  FarmLoadItemDef,
  FarmLoadTracker,
  computeRawPercent,
  nextMonotonicPercent,
} from './load-progress';

const ITEMS: FarmLoadItemDef[] = [
  { id: 'data', label: 'Dữ liệu nông trại', weight: 3, critical: true },
  { id: 'config', label: 'Cấu hình', weight: 1 },
];

describe('load-progress', () => {
  let tracker: FarmLoadTracker;

  beforeEach(() => {
    jasmine.clock().install();
    tracker = new FarmLoadTracker();
  });

  afterEach(() => {
    tracker.dispose();
    jasmine.clock().uninstall();
  });

  it('nextMonotonicPercent không bao giờ giảm và nằm trong [0, 100]', () => {
    expect(nextMonotonicPercent(40, 10)).toBe(40);
    expect(nextMonotonicPercent(40, 70)).toBe(70);
    expect(nextMonotonicPercent(90, 150)).toBe(100);
    expect(nextMonotonicPercent(0, Number.NaN)).toBe(0);
  });

  it('computeRawPercent tính theo trọng số, hạng mục lỗi tính là đã xử lý', () => {
    tracker.begin(ITEMS);
    tracker.complete('config');
    expect(computeRawPercent(tracker.items())).toBe(25);
    tracker.fail('data', 'x');
    expect(computeRawPercent(tracker.items())).toBe(100);
  });

  it('phần trăm chỉ tăng hoặc giữ nguyên kể cả khi thêm hạng mục giữa chừng', () => {
    tracker.begin(ITEMS);
    const seen: number[] = [tracker.percent()];
    tracker.progress('data', 0.5);
    seen.push(tracker.percent());
    tracker.complete('config');
    seen.push(tracker.percent());
    tracker.add([{ id: 'model-cow', label: 'Mô hình bò', weight: 4 }]); // phần trăm thô giảm
    seen.push(tracker.percent());
    tracker.progress('data', 0.2); // lùi tiến trình bị bỏ qua
    seen.push(tracker.percent());
    tracker.complete('data');
    tracker.complete('model-cow');
    seen.push(tracker.percent());

    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    }
    expect(seen[seen.length - 1]).toBe(100);
    expect(tracker.phase()).toBe('ready');
  });

  it('nhãn đang tải là hạng mục đang chạy', () => {
    tracker.begin(ITEMS);
    expect(tracker.currentLabel()).toBe('Dữ liệu nông trại');
    tracker.start('config');
    expect(tracker.currentLabel()).toBe('Cấu hình');
  });

  it('hạng mục không quan trọng lỗi → ready kèm danh sách lỗi; quan trọng lỗi → error', () => {
    tracker.begin(ITEMS);
    tracker.complete('data');
    tracker.fail('config', 'Lỗi mạng');
    expect(tracker.phase()).toBe('ready');
    expect(tracker.failedItems().map((i) => i.id)).toEqual(['config']);

    tracker.begin(ITEMS);
    tracker.fail('data', 'Lỗi máy chủ');
    tracker.complete('config');
    expect(tracker.phase()).toBe('error');
    expect(tracker.criticalFailure()?.id).toBe('data');
  });

  it('quá thời gian chờ → timeout, hạng mục dở dang bị đánh dấu lỗi, kết quả muộn bị bỏ qua', async () => {
    tracker.begin(ITEMS, 30_000);
    let resolveLate!: () => void;
    const late = tracker.track('data', () => new Promise<void>((r) => (resolveLate = r)));
    tracker.complete('config');

    jasmine.clock().tick(30_000);
    expect(tracker.phase()).toBe('timeout');
    const data = tracker.items().find((i) => i.id === 'data');
    expect(data?.status).toBe('failed');
    expect(data?.error).toBe(FARM_LOAD_TIMEOUT_REASON);

    resolveLate();
    expect(await late).toBeFalse();
    expect(tracker.items().find((i) => i.id === 'data')?.status).toBe('failed');
  });

  it('thử lại chỉ tải lại hạng mục lỗi và giữ nguyên hạng mục đã xong', () => {
    tracker.begin(ITEMS);
    tracker.complete('data');
    tracker.fail('config', 'Lỗi mạng');
    const sessionBefore = tracker.session();

    const ids = tracker.retry();
    expect(ids).toEqual(['config']);
    expect(tracker.session()).toBeGreaterThan(sessionBefore);
    expect(tracker.phase()).toBe('loading');
    expect(tracker.items().find((i) => i.id === 'data')?.status).toBe('done');
    expect(tracker.percent()).toBe(75);

    tracker.complete('config');
    expect(tracker.phase()).toBe('ready');
    expect(tracker.failedItems().length).toBe(0);
  });
});
