import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Points,
  PointsMaterial,
  PointLight,
  Scene,
} from 'three';
import type { FarmRenderParams } from '../services/quality.service';
import { CELL_SIZE } from './farm-scene-math';
import {
  FarmEnvironmentInput,
  FarmEnvironmentLook,
  SeasonalParticles,
  particleCount,
  resolveEnvironmentLook,
} from './farm-environment';

/**
 * OCB Farm — hiệu ứng môi trường trên khung 3D (task 11.4).
 *
 * Nhận ánh sáng/scene của `FarmSceneService` và áp bộ hiển thị (`resolveEnvironmentLook`):
 * màu trời (`scene.background`), `DirectionalLight` (màu, cường độ, hướng, độ đậm bóng),
 * `HemisphereLight`, `PointLight` cho vật trang trí là nguồn sáng (chỉ buổi đêm), hệ hạt
 * mưa (`LineSegments`) và hệ hạt theo dịp lễ (`Points`).
 *
 * - Mức chất lượng: số hạt theo `particles` (Thấp: không có hạt); đèn trang trí theo
 *   `decorPointLights` / `maxDecorPointLights` (Thấp: không có đèn). Trời và ánh sáng vẫn đổi.
 * - Thuần hiển thị: không đọc/ghi state trò chơi.
 * - `dispose()` giải phóng geometry/material của hệ hạt và gỡ đèn; dùng lại được sau đó
 *   (khung 3D khởi tạo lại sau mất context).
 *
 * _Requirements: US-30, US-31, US-33_
 */

export interface DecorLightSpot {
  x: number;
  z: number;
}

interface ParticleVolume {
  cx: number;
  cz: number;
  radius: number;
}

const DEG = Math.PI / 180;
// Kích thước/vận tốc theo "đơn vị ô" × CELL_SIZE.
const S = CELL_SIZE;
const VOLUME_HEIGHT = 12 * S;
const RAIN_BASE_COUNT = 1200;
const RAIN_SPEED = 16 * S;
const RAIN_STREAK = 0.45 * S;
/** Gió nghiêng nhẹ hạt mưa theo trục X. */
const RAIN_WIND = 0.18;
const DECOR_LIGHT_COLOR = '#ffcf7a';
/** Đèn suy giảm theo bình phương khoảng cách → cường độ nhân S² để giữ độ sáng cũ. */
const DECOR_LIGHT_INTENSITY = 4 * S * S;
const DECOR_LIGHT_DISTANCE = 4.5 * S;
const DECOR_LIGHT_HEIGHT = 1.1 * S;
/** Bước thời gian tối đa mỗi khung (giây) — tránh hạt nhảy xa sau khi tab ẩn. */
const MAX_DT = 0.1;

export class FarmEnvironmentFx {
  private input: FarmEnvironmentInput = { phase: 'noon', weather: 'sunny', theme: null };
  private look: FarmEnvironmentLook = resolveEnvironmentLook(this.input);
  private params: Readonly<FarmRenderParams> | null = null;
  private volume: ParticleVolume = { cx: 0, cz: 0, radius: 6 * S };
  private decorSpots: DecorLightSpot[] = [];

  private readonly background = new Color();
  private readonly decorLights: PointLight[] = [];

  private rain: LineSegments<BufferGeometry, LineBasicMaterial> | null = null;
  private rainSeeds: Float32Array | null = null;

  private seasonal: Points<BufferGeometry, PointsMaterial> | null = null;
  private seasonalSpec: SeasonalParticles | null = null;
  private seasonalPhase: Float32Array | null = null;

  private lastTime: number | null = null;
  private elapsed = 0;

  constructor(
    private readonly scene: Scene,
    private readonly hemi: HemisphereLight,
    private readonly sun: DirectionalLight,
  ) {
    this.scene.background = this.background;
  }

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------

  /** Đổi buổi / thời tiết / chủ đề hiển thị. */
  setInput(input: FarmEnvironmentInput): void {
    const same =
      input.phase === this.input.phase && input.weather === this.input.weather && input.theme === this.input.theme;
    if (same) return;
    this.input = { ...input };
    this.look = resolveEnvironmentLook(this.input);
    this.apply();
  }

  /** Mức chất lượng mới — dựng lại hệ hạt / đèn theo giới hạn mới. */
  setQuality(params: Readonly<FarmRenderParams>): void {
    this.params = params;
    this.apply();
  }

  /** Khu vực nông trại (tâm + bán kính, đơn vị thế giới) — đặt mặt trời và vùng hạt. */
  setBounds(cx: number, cz: number, radius: number): void {
    const changed = cx !== this.volume.cx || cz !== this.volume.cz || radius !== this.volume.radius;
    this.volume = { cx, cz, radius };
    this.placeSun();
    if (changed) {
      // Vùng hạt đổi kích thước → dựng lại để rải đều.
      this.disposeRain();
      this.disposeSeasonal();
      this.syncParticles();
    }
    this.syncDecorLights();
  }

