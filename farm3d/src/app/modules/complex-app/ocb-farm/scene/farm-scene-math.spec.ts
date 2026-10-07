import type { FarmPlot } from '../models/ocb-farm.model';
import {
  ISO_ELEVATION,
  MAX_ZOOM,
  MIN_ZOOM,
  azimuthFor,
  cameraOffset,
  centerCellOf,
  clampZoom,
  gridBounds,
  lerpAngle,
  nextQuarterTurn,
  panDelta,
  parseCell,
  terrainSignature,
} from './farm-scene-math';

const plots: FarmPlot[] = [
  { id: 1, unlocked: true, terrain: 'land', cells: ['2,2', '2,3', '3,2'] },
  { id: 2, unlocked: false, terrain: 'water', cells: ['0,5', '1,5'] },
];

describe('farm-scene-math', () => {
  it('parses "row,col" and rejects malformed refs', () => {
    expect(parseCell('3,4')).toEqual({ row: 3, col: 4 });
    expect(parseCell(' -1 , 2 ')).toEqual({ row: -1, col: 2 });
    expect(parseCell('a,b')).toBeNull();
    expect(parseCell('1;2')).toBeNull();
  });

  it('uses the first cell of plot 1 as the OCB tree center (BR-1)', () => {
    expect(centerCellOf(plots)).toBe('2,2');
    expect(centerCellOf([])).toBeNull();
  });

  it('computes grid bounds across locked and unlocked plots', () => {
    expect(gridBounds(plots)).toEqual({ minRow: 0, maxRow: 3, minCol: 2, maxCol: 5 });
    expect(gridBounds([])).toBeNull();
  });

  it('changes terrain signature when a plot is unlocked', () => {
    const unlocked = plots.map((p) => (p.id === 2 ? { ...p, unlocked: true } : p));
    expect(terrainSignature(unlocked)).not.toBe(terrainSignature(plots));
  });

  it('rotates through 4 quarter turns in both directions', () => {
    expect(nextQuarterTurn(0, 'cw')).toBe(1);
    expect(nextQuarterTurn(3, 'cw')).toBe(0);
    expect(nextQuarterTurn(0, 'ccw')).toBe(3);
    expect(azimuthFor(2) - azimuthFor(0)).toBeCloseTo(Math.PI);
  });

  it('interpolates angles along the shortest arc', () => {
    const from = azimuthFor(3);
    const to = azimuthFor(0);
    const mid = lerpAngle(from, to, 0.5);
    // 3 → 0 là +90°, không phải −270°.
    expect(mid - from).toBeCloseTo(Math.PI / 4);
  });

  it('keeps the fixed isometric elevation for every rotation', () => {
    for (const turn of [0, 1, 2, 3] as const) {
      const o = cameraOffset(azimuthFor(turn), 10);
      expect(Math.atan2(o.y, Math.hypot(o.x, o.z))).toBeCloseTo(ISO_ELEVATION);
    }
  });

  it('clamps zoom and treats invalid values as 1', () => {
    expect(clampZoom(100)).toBe(MAX_ZOOM);
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it('pans opposite to the drag along the screen-right axis', () => {
    const az = azimuthFor(0);
    const d = panDelta(10, 0, az, 0.1);
    // Trục phải màn hình = (cos az, -sin az); kéo phải → target dịch ngược trục đó.
    expect(d.x).toBeCloseTo(-Math.cos(az));
    expect(d.z).toBeCloseTo(Math.sin(az));
  });
});
