import * as fc from 'fast-check';
import type { FarmStateJson } from '../../models/ocb-farm.model';
import { ShopContext, buildShopItems, formatHours, freeCells, groupCount } from './shop-catalog';

function makeState(overrides: Partial<FarmStateJson> = {}): FarmStateJson {
  return {
    schema: 1,
    plots: [
      { id: 1, unlocked: true, terrain: 'land', cells: ['2,2', '2,3', '3,2'] },
      { id: 2, unlocked: true, terrain: 'water', cells: ['0,0'] },
      { id: 3, unlocked: false, terrain: 'land', cells: ['5,5'] },
    ],
    animals: [],
    plants: [],
    decors: [],
    storage: {},
    tree: { milestone: 0, branches: 0, last_evaluated_at: '2026-01-01T00:00:00Z' },
    badges_shown: [],
    counters: { harvest_count: 0, water_count: 0, help_given: 0, species_owned: [] },
    ...overrides,
  };
}

const VALUES: Record<string, number> = {
  animal_price_chicken: 100,
  animal_price_fish: 150,
  animal_price_sheep: 250,
  animal_price_pig: 300,
  animal_price_cow: 500,
  animal_price_horse: 800,
  seed_price_banana: 140,
  grow_total_banana: 24,
  decor_price_fence: 80,
  decor_price_seasonal: 250,
  max_animals: 2,
  max_plants: 40,
  max_decors: 60,
};

function ctx(over: Partial<ShopContext> = {}): ShopContext {
  return {
    values: VALUES,
    state: makeState(),
    balance: 500,
    limits: null,
    seasonTheme: null,
    seasonName: null,
    seniorityMonths: 0,
    ...over,
  };
}

describe('shop-catalog', () => {
  it('freeCells excludes the OCB tree cell, occupied cells and locked plots', () => {
    const state = makeState({
      plants: [
        {
          id: 'p1',
          kind: 'rose',
          cell: '2,3',
          stage: 'seed',
          stage_elapsed_ms: 0,
          watered_at: '2026-01-01T00:00:00Z',
          fertilized_stage: null,
          ready_at: null,
        },
      ],
    });
    expect(freeCells(state, 'land')).toEqual(['3,2']);
    expect(freeCells(state, 'water')).toEqual(['0,0']);
  });

  it('lists 6 species, 6 seeds and hides seasonal decor outside a season (US-10, US-16, US-33)', () => {
    expect(buildShopItems('animal', ctx()).length).toBe(6);
    expect(buildShopItems('seed', ctx()).length).toBe(6);
    expect(buildShopItems('decor', ctx()).some((i) => i.seasonal)).toBeFalse();
    const seasonal = buildShopItems('decor', ctx({ seasonTheme: 'tet', seasonName: 'Tết' })).find((i) => i.seasonal);
    expect(seasonal?.seasonName).toBe('Tết');
  });

  it('shows seed price and total grow time', () => {
    const banana = buildShopItems('seed', ctx()).find((i) => i.code === 'banana');
    expect(banana?.price).toBe(140);
    expect(banana?.growHours).toBe(24);
    expect(formatHours(36)).toBe('1 ngày 12 giờ');
  });

  it('fish needs water; blocks with missing seeds when balance is short', () => {
    const items = buildShopItems('animal', ctx({ balance: 120 }));
    expect(items.find((i) => i.code === 'fish')?.terrain).toBe('water');
    const cow = items.find((i) => i.code === 'cow');
    expect(cow?.block).toBe('insufficient_seeds');
    expect(cow?.missing).toBe(380);
    expect(items.find((i) => i.code === 'chicken')?.block).toBeNull();
  });

  it('limit in one group does not block other groups (US-37)', () => {
    const state = makeState({
      animals: ['a', 'b'].map((id, i) => ({
        id,
        species: 'chicken' as const,
        cell: i === 0 ? '2,3' : '3,2',
        fed_at: '',
        fullness: 100,
        cycle_started_at: '',
        pending: 0,
      })),
    });
    expect(groupCount('animal', ctx({ state }))).toEqual({ current: 2, max: 2 });
    expect(buildShopItems('animal', ctx({ state })).every((i) => i.block === 'limit_reached')).toBeTrue();
    expect(buildShopItems('decor', ctx({ state, balance: 100000 })).every((i) => i.block !== 'limit_reached')).toBeTrue();
  });

  it('seniority lock follows configured months (US-49)', () => {
    const values = { ...VALUES, seniority_unlock_animal_horse: 24 };
    const locked = buildShopItems('animal', ctx({ values, balance: 1000, seniorityMonths: 23 })).find((i) => i.code === 'horse');
    expect(locked?.block).toBe('seniority_locked');
    expect(locked?.requiredLabel).toBe('2 năm');
    const open = buildShopItems('animal', ctx({ values, balance: 1000, seniorityMonths: 24 })).find((i) => i.code === 'horse');
    expect(open?.block).toBeNull();
    expect(open?.unlockedBySeniority).toBeTrue();
  });

  it('property: missing seeds = max(0, price - balance) and never blocks purchasable when affordable', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5000 }), (balance) => {
        for (const item of buildShopItems('animal', ctx({ balance }))) {
          expect(item.missing).toBe(Math.max(0, (item.price ?? 0) - balance));
          if (item.block === null) expect(balance).toBeGreaterThanOrEqual(item.price ?? 0);
        }
      }),
    );
  });
});
