import { Box3, BoxGeometry, Group, Mesh, Vector3 } from 'three';
import { CELL_SIZE } from './farm-scene-math';
import { fitMatrix, fitSpecFor, modelBounds } from './model-fit';

describe('model-fit', () => {
  it('scales a tiny model so its footprint matches the rule and its base sits on y = 0', () => {
    // Mô phỏng mô hình Quaternius: hình học rất nhỏ, lệch tâm.
    const root = new Group();
    const mesh = new Mesh(new BoxGeometry(0.02, 0.01, 0.04));
    mesh.position.set(0.5, 0.3, -0.2);
    root.add(mesh);

    const spec = fitSpecFor('animal:cow');
    const fitted = modelBounds(root).applyMatrix4(fitMatrix(modelBounds(root), spec));
    const size = fitted.getSize(new Vector3());
    const center = fitted.getCenter(new Vector3());

    expect(Math.max(size.x, size.z)).toBeLessThanOrEqual(spec.footprint * CELL_SIZE + 1e-6);
    expect(size.y).toBeLessThanOrEqual((spec.maxHeight ?? Infinity) * CELL_SIZE + 1e-6);
    expect(fitted.min.y).toBeCloseTo(0);
    expect(center.x).toBeCloseTo(0);
    expect(center.z).toBeCloseTo(0);
  });

  it('shrinks an oversized fence to exactly one cell wide', () => {
    const fence = new Box3(new Vector3(-2.95, 0, -0.08), new Vector3(2.95, 1.1, 0.08));
    const fitted = fence.clone().applyMatrix4(fitMatrix(fence, fitSpecFor('decor:fence')));
    expect(fitted.getSize(new Vector3()).x).toBeCloseTo(CELL_SIZE);
  });

  it('keeps animals smaller than a cell so they have room to roam', () => {
    for (const species of ['chicken', 'fish', 'sheep', 'pig', 'cow', 'horse']) {
      expect(fitSpecFor(`animal:${species}`).footprint).toBeLessThan(0.5);
    }
  });

  it('returns identity for an empty model', () => {
    expect(fitMatrix(new Box3(), fitSpecFor('plant:rose:grown')).equals(fitMatrix(new Box3(), { footprint: 1 }))).toBeTrue();
  });
});
