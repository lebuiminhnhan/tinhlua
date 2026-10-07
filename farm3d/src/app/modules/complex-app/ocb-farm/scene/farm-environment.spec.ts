import { DirectionalLight, HemisphereLight, Scene } from 'three';
import { FARM_RENDER_PARAMS } from '../services/quality.service';
import {
  DEFAULT_DAY_PHASE_CONFIG,
  dayPhaseAtVn,
  dayPhaseConfigFrom,
  displayedPhase,
  particleCount,
  resolveEnvironmentLook,
} from './farm-environment';
import { FarmEnvironmentFx } from './farm-environment-fx';

/** Mốc UTC tương ứng `hh:mm` giờ Việt Nam ngày 2025-03-10. */
function vn(hour: number, minute = 0): number {
  return Date.UTC(2025, 2, 10, hour - 7, minute);
}

describe('farm-environment', () => {
  it('maps VN hours to the 4 day phases; boundaries belong to the starting phase', () => {
    expect(dayPhaseAtVn(vn(4, 59))).toBe('night');
    expect(dayPhaseAtVn(vn(5))).toBe('morning');
    expect(dayPhaseAtVn(vn(10, 59))).toBe('morning');
    expect(dayPhaseAtVn(vn(11))).toBe('noon');
    expect(dayPhaseAtVn(vn(14))).toBe('afternoon');
    expect(dayPhaseAtVn(vn(18))).toBe('night');
    expect(dayPhaseAtVn(vn(23, 59))).toBe('night');
  });

  it('reads phase config and falls back to defaults when invalid or unordered', () => {
    expect(dayPhaseConfigFrom({ day_phase_morning_start: 6 }).morningStart).toBe(6);
    expect(dayPhaseConfigFrom({ day_phase_noon_start: 3 })).toEqual(DEFAULT_DAY_PHASE_CONFIG);
    expect(dayPhaseConfigFrom(null)).toEqual(DEFAULT_DAY_PHASE_CONFIG);
  });

  it('scene lock only overrides the displayed phase', () => {
    expect(displayedPhase('noon', null)).toBe('noon');
    expect(displayedPhase('noon', 'night')).toBe('night');
  });

  it('turns decor lights on only at night and dims light for clouds / rain', () => {
    const sunny = resolveEnvironmentLook({ phase: 'noon', weather: 'sunny', theme: null });
    const cloudy = resolveEnvironmentLook({ phase: 'noon', weather: 'cloudy', theme: null });
    const rainy = resolveEnvironmentLook({ phase: 'noon', weather: 'rainy', theme: null });
    const night = resolveEnvironmentLook({ phase: 'night', weather: 'sunny', theme: null });
    expect(sunny.decorLightsOn).toBeFalse();
    expect(night.decorLightsOn).toBeTrue();
    expect(cloudy.sunIntensity).toBeLessThan(sunny.sunIntensity);
    expect(rainy.sunIntensity).toBeLessThan(cloudy.sunIntensity);
    expect(rainy.rain).toBeTrue();
    expect(cloudy.rain).toBeFalse();
    expect(sunny.sky).toBe('#8fd3f5');
    expect(night.sunIntensity).toBeLessThan(sunny.sunIntensity);
  });

  it('applies seasonal particles and sky tint per theme', () => {
    const tet = resolveEnvironmentLook({ phase: 'noon', weather: 'sunny', theme: 'tet' });
    const xmas = resolveEnvironmentLook({ phase: 'noon', weather: 'sunny', theme: 'christmas' });
    expect(tet.seasonal?.kind).toBe('petals');
    expect(xmas.seasonal?.kind).toBe('snow');
    expect(tet.sky).not.toBe('#8fd3f5');
  });

  it('respects quality particle limits (Low: none)', () => {
    expect(particleCount(1200, FARM_RENDER_PARAMS.low.particles)).toBe(0);
    expect(particleCount(1200, FARM_RENDER_PARAMS.medium.particles)).toBe(400);
    expect(particleCount(1200, FARM_RENDER_PARAMS.high.particles)).toBe(1200);
  });
});

describe('FarmEnvironmentFx', () => {
  function setup(): { scene: Scene; fx: FarmEnvironmentFx; sun: DirectionalLight } {
    const scene = new Scene();
    const sun = new DirectionalLight();
    const fx = new FarmEnvironmentFx(scene, new HemisphereLight(), sun);
    fx.setBounds(4, 4, 6);
    fx.setDecorLights([{ x: 1, z: 1 }, { x: 2, z: 2 }, { x: 3, z: 3 }]);
    return { scene, fx, sun };
  }
  const count = (scene: Scene, name: string): number =>
    scene.children.filter((c) => c.name === name || c.name.startsWith(name + ':')).length;

  it('adds decor point lights only at night, capped by quality, and removes them by day', () => {
    const { scene, fx } = setup();
    fx.setQuality({ ...FARM_RENDER_PARAMS.medium, maxDecorPointLights: 2 });
    fx.setInput({ phase: 'night', weather: 'sunny', theme: null });
    expect(count(scene, 'farm-decor-light')).toBe(2);
    fx.setInput({ phase: 'morning', weather: 'sunny', theme: null });
    expect(count(scene, 'farm-decor-light')).toBe(0);
  });

  it('Low quality: no point lights, no particles, sky still changes', () => {
    const { scene, fx } = setup();
    fx.setQuality(FARM_RENDER_PARAMS.low);
    fx.setInput({ phase: 'night', weather: 'rainy', theme: 'christmas' });
    expect(count(scene, 'farm-decor-light')).toBe(0);
    expect(count(scene, 'farm-rain')).toBe(0);
    expect(count(scene, 'farm-seasonal')).toBe(0);
    expect(fx.currentLook().sky).toBe(resolveEnvironmentLook({ phase: 'night', weather: 'rainy', theme: 'christmas' }).sky);
  });

  it('creates rain + seasonal particles and disposes them', () => {
    const { scene, fx } = setup();
    fx.setQuality(FARM_RENDER_PARAMS.high);
    fx.setInput({ phase: 'noon', weather: 'rainy', theme: 'tet' });
    expect(count(scene, 'farm-rain')).toBe(1);
    expect(count(scene, 'farm-seasonal')).toBe(1);
    fx.update(0);
    fx.update(16);
    fx.dispose();
    expect(count(scene, 'farm-rain')).toBe(0);
    expect(count(scene, 'farm-seasonal')).toBe(0);
  });
});
