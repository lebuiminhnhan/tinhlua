import * as fc from 'fast-check';
import type { FarmAnimal } from '../../models/ocb-farm.model';
import {
  buildInventoryRows,
  horseBonusInfo,
  horseBonusReasonText,
  inventoryTotal,
  sellBreakdown,
  sellPriceConfigKey,
  validateSellQuantity,
} from './inventory';

const VALUES: Record<string, number> = {
  sell_price_egg: 10,
  sell_price_milk: 20,
  sell_price_banana: 14,
  sell_price_rose: 12,
  horse_bonus_per_horse: 5,
  horse_bonus_max: 25,
};

function horse(id: string, fullness: number): FarmAnimal {
  return { id, species: 'horse', cell: '1,1', fed_at: '', fullness, cycle_started_at: '', pending: 0 };
}

describe('inventory', () => {
  it('maps storage keys to configured sell price keys', () => {
    expect(sellPriceConfigKey('egg')).toBe('sell_price_egg');
    expect(sellPriceConfigKey('fruit_banana')).toBe('sell_price_banana');
    expect(sellPriceConfigKey('flower_rose')).toBe('sell_price_rose');
  });

  it('lists only products with quantity > 0 in a fixed order with estimates (US-22)', () => {
    const rows = buildInventoryRows({ flower_rose: 2, egg: 3, milk: 0, fruit_banana: 1 }, VALUES, 0);
    expect(rows.map((r) => r.key)).toEqual(['egg', 'fruit_banana', 'flower_rose']);
    expect(rows[0].estimate).toEqual({ base: 30, bonus: 0, total: 30 });
    expect(inventoryTotal(rows).total).toBe(30 + 14 + 24);
  });

  it('horse bonus counts only normal horses and reports reasons (US-14)', () => {
    expect(horseBonusInfo([], VALUES).reason).toBe('no_horse');
    const sad = horseBonusInfo([horse('h1', 0)], VALUES);
    expect(sad.reason).toBe('all_sad');
    expect(sad.percent).toBe(0);
    expect(horseBonusReasonText(sad)).toContain('buồn');
    const mixed = horseBonusInfo([horse('h1', 0), horse('h2', 50), horse('h3', 80)], VALUES);
    expect(mixed.percent).toBe(10);
    expect(horseBonusReasonText(mixed)).toBeNull();
  });

  it('horse bonus is capped by config', () => {
    const many = Array.from({ length: 9 }, (_, i) => horse('h' + i, 100));
    const info = horseBonusInfo(many, VALUES);
    expect(info.percent).toBe(25);
    expect(info.capped).toBeTrue();
  });

  it('sell breakdown floors the bonus like the server', () => {
    expect(sellBreakdown(14, 3, 10)).toEqual({ base: 42, bonus: 4, total: 46 });
  });

  it('rejects quantities outside [1, current] and non-integers', () => {
    expect(validateSellQuantity('0', 5).ok).toBeFalse();
    expect(validateSellQuantity('-1', 5).ok).toBeFalse();
    expect(validateSellQuantity('1.5', 5).ok).toBeFalse();
    expect(validateSellQuantity('abc', 5).ok).toBeFalse();
    expect(validateSellQuantity('6', 5).ok).toBeFalse();
    expect(validateSellQuantity(' 5 ', 5)).toEqual({ ok: true, value: 5 });
  });

  it('property: valid iff integer in [1, max]; total = base + bonus with bonus <= base * cap', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10, max: 200 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 20 }),
        (qty, max, unit, normalHorses) => {
          const check = validateSellQuantity(String(qty), max);
          expect(check.ok).toBe(qty >= 1 && qty <= max);
          const horses = Array.from({ length: normalHorses }, (_, i) => horse('h' + i, 50));
          const pct = horseBonusInfo(horses, VALUES).percent;
          expect(pct).toBeLessThanOrEqual(25);
          if (check.ok) {
            const b = sellBreakdown(unit, check.value, pct);
            expect(b.base).toBe(unit * check.value);
            expect(b.total).toBe(b.base + b.bonus);
            expect(b.bonus).toBeLessThanOrEqual(Math.floor((b.base * 25) / 100));
          }
        },
      ),
    );
  });
});
