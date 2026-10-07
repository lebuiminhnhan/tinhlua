import * as fc from 'fast-check';
import { Color, InstancedMesh, Matrix4, MeshStandardMaterial, Vector3 } from 'three';
import type { FarmPlot } from '../../models/ocb-farm.model';
import { cellToWorld, parseCell, worldToCell } from '../farm-scene-math';
import {
  TERRAIN_LAND_NAME,
  TERRAIN_WATER_NAME,
  TerrainCellInfo,
  buildPlotGrid,
  buildPondWater,
  collectTerrainCells,
} from './plot-grid.geometry';
import { disposeObject3D } from './dispose';

const PLOTS: FarmPlot[] = [
  { id: 1, unlocked: true, terrain: 'land', cells: ['0,0', '0,1', '1,0', '1,1'] },
  { id: 2, unlocked: false, terrain: 'land', cells: ['0,2', '1,2'] },
  { id: 3, unlocked: true, terrain: 'water', cells: ['2,0', '2,1'] },
  { id: 4, unlocked: false, terrain: 'water', cells: ['2,2'] },
];

function positions(mesh: InstancedMesh): string[] {
  const m = new Matrix4();
  const p = new Vector3();
  return Array.from({ length: mesh.count }, (_, i) => {
    mesh.getMatrixAt(i, m);
    p.setFromMatrixPosition(m);
    const { row, col } = worldToCell(p.x, p.z);
    return `${row},${col}`;
  });
}

describe('plot-grid.geometry', () => {
  it('land tile count = unlocked + locked land cells, water excluded', () => {
    const grid = buildPlotGrid(PLOTS, { centerCell: '0,0' });
    const land = grid.getObjectByName(TERRAIN_LAND_NAME) as InstancedMesh;
    expect(land.count).toBe(6);
    expect(positions(land).sort()).toEqual(['0,0', '0,1', '0,2', '1,0', '1,1', '1,2']);
    disposeObject3D(grid);
  });

  it('unlocked, locked and centre tiles are visually distinct', () => {
    const grid = buildPlotGrid(PLOTS, { centerCell: '0,0' });
    const land = grid.getObjectByName(TERRAIN_LAND_NAME) as InstancedMesh;
    const cells = land.userData['cells'] as TerrainCellInfo[];
    const colorOf = (ref: string): string => {
      const c = new Color();
      land.getColorAt(cells.findIndex((x) => x.cell === ref), c);
      return c.getHexString();
    };
    const center = colorOf('0,0');
    const unlocked = colorOf('1,1');
    const locked = colorOf('0,2');
    expect(new Set([center, unlocked, locked]).size).toBe(3);
    disposeObject3D(grid);
  });

  it('water surface covers exactly water cells and is transparent', () => {
    const grid = buildPlotGrid(PLOTS);
    const water = grid.getObjectByName(TERRAIN_WATER_NAME) as InstancedMesh;
    expect(positions(water).sort()).toEqual(['2,0', '2,1', '2,2']);
    const mat = water.material as MeshStandardMaterial;
    expect(mat.transparent).toBeTrue();
    expect(mat.opacity).toBeGreaterThan(0);
    expect(mat.opacity).toBeLessThan(1);
    expect(mat.depthWrite).toBeFalse();
    disposeObject3D(grid);
  });

  it('a cell listed in both a land and a water plot belongs to the pond only', () => {
    const plots: FarmPlot[] = [
      { id: 1, unlocked: true, terrain: 'land', cells: ['0,0', '0,1'] },
      { id: 2, unlocked: true, terrain: 'water', cells: ['0,1'] },
    ];
    const { land, water } = collectTerrainCells(plots);
    expect(land.map((c) => c.cell)).toEqual(['0,0']);
    expect(water.map((c) => c.cell)).toEqual(['0,1']);
  });

  it('pond ignores non-water cells and empty input', () => {
    expect(buildPondWater([]).children.length).toBe(0);
    const pond = buildPondWater([{ cell: '0,0', plotId: 1, terrain: 'land', unlocked: true }]);
    expect(pond.children.length).toBe(0);
  });

  /** **Validates: Requirements BR-18** — lưới/ao khớp đúng danh sách vùng. */
  it('property: land tiles = distinct land cells not in water; water = distinct water cells', () => {
    const cell = fc.tuple(fc.integer({ min: -4, max: 4 }), fc.integer({ min: -4, max: 4 })).map(([r, c]) => `${r},${c}`);
    const plot = fc.record({
      unlocked: fc.boolean(),
      terrain: fc.constantFrom<'land' | 'water'>('land', 'water'),
      cells: fc.array(cell, { maxLength: 8 }),
    });
    fc.assert(
      fc.property(fc.array(plot, { maxLength: 6 }), (raw) => {
        const plots: FarmPlot[] = raw.map((p, i) => ({ id: i + 1, ...p }));
        const waterSet = new Set(plots.filter((p) => p.terrain === 'water').flatMap((p) => p.cells));
        const landSet = new Set(
          plots.filter((p) => p.terrain === 'land').flatMap((p) => p.cells).filter((c) => !waterSet.has(c)),
        );
        const grid = buildPlotGrid(plots);
        const land = grid.getObjectByName(TERRAIN_LAND_NAME) as InstancedMesh | undefined;
        const water = grid.getObjectByName(TERRAIN_WATER_NAME) as InstancedMesh | undefined;
        const landCells = land ? positions(land) : [];
        const waterCells = water ? positions(water) : [];
        const ok =
          landCells.length === landSet.size &&
          landCells.every((c) => landSet.has(c)) &&
          waterCells.length === waterSet.size &&
          waterCells.every((c) => waterSet.has(c)) &&
          waterCells.every((c) => {
            const { x, z } = cellToWorld(parseCell(c)!);
            return Number.isFinite(x) && Number.isFinite(z);
          });
        disposeObject3D(grid);
        return ok;
      }),
      { numRuns: 100 },
    );
  });
});
