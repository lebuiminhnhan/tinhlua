import * as fc from 'fast-check';
import type { FarmPlot, FarmStateJson } from '../../models/ocb-farm.model';
import {
  buildExpandPlots,
  expandBlockMessage,
  expandSummary,
  isPlotExpandable,
  requiredFirstPlot,
  unlockPlotPatch,
} from './expand-plan';

function block(r0: number, r1: number, c0: number, c1: number): string[] {
  const cells: string[] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells.push(`${r},${c}`);
  return cells;
}

/** Mirrors backend `farm-plot-layout.ts`. */
const PLOTS: FarmPlot[] = [
  { id: 1, unlocked: true, terrain: 'land', cells: ['2,2', ...block(0, 4, 0, 4).filter((c) => c !== '2,2')] },
  { id: 2, unlocked: false, terrain: 'land', cells: block(0, 4, 5, 6) },
  { id: 3, unlocked: false, terrain: 'land', cells: block(5, 6, 0, 6) },
  { id: 4, unlocked: false, terrain: 'land', cells: block(0, 6, -2, -1) },
  { id: 5, unlocked: false, terrain: 'land', cells: block(-2, -1, -2, 6) },
  { id: 6, unlocked: false, terrain: 'land', cells: block(-2, 6, 7, 8) },
];

const VALUES: Record<string, number> = {
  expand_price_plot2: 1000,
  expand_price_plot3: 2500,
  expand_price_plot4: 5000,
  expand_price_plot5: 10000,
  expand_price_plot6: 20000,
};

function makeState(plots: FarmPlot[] = PLOTS): FarmStateJson {
  return {
    schema: 1,
    plots,
    animals: [],
    plants: [],
    decors: [],
    storage: {},
    tree: { milestone: 0, branches: 0, last_evaluated_at: '2026-01-01T00:00:00Z' },
    badges_shown: [],
    counters: { harvest_count: 0, water_count: 0, help_given: 0, species_owned: [] },
  };
}

describe('expand-plan', () => {
  it('lists every locked plot with its own price even when seeds are short', () => {
    const items = buildExpandPlots(makeState(), VALUES, 0);
    expect(items.map((i) => i.id)).toEqual([2, 3, 4, 5, 6]);
    expect(items.map((i) => i.price)).toEqual([1000, 2500, 5000, 10000, 20000]);
    const p2 = items[0];
    expect(p2.block).toBe('insufficient_seeds');
    expect(p2.missing).toBe(1000);
    expect(expandBlockMessage(p2)).toContain('Còn thiếu 1.000 Hạt OCB');
  });

  it('blocks a non-adjacent plot and names the plot to open first', () => {
    const state = makeState();
    expect(isPlotExpandable(state, 6)).toBeFalse();
    expect(requiredFirstPlot(state, 6)).toBe(2);
    const p6 = buildExpandPlots(state, VALUES, 1_000_000).find((i) => i.id === 6)!;
    expect(p6.block).toBe('not_adjacent');
    expect(expandBlockMessage(p6)).toContain('Hãy mở Vùng đất số 2 trước');
  });

  it('plot becomes adjacent once its neighbour is opened', () => {
    const state = makeState(PLOTS.map((p) => (p.id === 2 ? { ...p, unlocked: true } : p)));
    expect(isPlotExpandable(state, 6)).toBeTrue();
    expect(buildExpandPlots(state, VALUES, 20000).find((i) => i.id === 6)?.block).toBeNull();
  });

  it('reports all-unlocked state', () => {
    const all = makeState(PLOTS.map((p) => ({ ...p, unlocked: true })));
    expect(expandSummary(all)).toEqual({ total: 6, unlocked: 6, allUnlocked: true });
    expect(buildExpandPlots(all, VALUES, 0)).toEqual([]);
    expect(expandSummary(makeState()).allUnlocked).toBeFalse();
  });

  it('flags missing price config', () => {
    expect(buildExpandPlots(makeState(), {}, 99999)[0].block).toBe('no_price');
  });

  it('optimistic patch unlocks only the target plot and deducts its price', () => {
    const snap = { state: makeState(), balance: 3000 };
    const next = unlockPlotPatch(2, 1000)(snap);
    expect(next.balance).toBe(2000);
    expect(next.state.plots.filter((p) => p.unlocked).map((p) => p.id)).toEqual([1, 2]);
    expect(snap.state.plots.find((p) => p.id === 2)?.unlocked).toBeFalse();
  });

  it('property: openable iff adjacent, priced and affordable; missing = max(0, price - balance)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 30000 }), fc.subarray([2, 3, 4, 5, 6]), (balance, opened) => {
        const state = makeState(PLOTS.map((p) => (opened.includes(p.id) ? { ...p, unlocked: true } : p)));
        for (const item of buildExpandPlots(state, VALUES, balance)) {
          expect(item.missing).toBe(Math.max(0, (item.price ?? 0) - balance));
          expect(item.adjacent).toBe(isPlotExpandable(state, item.id));
          expect(item.block === null).toBe(item.adjacent && balance >= (item.price ?? Infinity));
          if (!item.adjacent) expect(item.requiredFirstId).not.toBeNull();
        }
      }),
    );
  });
});
