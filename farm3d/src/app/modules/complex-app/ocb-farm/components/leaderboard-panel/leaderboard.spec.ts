import * as fc from 'fast-check';
import type { FarmLeaderboardRow } from '../../models/ocb-farm.model';
import {
  formatLeaderboardValue,
  formatRefreshedAt,
  formatSeniorityMonths,
  isSelfInRows,
} from './leaderboard';

function row(partial: Partial<FarmLeaderboardRow>): FarmLeaderboardRow {
  return {
    rank: 1,
    user_id: 1,
    full_name: 'Nhân viên A',
    department_name: 'Phòng CNTT',
    value: 10,
    is_self: false,
    ...partial,
  };
}

describe('leaderboard (pure, US-28, BR-23)', () => {
  it('formats refreshed_at as HH:mm dd/MM/yyyy in UTC+7', () => {
    expect(formatRefreshedAt('2025-01-01T17:05:00.000Z')).toBe('00:05 02/01/2025');
    expect(formatRefreshedAt('not-a-date')).toBe('not-a-date');
  });

  it('formats seniority months into "X năm Y tháng"', () => {
    expect(formatSeniorityMonths(0)).toBe('Chưa đủ 1 tháng');
    expect(formatSeniorityMonths(5)).toBe('5 tháng');
    expect(formatSeniorityMonths(12)).toBe('1 năm');
    expect(formatSeniorityMonths(14)).toBe('1 năm 2 tháng');
  });

  it('formats value per metric unit', () => {
    expect(formatLeaderboardValue('seniority', 14)).toBe('1 năm 2 tháng');
    expect(formatLeaderboardValue('assets', 123456)).toBe('123.456 Hạt OCB');
    expect(formatLeaderboardValue('streak', 7)).toBe('7 ngày');
  });

  describe('isSelfInRows', () => {
    it('is false when me is null', () => {
      expect(isSelfInRows([row({ user_id: 1 })], null)).toBe(false);
    });

    it('is true only when a row user_id matches me.user_id', () => {
      const rows = [row({ user_id: 1 }), row({ user_id: 2 })];
      expect(isSelfInRows(rows, row({ user_id: 2 }))).toBe(true);
      expect(isSelfInRows(rows, row({ user_id: 99 }))).toBe(false);
    });

    /**
     * **Validates: Requirements US-28** — dòng của chính nhân viên được nhận diện bất kể
     * vị trí trong danh sách hay số lượng dòng khác, miễn còn một dòng cùng `user_id`.
     */
    it('[PBT] detects self membership regardless of list size/order', () => {
      fc.assert(
        fc.property(
          fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 0, maxLength: 20 }),
          fc.integer({ min: 1, max: 1000 }),
          fc.boolean(),
          (otherIds, selfId, includeSelf) => {
            const ids = includeSelf ? [...otherIds, selfId] : otherIds.filter((id) => id !== selfId);
            const rows = ids.map((id, i) => row({ user_id: id, rank: i + 1 }));
            const me = row({ user_id: selfId });
            expect(isSelfInRows(rows, me)).toBe(ids.includes(selfId));
          },
        ),
      );
    });
  });
});
