import type { FarmHelpAvailability, FarmStateJson } from '../../models/ocb-farm.model';
import { helpBlockReason } from '../visit-toolbar/visit-toolbar';
import { boostTargets, buildShopItems, ShopContext } from './shop-catalog';

function state(): FarmStateJson {
  return {
    schema: 1,
    plots: [{ id: 1, unlocked: true, terrain: 'land', cells: ['0,0', '0,1'] }],
    animals: [
      { id: 'c', species: 'chicken', cell: '0,1', fed_at: '', fullness: 50, cycle_started_at: '', pending: 0 },
      { id: 'h', species: 'horse', cell: '0,1', fed_at: '', fullness: 50, cycle_started_at: '', pending: 0 },
      { id: 'full', species: 'cow', cell: '0,1', fed_at: '', fullness: 50, cycle_started_at: '', pending: 5 },
    ],
    plants: [
      { id: 'p1', kind: 'rose', cell: '0,1', stage: 'sprout', stage_elapsed_ms: 0, watered_at: '', fertilized_stage: null, ready_at: null },
      { id: 'p2', kind: 'rose', cell: '0,1', stage: 'ready', stage_elapsed_ms: 0, watered_at: '', fertilized_stage: null, ready_at: null },
    ],
    decors: [],
    storage: {},
    tree: { milestone: 0, branches: 0, last_evaluated_at: '' },
    badges_shown: [],
    counters: { harvest_count: 0, water_count: 0, help_given: 0, species_owned: [] },
  } as unknown as FarmStateJson;
}

const values = { offline_cap_per_entity: 5, boost_price_growth_potion: 100, boost_price_super_fertilizer: 80 };

function ctx(over: Partial<ShopContext> = {}): ShopContext {
  return { values, state: state(), balance: 1000, limits: null, seasonTheme: null, seasonName: null, seniorityMonths: 0, ...over };
}

describe('shop boost items (thuốc tăng trưởng / phân bón siêu cấp)', () => {
  it('lists both boosts with configured prices', () => {
    const items = buildShopItems('boost', ctx());
    expect(items.map((i) => [i.code, i.price, i.block])).toEqual([
      ['growth_potion', 100, null],
      ['super_fertilizer', 80, null],
    ]);
  });

  it('targets exclude horses, capped animals and ready plants', () => {
    expect(boostTargets('growth_potion', state(), values).map((t) => t.id)).toEqual(['c']);
    expect(boostTargets('super_fertilizer', state(), values).map((t) => t.id)).toEqual(['p1']);
  });

  it('blocks when broke or nothing to boost', () => {
    expect(buildShopItems('boost', ctx({ balance: 10 }))[0].block).toBe('insufficient_seeds');
    const empty = { ...state(), animals: [], plants: [] };
    expect(buildShopItems('boost', ctx({ state: empty })).every((i) => i.block === 'no_free_cell')).toBeTrue();
  });
});

describe('visit help gating trusts server availability', () => {
  it('allows helping whenever the server says can_water / can_feed', () => {
    const help: FarmHelpAvailability = {
      remaining_quota: 5,
      already_helped_today: false,
      can_water: true,
      can_feed: true,
      resets_at: '2026-10-06T00:00:00Z',
    };
    expect(helpBlockReason(help, 'water', true)).toBeNull();
    expect(helpBlockReason(help, 'feed', true)).toBeNull();
    expect(helpBlockReason({ ...help, can_feed: false }, 'feed', true)).toBe('nothing_to_help');
  });
});
