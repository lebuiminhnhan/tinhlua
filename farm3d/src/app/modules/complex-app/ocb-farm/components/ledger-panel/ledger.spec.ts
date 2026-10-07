import * as fc from 'fast-check';
import type { FarmLedgerEntry } from '../../models/ocb-farm.model';
import {
  LEDGER_DEFAULT_PAGE_SIZE,
  LEDGER_MAX_PAGE_SIZE,
  formatLedgerTime,
  ledgerPageItems,
  resolveLedgerPageSize,
  toLedgerRow,
  totalLedgerPages,
} from './ledger';

function entry(partial: Partial<FarmLedgerEntry>): FarmLedgerEntry {
  return {
    id: 1,
    occurred_at: '2025-01-01T00:00:00.000Z',
    kind: 'checkin',
    amount: 10,
    balance_after: 110,
    ref_type: null,
    ref_id: null,
    note: null,
    actor_user_id: null,
    ...partial,
  };
}

describe('ledger (pure, US-21)', () => {
  it('formats time as dd/MM/yyyy HH:mm in UTC+7', () => {
    expect(formatLedgerTime('2025-01-01T17:05:00.000Z')).toBe('02/01/2025 00:05');
    expect(formatLedgerTime('not-a-date')).toBe('not-a-date');
  });

  it('maps sign/direction and keeps distinct notes only', () => {
    const income = toLedgerRow(entry({ amount: 25, note: 'Check-in ngày 2025-01-01' }));
    expect(income.direction).toBe('in');
    expect(income.sign).toBe('+');
    expect(income.title).toBe('Thưởng check-in');
    expect(income.note).toBe('Check-in ngày 2025-01-01');

    const spend = toLedgerRow(entry({ kind: 'buy_animal', amount: -40, balance_after: 0, note: '  ' }));
    expect(spend.direction).toBe('out');
    expect(spend.sign).toBe('−');
    expect(spend.amountAbs).toBe(40);
    expect(spend.note).toBeNull();
  });

  it('resolves page size from config with defaults and caps', () => {
    expect(resolveLedgerPageSize(undefined)).toBe(LEDGER_DEFAULT_PAGE_SIZE);
    expect(resolveLedgerPageSize(0)).toBe(LEDGER_DEFAULT_PAGE_SIZE);
    expect(resolveLedgerPageSize(Number.NaN)).toBe(LEDGER_DEFAULT_PAGE_SIZE);
    expect(resolveLedgerPageSize(25)).toBe(25);
    expect(resolveLedgerPageSize(500)).toBe(LEDGER_MAX_PAGE_SIZE);
  });

  it('computes compact page items', () => {
    expect(ledgerPageItems(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]);
    expect(ledgerPageItems(1, 1)).toEqual([1]);
    expect(totalLedgerPages(0, 20)).toBe(1);
    expect(totalLedgerPages(50, 20)).toBe(3);
  });

  it('property: page items are ascending, include first/last/current, within range', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 200 }), fc.integer({ min: 1, max: 250 }), (pages, cur) => {
        const items = ledgerPageItems(cur, pages);
        const nums = items.filter((p): p is number => p !== null);
        const current = Math.min(cur, pages);
        for (let i = 1; i < nums.length; i++) expect(nums[i]).toBeGreaterThan(nums[i - 1]);
        expect(nums[0]).toBe(1);
        expect(nums[nums.length - 1]).toBe(pages);
        expect(nums).toContain(current);
        expect(nums.every((p) => p >= 1 && p <= pages)).toBeTrue();
      }),
    );
  });

  it('property: row sign matches amount and displayed balance is never negative', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e9, max: 1e9 }), fc.integer({ min: -10, max: 1e9 }), (amount, bal) => {
        const row = toLedgerRow(entry({ amount, balance_after: bal }));
        expect(row.amountAbs).toBe(Math.abs(amount));
        expect(row.balanceAfter).toBeGreaterThanOrEqual(0);
        expect(row.sign).toBe(amount > 0 ? '+' : amount < 0 ? '−' : '');
      }),
    );
  });
});
