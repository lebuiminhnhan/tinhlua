import type { FarmOfflineSummary, FarmStateJson } from '../../models/ocb-farm.model';
import { formatCheckinReset, previewNextStreak } from '../checkin-dialog/checkin';
import {
  cappedEntityRows,
  formatAwayDuration,
  hasOfflineAccumulation,
  offlineSummaryRows,
} from './offline-summary';

function summary(partial: Partial<FarmOfflineSummary> = {}): FarmOfflineSummary {
  return {
    from: '2025-06-14T00:00:00Z',
    to: '2025-06-15T00:00:00Z',
    away_ms: 86_400_000,
    items: [],
    capped_entity_ids: [],
    rain_cycles: 0,
    ...partial,
  };
}

describe('offline-summary helpers', () => {
  it('formatAwayDuration', () => {
    expect(formatAwayDuration(-5)).toBe('dưới 1 phút');
    expect(formatAwayDuration(45 * 60_000)).toBe('45 phút');
    expect(formatAwayDuration(65 * 60_000)).toBe('1 giờ 5 phút');
    expect(formatAwayDuration(2 * 86_400_000 + 3 * 3_600_000 + 60_000)).toBe('2 ngày 3 giờ');
  });

  it('không hiển thị khi không có gì tích lũy', () => {
    expect(hasOfflineAccumulation(null)).toBeFalse();
    expect(hasOfflineAccumulation(summary())).toBeFalse();
    expect(hasOfflineAccumulation(summary({ items: [{ key: 'egg', quantity: 0, capped: false }] }))).toBeFalse();
    expect(hasOfflineAccumulation(summary({ items: [{ key: 'egg', quantity: 2, capped: false }] }))).toBeTrue();
  });

  it('offlineSummaryRows gắn nhãn và sắp theo số lượng giảm dần', () => {
    const rows = offlineSummaryRows(
      summary({
        items: [
          { key: 'egg', quantity: 2, capped: false },
          { key: 'fruit_mango', quantity: 5, capped: true },
        ],
      }),
    );
    expect(rows.map((r) => [r.label, r.quantity, r.capped])).toEqual([
      ['Xoài', 5, true],
      ['Trứng', 2, false],
    ]);
  });

  it('cappedEntityRows nêu tên loài/cây và ô đất', () => {
    const state = {
      animals: [{ id: 'a1', species: 'cow', cell: '1,2' }],
      plants: [{ id: 'p1', kind: 'rose', cell: '3,4' }],
    } as unknown as FarmStateJson;
    const rows = cappedEntityRows(summary({ capped_entity_ids: ['a1', 'p1', 'x'] }), state);
    expect(rows.map((r) => r.label)).toEqual([
      'Bò (ô 1,2)',
      'Hoa hồng (ô 3,4)',
      'Đối tượng đã bị di chuyển hoặc bán',
    ]);
  });
});

describe('checkin helpers', () => {
  it('formatCheckinReset hiển thị theo giờ Việt Nam', () => {
    // 00:00 16/06/2025 UTC+7 = 17:00 15/06/2025 UTC.
    expect(formatCheckinReset('2025-06-15T17:00:00.000Z')).toBe('00:00 ngày 16/06/2025 (giờ Việt Nam)');
    expect(formatCheckinReset('not-a-date')).toBeNull();
  });

  it('previewNextStreak: +1 nếu hôm qua, về 1 nếu lần đầu hoặc bỏ ngày', () => {
    expect(previewNextStreak(4, '2025-06-14', '2025-06-15')).toBe(5);
    expect(previewNextStreak(4, '2025-06-12', '2025-06-15')).toBe(1);
    expect(previewNextStreak(0, null, '2025-06-15')).toBe(1);
  });
});
