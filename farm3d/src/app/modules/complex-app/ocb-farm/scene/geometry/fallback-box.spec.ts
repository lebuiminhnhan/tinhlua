import { Color, MeshStandardMaterial } from 'three';
import {
  DEFAULT_FALLBACK_COLOR,
  createFallbackBox,
  disposeFallbackBoxes,
  fallbackBoxParts,
  normalizeFallbackColor,
} from './fallback-box';

describe('fallback-box', () => {
  afterEach(() => disposeFallbackBoxes());

  it('uses the given manifest colour', () => {
    const box = createFallbackBox('#8b5a3c');
    const mat = box.material as MeshStandardMaterial;
    expect(mat.color.getHexString()).toBe(new Color('#8B5A3C').getHexString());
    expect(box.userData['fallback']).toBeTrue();
    expect(box.userData['fallbackColor']).toBe('#8B5A3C');
  });

  it('invalid colours fall back to the default colour', () => {
    for (const bad of ['', 'red', '#123', '#GGGGGG', null, undefined]) {
      expect(normalizeFallbackColor(bad)).toBe(DEFAULT_FALLBACK_COLOR);
      expect(createFallbackBox(bad).userData['fallbackColor']).toBe(DEFAULT_FALLBACK_COLOR);
    }
    expect(normalizeFallbackColor('nope', '#4FA3D9')).toBe('#4FA3D9');
  });

  it('shares geometry across boxes and material per colour; base sits on y = 0', () => {
    const a = createFallbackBox('#FF0000');
    const b = createFallbackBox('#ff0000');
    const c = createFallbackBox('#00FF00');
    expect(a.geometry).toBe(b.geometry);
    expect(a.material).toBe(b.material);
    expect(a.material).not.toBe(c.material);
    a.geometry.computeBoundingBox();
    expect(a.geometry.boundingBox!.min.y).toBeCloseTo(0);
    const parts = fallbackBoxParts('#FF0000', { width: 1, height: 2, depth: 1 });
    expect(parts.geometry === a.geometry).toBeTrue();
    expect(parts.matrix.elements[5]).toBe(2);
  });
});
