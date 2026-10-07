import * as fc from 'fast-check';
import {
  addMonthsClampedIso,
  anniversaryOf,
  anniversaryStatus,
  isTreeBlooming,
  milestoneLabel,
  treeBranches,
  treeTimeline,
} from './ocb-tree';

describe('ocb-tree (pure)', () => {
  describe('addMonthsClampedIso', () => {
    it('clamps to the last day of the target month', () => {
      expect(addMonthsClampedIso('2020-08-31', 6)).toBe('2021-02-28');
      expect(addMonthsClampedIso('2019-08-31', 6)).toBe('2020-02-29');
      expect(addMonthsClampedIso('2020-01-15', 12)).toBe('2021-01-15');
    });
  });

  describe('milestoneLabel', () => {
    it('labels 6-month milestones', () => {
      expect(milestoneLabel(0)).toBe('Dưới 6 tháng');
      expect(milestoneLabel(1)).toBe('6 tháng');
      expect(milestoneLabel(2)).toBe('1 năm');
      expect(milestoneLabel(3)).toBe('1 năm 6 tháng');
    });
  });

  describe('treeTimeline (US-51)', () => {
    it('shows no passed milestone under 6 months and days to the first one', () => {
      const t = treeTimeline('2025-01-10', '2025-07-01')!;
      expect(t.passed).toEqual([]);
      expect(t.next).toEqual(
        jasmine.objectContaining({ milestone: 1, reachedOn: '2025-07-10', daysRemaining: 9 }),
      );
    });

    it('treats the exact milestone day as already reached (US-5)', () => {
      const t = treeTimeline('2023-03-15', '2024-03-15')!;
      expect(t.current).toBe(2);
      expect(t.passed.map((e) => e.reachedOn)).toEqual(['2023-09-15', '2024-03-15']);
      expect(t.next?.reachedOn).toBe('2024-09-15');
    });

    it('stops at the configured max milestone', () => {
      const t = treeTimeline('2000-01-01', '2025-01-01', 4)!;
      expect(t.current).toBe(4);
      expect(t.atMax).toBeTrue();
      expect(t.next).toBeNull();
    });

    it('returns null without a join date', () => {
      expect(treeTimeline(null, '2025-01-01')).toBeNull();
    });

    it('property: passed milestones are strictly ascending, ≤ today, and next is in the future', () => {
      const day = fc.date({ min: new Date(Date.UTC(1996, 0, 1)), max: new Date(Date.UTC(2035, 11, 31)), noInvalidDate: true });
      fc.assert(
        fc.property(day, fc.integer({ min: 0, max: 12000 }), fc.integer({ min: 1, max: 60 }), (join, offset, max) => {
          const joinIso = join.toISOString().slice(0, 10);
          const todayIso = new Date(join.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
          const t = treeTimeline(joinIso, todayIso, max)!;
          expect(t.passed.length).toBe(t.current);
          t.passed.forEach((e, i) => {
            expect(e.milestone).toBe(i + 1);
            expect(e.reachedOn <= todayIso).toBeTrue();
            if (i > 0) expect(e.reachedOn > t.passed[i - 1].reachedOn).toBeTrue();
          });
          if (t.next) {
            expect(t.next.reachedOn > todayIso).toBeTrue();
            expect(t.next.daysRemaining).toBeGreaterThan(0);
          } else {
            expect(t.current).toBe(max);
          }
        }),
        { numRuns: 200 },
      );
    });
  });

  describe('anniversary (US-7)', () => {
    it('maps 29/02 to 28/02 in non-leap years', () => {
      expect(anniversaryOf('2020-02-29', 2023)).toBe('2023-02-28');
      expect(anniversaryOf('2020-02-29', 2024)).toBe('2024-02-29');
      const s = anniversaryStatus('2020-02-29', '2023-02-28')!;
      expect(s.isToday).toBeTrue();
      expect(s.years).toBe(3);
      expect(s.claimable).toBeTrue();
    });

    it('is not eligible under the minimum seniority', () => {
      const s = anniversaryStatus('2023-06-01', '2025-06-01')!;
      expect(s.isToday).toBeTrue();
      expect(s.years).toBe(2);
      expect(s.eligible).toBeFalse();
      expect(isTreeBlooming('2023-06-01', '2025-06-01')).toBeFalse();
      expect(isTreeBlooming('2022-06-01', '2025-06-01')).toBeTrue();
    });

    it('keeps the reward claimable during the grace period only', () => {
      const inGrace = anniversaryStatus('2020-05-10', '2025-05-12', 3, 3)!;
      expect(inGrace.isToday).toBeFalse();
      expect(inGrace.year).toBe(2025);
      expect(inGrace.claimable).toBeTrue();
      expect(inGrace.graceDaysLeft).toBe(1);
      expect(anniversaryStatus('2020-05-10', '2025-05-14', 3, 3)!.claimable).toBeFalse();
    });

    it('uses the previous year anniversary when this year’s has not come yet', () => {
      const s = anniversaryStatus('2018-12-31', '2025-01-02', 3, 5)!;
      expect(s.year).toBe(2024);
      expect(s.years).toBe(6);
      expect(s.claimable).toBeTrue();
    });
  });

  describe('treeBranches (US-6)', () => {
    it('maps each branch to its calendar year and tenure year', () => {
      const list = treeBranches(5, '2018-04-20');
      expect(list.length).toBe(5);
      expect(list[0]).toEqual({ index: 0, tenureYear: 3, calendarYear: 2021 });
      expect(list[4]).toEqual({ index: 4, tenureYear: 7, calendarYear: 2025 });
      expect(treeBranches(2, null)[1].calendarYear).toBeNull();
    });
  });
});
