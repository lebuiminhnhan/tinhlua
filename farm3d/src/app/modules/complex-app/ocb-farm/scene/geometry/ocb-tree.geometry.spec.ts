import * as fc from 'fast-check';
import { Box3, InstancedMesh, Matrix4, Mesh, Vector3 } from 'three';
import {
  OCB_TREE_BLOOM_NAME,
  OCB_TREE_BRANCH_NAME,
  OCB_TREE_CANOPY_NAME,
  OCB_TREE_TRUNK_NAME,
  OCB_TREE_TUFT_NAME,
  OcbTreeBranchInfo,
  TREE_GROWTH_RATIO,
  buildOcbTree,
  ocbTreeBranchAt,
  ocbTreeDimensions,
} from './ocb-tree.geometry';
import { disposeObject3D } from './dispose';

function byName<T>(root: ReturnType<typeof buildOcbTree>, name: string): T | undefined {
  return root.getObjectByName(name) as T | undefined;
}

function branchMatrices(tree: ReturnType<typeof buildOcbTree>): number[][] {
  const mesh = byName<InstancedMesh>(tree, OCB_TREE_BRANCH_NAME);
  if (!mesh) return [];
  const m = new Matrix4();
  return Array.from({ length: mesh.count }, (_, i) => {
    mesh.getMatrixAt(i, m);
    return [...m.elements];
  });
}

function height(tree: ReturnType<typeof buildOcbTree>): number {
  tree.updateMatrixWorld(true);
  return new Box3().setFromObject(tree).getSize(new Vector3()).y;
}

describe('ocb-tree.geometry', () => {
  it('branch count 0 has no branch or tuft meshes', () => {
    const tree = buildOcbTree({ milestone: 4, branches: 0 });
    expect(byName(tree, OCB_TREE_TRUNK_NAME)).toBeDefined();
    expect(byName(tree, OCB_TREE_CANOPY_NAME)).toBeDefined();
    expect(byName(tree, OCB_TREE_BRANCH_NAME)).toBeUndefined();
    expect(byName(tree, OCB_TREE_TUFT_NAME)).toBeUndefined();
    disposeObject3D(tree);
  });

  it('assembles exactly one trunk, one branch and one canopy template', () => {
    const tree = buildOcbTree({ milestone: 10, branches: 5 });
    const trunk = byName<Mesh>(tree, OCB_TREE_TRUNK_NAME)!;
    const canopy = byName<Mesh>(tree, OCB_TREE_CANOPY_NAME)!;
    const branches = byName<InstancedMesh>(tree, OCB_TREE_BRANCH_NAME)!;
    const tufts = byName<InstancedMesh>(tree, OCB_TREE_TUFT_NAME)!;
    expect(branches.count).toBe(5);
    expect(tufts.count).toBe(5);
    // Chùm lá đầu nhánh dùng lại mẫu tán; nhánh dùng chung material với thân.
    expect(tufts.geometry).toBe(canopy.geometry);
    expect(branches.material).toBe(trunk.material);
    const geometries = new Set<unknown>();
    tree.traverse((o) => 'geometry' in o && geometries.add((o as Mesh).geometry));
    expect(geometries.size).toBe(3);
    disposeObject3D(tree);
  });

  it('each branch carries its index / tenure year / calendar year', () => {
    const tree = buildOcbTree({ milestone: 14, branches: 5, joinYear: 2018 });
    const mesh = byName<InstancedMesh>(tree, OCB_TREE_BRANCH_NAME)!;
    const info = ocbTreeBranchAt(mesh, 4) as OcbTreeBranchInfo;
    expect(info).toEqual({ index: 4, tenureYear: 7, calendarYear: 2025 });
    expect(ocbTreeBranchAt(byName<InstancedMesh>(tree, OCB_TREE_TUFT_NAME)!, 0)?.tenureYear).toBe(3);
    expect(ocbTreeBranchAt(byName<Mesh>(tree, OCB_TREE_TRUNK_NAME)!, 0)).toBeNull();
    disposeObject3D(tree);
  });

  it('higher milestone → taller trunk and bigger canopy by at least the growth ratio', () => {
    for (let m = 0; m < 40; m++) {
      const a = ocbTreeDimensions(m);
      const b = ocbTreeDimensions(m + 1);
      expect(b.trunkHeight / a.trunkHeight).toBeGreaterThanOrEqual(TREE_GROWTH_RATIO - 1e-9);
      expect(b.canopyRadius / a.canopyRadius).toBeGreaterThanOrEqual(TREE_GROWTH_RATIO - 1e-9);
    }
    expect(height(buildOcbTree({ milestone: 12, branches: 0 }))).toBeGreaterThan(
      height(buildOcbTree({ milestone: 11, branches: 0 })),
    );
  });

  it('blooming variant adds fruit + blossom instances', () => {
    const tree = buildOcbTree({ milestone: 6, branches: 1, blooming: true, fruitCount: 5 });
    const bloom = byName<InstancedMesh>(tree, OCB_TREE_BLOOM_NAME)!;
    const kinds = bloom.userData['kinds'] as string[];
    expect(kinds.filter((k) => k === 'fruit').length).toBe(5);
    expect(byName(buildOcbTree({ milestone: 6, branches: 1 }), OCB_TREE_BLOOM_NAME)).toBeUndefined();
  });

  /** **Validates: Requirements US-5, US-6** — tất định, khác nhau theo mốc và số nhánh. */
  it('property: same input → same shape; different milestone or branches → different shape', () => {
    const milestone = fc.integer({ min: 0, max: 40 });
    const branches = fc.integer({ min: 0, max: 30 });
    fc.assert(
      fc.property(milestone, branches, (m, b) => {
        const t1 = buildOcbTree({ milestone: m, branches: b });
        const t2 = buildOcbTree({ milestone: m, branches: b });
        const same =
          JSON.stringify(branchMatrices(t1)) === JSON.stringify(branchMatrices(t2)) &&
          height(t1) === height(t2);
        const moreBranches = buildOcbTree({ milestone: m, branches: b + 1 });
        const nextMilestone = buildOcbTree({ milestone: m + 1, branches: b });
        const branchDiffers = branchMatrices(moreBranches).length === branchMatrices(t1).length + 1;
        const milestoneDiffers = height(nextMilestone) > height(t1);
        [t1, t2, moreBranches, nextMilestone].forEach((t) => disposeObject3D(t));
        return same && branchDiffers && milestoneDiffers;
      }),
      { numRuns: 60 },
    );
  });

  it('existing branches keep their placement when a new year adds a branch (relative to tree size)', () => {
    const a = branchMatrices(buildOcbTree({ milestone: 10, branches: 3 }));
    const b = branchMatrices(buildOcbTree({ milestone: 10, branches: 4 }));
    expect(b.slice(0, 3)).toEqual(a);
  });
});