  /** Toạ độ thế giới của vật trang trí là nguồn sáng (`decor.is_light`). */
  setDecorLights(spots: readonly DecorLightSpot[]): void {
    this.decorSpots = spots.map((s) => ({ x: s.x, z: s.z }));
    this.syncDecorLights();
  }

  /** Gọi mỗi khung hình (`time` = timestamp rAF, ms). */
  update(time: number): void {
    const dt = this.lastTime === null ? 0 : Math.min(MAX_DT, Math.max(0, (time - this.lastTime) / 1000));
    this.lastTime = time;
    this.elapsed += dt;
    if (dt === 0) return;
    if (this.rain) this.stepRain(dt);
    if (this.seasonal) this.stepSeasonal(dt);
  }

  /** Bộ hiển thị đang áp (để kiểm thử / chụp ảnh). */
  currentLook(): Readonly<FarmEnvironmentLook> {
    return this.look;
  }

  /** Gỡ đèn và giải phóng tài nguyên GPU của hệ hạt. Dùng lại được: gọi `reapply()`. */
  dispose(): void {
    this.disposeRain();
    this.disposeSeasonal();
    for (const light of this.decorLights) {
      light.removeFromParent();
      light.dispose();
    }
    this.decorLights.length = 0;
    this.lastTime = null;
  }

  /** Áp lại toàn bộ (sau khi khung 3D khởi tạo lại). */
  reapply(): void {
    if (this.scene.background !== this.background) this.scene.background = this.background;
    this.apply();
  }

  // ---------------------------------------------------------------------------
  // Áp bộ hiển thị
  // ---------------------------------------------------------------------------

  private apply(): void {
    const look = this.look;
    this.background.set(look.sky);
    this.scene.background = this.background;

    this.sun.color.set(look.sunColor);
    this.sun.intensity = look.sunIntensity;
    this.sun.shadow.intensity = look.shadowIntensity;
    this.hemi.color.set(look.hemiSky);
    this.hemi.groundColor.set(look.hemiGround);
    this.hemi.intensity = look.hemiIntensity;
    this.placeSun();

    this.syncParticles();
    this.syncDecorLights();
  }

  private placeSun(): void {
    const { cx, cz, radius } = this.volume;
    const elev = this.look.sunElevationDeg * DEG;
    const azim = this.look.sunAzimuthDeg * DEG;
    // Đủ xa để phủ trọn lưới, vẫn nằm trong `shadow.camera.far` của scene service.
    const dist = radius * 2.5 + 8 * S;
    const horiz = Math.cos(elev) * dist;
    this.sun.position.set(cx + Math.cos(azim) * horiz, Math.sin(elev) * dist, cz + Math.sin(azim) * horiz);
    this.sun.target.position.set(cx, 0, cz);
    this.sun.target.updateMatrixWorld();
  }

  private syncDecorLights(): void {
    const params = this.params;
    const enabled = this.look.decorLightsOn && !!params?.decorPointLights;
    const wanted = enabled ? Math.min(this.decorSpots.length, params?.maxDecorPointLights ?? 0) : 0;

    // Đổi số đèn trong scene làm shader biên dịch lại → chỉ thêm/bớt khi số lượng đổi.
    while (this.decorLights.length > wanted) {
      const light = this.decorLights.pop();
      light?.removeFromParent();
      light?.dispose();
    }
    while (this.decorLights.length < wanted) {
      const light = new PointLight(DECOR_LIGHT_COLOR, DECOR_LIGHT_INTENSITY, DECOR_LIGHT_DISTANCE, 2);
      light.name = 'farm-decor-light';
      light.castShadow = false;
      this.decorLights.push(light);
      this.scene.add(light);
    }
    this.decorLights.forEach((light, i) => {
      const spot = this.decorSpots[i];
      light.position.set(spot.x, DECOR_LIGHT_HEIGHT, spot.z);
    });
  }

  // ---------------------------------------------------------------------------
  // Hệ hạt
  // ---------------------------------------------------------------------------

  private syncParticles(): void {
    const particles = this.params?.particles ?? { enabled: false, density: 0, maxCount: 0 };

    const rainCount = this.look.rain ? particleCount(RAIN_BASE_COUNT, particles) : 0;
    if (rainCount === 0) {
      this.disposeRain();
    } else if (!this.rain || this.rainSeeds?.length !== rainCount) {
      this.disposeRain();
      this.createRain(rainCount);
    }

    const spec = this.look.seasonal;
    const seasonalCount = spec ? particleCount(spec.baseCount, particles) : 0;
    if (!spec || seasonalCount === 0) {
      this.disposeSeasonal();
    } else if (
      !this.seasonal ||
      this.seasonalSpec !== spec ||
      (this.seasonalPhase?.length ?? 0) !== seasonalCount
    ) {
      this.disposeSeasonal();
      this.createSeasonal(spec, seasonalCount);
    }
    if (this.rain) this.rain.material.color.set(this.input.phase === 'night' ? '#6f86b8' : '#b6d4f2');
  }

