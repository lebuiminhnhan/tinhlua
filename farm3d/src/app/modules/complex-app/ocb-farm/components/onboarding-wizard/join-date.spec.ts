import * as fc from 'fast-check';
import {
  formatSeniority,
  formatViDate,
  joinDateRange,
  seniorityBetween,
  todayVnIso,
  validateJoinDate,
} from './join-date';

describe('onboarding join-date', () => {
  const range = { min: '1996-01-01', max: '2025-06-15' };

  it('todayVnIso tính theo UTC+7', () => {
    // 2025-06-14T17:30Z = 2025-06-15 00:30 giờ Việt Nam.
    expect(todayVnIso(Date.UTC(2025, 5, 14, 17, 30))).toBe('2025-06-15');
    expect(todayVnIso(Date.UTC(2025, 5, 14, 16, 59))).toBe('2025-06-14');
  });

  it('joinDateRange bắt đầu từ 01/01 năm thành lập', () => {
    expect(joinDateRange(1996, Date.UTC(2025, 0, 1, 12)).min).toBe('1996-01-01');
    expect(joinDateRange(Number.NaN, Date.UTC(2025, 0, 1, 12)).min).toBe('1996-01-01');
  });

  it('validateJoinDate: rỗng, sai định dạng, ngoài khoảng, biên hợp lệ', () => {
    expect(validateJoinDate('', range)).toEqual({ ok: false, reason: 'required' });
    expect(validateJoinDate('2020-02-30', range)).toEqual({ ok: false, reason: 'invalid' });
    expect(validateJoinDate('1995-12-31', range)).toEqual({ ok: false, reason: 'out_of_range' });
    expect(validateJoinDate('2025-06-16', range)).toEqual({ ok: false, reason: 'out_of_range' });
    expect(validateJoinDate('1996-01-01', range)).toEqual({ ok: true });
    expect(validateJoinDate('2025-06-15', range)).toEqual({ ok: true });
  });

  it('seniorityBetween tính năm/tháng tròn và kẹp cuối tháng', () => {
    expect(seniorityBetween('2020-03-15', '2023-06-14')).toEqual({ years: 3, months: 2 });
    expect(seniorityBetween('2020-03-15', '2023-06-15')).toEqual({ years: 3, months: 3 });
    expect(seniorityBetween('2023-01-31', '2023-02-28')).toEqual({ years: 0, months: 1 });
    expect(seniorityBetween('2025-06-15', '2025-06-15')).toEqual({ years: 0, months: 0 });
  });

  it('định dạng hiển thị tiếng Việt', () => {
    expect(formatViDate('2020-03-05')).toBe('05/03/2020');
    expect(formatSeniority({ years: 3, months: 2 })).toBe('3 năm 2 tháng');
    expect(formatSeniority({ years: 0, months: 0 })).toBe('Chưa đủ 1 tháng');
  });

  it('thâm niên không âm, tháng trong 0..11 và không giảm theo thời gian', () => {
    const day = fc.integer({ min: Date.UTC(1996, 0, 1), max: Date.UTC(2060, 0, 1) }).map((ms) =>
      new Date(ms).toISOString().slice(0, 10),
    );
    fc.assert(
      fc.property(day, day, day, (join, a, b) => {
        const [t1, t2] = a <= b ? [a, b] : [b, a];
        const s1 = seniorityBetween(join, t1);
        const s2 = seniorityBetween(join, t2);
        return (
          s1.years >= 0 &&
          s1.months >= 0 &&
          s1.months <= 11 &&
          s1.years * 12 + s1.months <= s2.years * 12 + s2.months
        );
      }),
    );
  });
});