  private randomInVolume(): [number, number, number] {
    const { cx, cz, radius } = this.volume;
    const r = radius + 2 * S;
    return [cx + (Math.random() * 2 - 1) * r, Math.random() * VOLUME_HEIGHT, cz + (Math.random() * 2 - 1) * r];
  }

  private createRain(count: number): void {
    const positions = new Float32Array(count * 6);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const [x, y, z] = this.randomInVolume();
      seeds[i] = 0.8 + Math.random() * 0.4;
      this.writeDrop(positions, i, x, y, z);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    const material = new LineBasicMaterial({ color: '#b6d4f2', transparent: true, opacity: 0.55, depthWrite: false });
    const rain = new LineSegments(geometry, material);
    rain.name = 'farm-rain';
    rain.frustumCulled = false;
    rain.renderOrder = 5;
    this.rain = rain;
    this.rainSeeds = seeds;
    this.scene.add(rain);
  }

  private writeDrop(positions: Float32Array, i: number, x: number, y: number, z: number): void {
    const o = i * 6;
    positions[o] = x;
    positions[o + 1] = y;
    positions[o + 2] = z;
    positions[o + 3] = x - RAIN_WIND * RAIN_STREAK;
    positions[o + 4] = y + RAIN_STREAK;
    positions[o + 5] = z;
  }

  private stepRain(dt: number): void {
    const rain = this.rain;
    const seeds = this.rainSeeds;
    if (!rain || !seeds) return;
    const attr = rain.geometry.getAttribute('position') as BufferAttribute;
    const pos = attr.array as Float32Array;
    for (let i = 0; i < seeds.length; i++) {
      const o = i * 6;
      const v = RAIN_SPEED * seeds[i] * dt;
      let x = pos[o] + RAIN_WIND * v;
      let y = pos[o + 1] - v;
      let z = pos[o + 2];
      if (y < 0) {
        [x, , z] = this.randomInVolume();
        y = VOLUME_HEIGHT;
      }
      this.writeDrop(pos, i, x, y, z);
    }
    attr.needsUpdate = true;
  }

  private createSeasonal(spec: SeasonalParticles, count: number): void {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    const c = new Color();
    for (let i = 0; i < count; i++) {
      const [x, y, z] = this.randomInVolume();
      positions.set([x, y, z], i * 3);
      c.set(spec.colors[i % spec.colors.length]);
      colors.set([c.r, c.g, c.b], i * 3);
      phase[i] = Math.random() * Math.PI * 2;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    const material = new PointsMaterial({
      size: spec.size,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: spec.kind === 'lanterns' ? 0.95 : 0.85,
      depthWrite: false,
    });
    const points = new Points(geometry, material);
    points.name = `farm-seasonal:${spec.kind}`;
    points.frustumCulled = false;
    points.renderOrder = 5;
    this.seasonal = points;
    this.seasonalSpec = spec;
    this.seasonalPhase = phase;
    this.scene.add(points);
  }

  private stepSeasonal(dt: number): void {
    const points = this.seasonal;
    const spec = this.seasonalSpec;
    const phase = this.seasonalPhase;
    if (!points || !spec || !phase) return;
    const attr = points.geometry.getAttribute('position') as BufferAttribute;
    const pos = attr.array as Float32Array;
    const t = this.elapsed;
    for (let i = 0; i < phase.length; i++) {
      const o = i * 3;
      const p = phase[i];
      // `speedY` / `sway` khai báo theo đơn vị ô/giây.
      pos[o] += Math.sin(t * 0.9 + p) * spec.sway * S * dt;
      pos[o + 1] += spec.speedY * S * (0.75 + 0.5 * Math.abs(Math.sin(p))) * dt;
      pos[o + 2] += Math.cos(t * 0.7 + p) * spec.sway * S * 0.6 * dt;
      const out = spec.speedY < 0 ? pos[o + 1] < 0 : pos[o + 1] > VOLUME_HEIGHT;
      if (out) {
        const [x, , z] = this.randomInVolume();
        pos[o] = x;
        pos[o + 1] = spec.speedY < 0 ? VOLUME_HEIGHT : 0;
        pos[o + 2] = z;
      }
    }
    attr.needsUpdate = true;
  }

  private disposeRain(): void {
    if (!this.rain) return;
    this.rain.removeFromParent();
    this.rain.geometry.dispose();
    this.rain.material.dispose();
    this.rain = null;
    this.rainSeeds = null;
  }

  private disposeSeasonal(): void {
    if (!this.seasonal) return;
    this.seasonal.removeFromParent();
    this.seasonal.geometry.dispose();
    this.seasonal.material.dispose();
    this.seasonal = null;
    this.seasonalSpec = null;
    this.seasonalPhase = null;
  }
}
