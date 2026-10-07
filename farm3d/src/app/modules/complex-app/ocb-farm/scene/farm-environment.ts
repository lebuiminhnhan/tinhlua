import { Color } from 'three';
import type { DayPhase, FarmSceneLock, SeasonTheme, Weather } from '../models/ocb-farm.model';

/**
 * OCB Farm — bảng "bộ hiển thị" môi trường (task 11.4) — hàm thuần, không đụng GPU.
 *
 * - Buổi trong ngày (US-30): màu trời, màu/cường độ/hướng `DirectionalLight`, cường độ
 *   `HemisphereLight`, độ đậm bóng đổ; buổi đêm bật nguồn sáng trang trí.
 * - Thời tiết (US-31): nắng giữ nguyên, nhiều mây giảm sáng + trời xám, mưa giảm sáng
 *   mạnh hơn + hệ hạt mưa.
 * - Chủ đề dịp lễ (US-33): pha màu trời + hệ hạt theo dịp (hoa mai/đào, tuyết, đèn lồng,
 *   giấy màu).
 *
 * Mọi thứ ở đây CHỈ là hiển thị — khoá cảnh (`scene_lock`) chỉ đổi buổi được vẽ, không
 * bao giờ tác động thời tiết, sinh trưởng, độ no hay phần thưởng (do backend quyết định).
 *
 * _Requirements: US-30, US-31, US-33_
 */

// ---------------------------------------------------------------------------
// Buổi trong ngày theo giờ Việt Nam
// ---------------------------------------------------------------------------

/** Giờ bắt đầu (giờ VN, 0..23) của từng buổi — khớp `day_phase_*_start` trong `farm_config`. */
export interface DayPhaseConfig {
  morningStart: number;
  noonStart: number;
  afternoonStart: number;
  nightStart: number;
}

export const DEFAULT_DAY_PHASE_CONFIG: Readonly<DayPhaseConfig> = {
  morningStart: 5,
  noonStart: 11,
  afternoonStart: 14,
  nightStart: 18,
};

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Đọc cấu hình buổi từ `GET /config` (`values`); khoá thiếu/không hợp lệ giữ mặc định. */
export function dayPhaseConfigFrom(values: Readonly<Record<string, number>> | null | undefined): DayPhaseConfig {
  const pick = (key: string, fallback: number): number => {
    const v = values?.[key];
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23 ? v : fallback;
  };
  const d = DEFAULT_DAY_PHASE_CONFIG;
  const config: DayPhaseConfig = {
    morningStart: pick('day_phase_morning_start', d.morningStart),
    noonStart: pick('day_phase_noon_start', d.noonStart),
    afternoonStart: pick('day_phase_afternoon_start', d.afternoonStart),
    nightStart: pick('day_phase_night_start', d.nightStart),
  };
  // Phải tăng dần sáng < trưa < chiều < đêm; sai thứ tự → dùng mặc định cho an toàn.
  const ordered =
    config.morningStart < config.noonStart &&
    config.noonStart < config.afternoonStart &&
    config.afternoonStart < config.nightStart;
  return ordered ? config : { ...d };
}

/** Buổi tại thời điểm `nowMs` (giờ VN). Ranh giới thuộc về buổi bắt đầu; 4 buổi phủ kín 24h. */
export function dayPhaseAtVn(nowMs: number, config: DayPhaseConfig = DEFAULT_DAY_PHASE_CONFIG): DayPhase {
  const hour = new Date(nowMs + VN_OFFSET_MS).getUTCHours();
  if (hour >= config.morningStart && hour < config.noonStart) return 'morning';
  if (hour >= config.noonStart && hour < config.afternoonStart) return 'noon';
  if (hour >= config.afternoonStart && hour < config.nightStart) return 'afternoon';
  return 'night';
}

/** Buổi được vẽ: buổi khoá cảnh (nếu bật) hoặc buổi theo giờ thực. */
export function displayedPhase(livePhase: DayPhase, lock: FarmSceneLock): DayPhase {
  return lock ?? livePhase;
}

// ---------------------------------------------------------------------------
// Bộ hiển thị
// ---------------------------------------------------------------------------

/** Đầu vào hiển thị của khung 3D — đã áp khoá cảnh. */
export interface FarmEnvironmentInput {
  phase: DayPhase;
  weather: Weather;
  theme: SeasonTheme | null;
}

export type SeasonalParticleKind = 'petals' | 'snow' | 'lanterns' | 'confetti';

export interface SeasonalParticles {
  kind: SeasonalParticleKind;
  /** Bảng màu hạt (hex). */
  colors: readonly string[];
  /** Số hạt gốc ở mật độ 1 (nhân `particles.density`, chặn `maxCount`). */
  baseCount: number;
  /** Kích thước hạt (px — camera trực giao không thu nhỏ theo khoảng cách). */
  size: number;
  /** Vận tốc theo trục Y (đơn vị/giây; âm là rơi, dương là bay lên). */
  speedY: number;
  /** Biên độ đung đưa ngang. */
  sway: number;
}

export interface FarmEnvironmentLook {
  /** Màu nền trời (hex). */
  sky: string;
  sunColor: string;
  sunIntensity: number;
  /** Góc nâng của mặt trời / mặt trăng (độ). */
  sunElevationDeg: number;
  /** Phương vị (độ, quanh trục Y) — sáng phía đông, chiều phía tây. */
  sunAzimuthDeg: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  /** Độ đậm bóng đổ 0..1 (`light.shadow.intensity`). */
  shadowIntensity: number;
  /** Bật `PointLight` của vật trang trí là nguồn sáng (chỉ buổi đêm). */
  decorLightsOn: boolean;
  rain: boolean;
  seasonal: SeasonalParticles | null;
}

interface PhasePreset {
  sky: string;
  sunColor: string;
  sunIntensity: number;
  sunElevationDeg: number;
  sunAzimuthDeg: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  shadowIntensity: number;
}

export const PHASE_PRESETS: Readonly<Record<DayPhase, Readonly<PhasePreset>>> = {
  morning: {
    sky: '#b8e2f6',
    sunColor: '#ffe3b8',
    sunIntensity: 1.3,
    sunElevationDeg: 28,
    sunAzimuthDeg: 70,
    hemiSky: '#fff4e0',
    hemiGround: '#7a9a3a',
    hemiIntensity: 0.8,
    shadowIntensity: 0.7,
  },
  noon: {
    sky: '#8fd3f5',
    sunColor: '#ffffff',
    sunIntensity: 1.6,
    sunElevationDeg: 62,
    sunAzimuthDeg: 30,
    hemiSky: '#fff6e0',
    hemiGround: '#7a9a3a',
    hemiIntensity: 0.9,
    shadowIntensity: 0.85,
  },
  afternoon: {
    sky: '#ffd9a8',
    sunColor: '#ffbf73',
    sunIntensity: 1.2,
    sunElevationDeg: 26,
    sunAzimuthDeg: -60,
    hemiSky: '#ffe6c7',
    hemiGround: '#6b7f45',
    hemiIntensity: 0.75,
    shadowIntensity: 0.7,
  },
  night: {
    sky: '#16223f',
    sunColor: '#a8bcff',
    sunIntensity: 0.35,
    sunElevationDeg: 50,
    sunAzimuthDeg: -20,
    hemiSky: '#3a4a8c',
    hemiGround: '#1e2a1c',
    hemiIntensity: 0.35,
    shadowIntensity: 0.35,
  },
};

interface WeatherModifier {
  /** Hệ số nhân cường độ ánh sáng mặt trời. */
  sunFactor: number;
  hemiFactor: number;
  shadowFactor: number;
  /** Tỉ lệ pha màu xám vào trời (0 = giữ nguyên). */
  skyGrayMix: number;
  rain: boolean;
}

export const WEATHER_MODIFIERS: Readonly<Record<Weather, Readonly<WeatherModifier>>> = {
  sunny: { sunFactor: 1, hemiFactor: 1, shadowFactor: 1, skyGrayMix: 0, rain: false },
  cloudy: { sunFactor: 0.6, hemiFactor: 0.9, shadowFactor: 0.45, skyGrayMix: 0.45, rain: false },
  rainy: { sunFactor: 0.4, hemiFactor: 0.8, shadowFactor: 0.2, skyGrayMix: 0.6, rain: true },
};

const WEATHER_GRAY = '#8e9aa6';

interface ThemePreset {
  skyTint: string;
  tintAmount: number;
  particles: SeasonalParticles;
}

export const THEME_PRESETS: Readonly<Record<SeasonTheme, Readonly<ThemePreset>>> = {
  // Tết: hoa mai vàng + hoa đào hồng bay lả tả.
  tet: {
    skyTint: '#ffd6dc',
    tintAmount: 0.15,
    particles: { kind: 'petals', colors: ['#ffd54f', '#f8bbd0', '#f48fb1'], baseCount: 260, size: 5, speedY: -0.7, sway: 0.6 },
  },
  // Giáng sinh: tuyết rơi.
  christmas: {
    skyTint: '#e3f2fd',
    tintAmount: 0.2,
    particles: { kind: 'snow', colors: ['#ffffff', '#e3f2fd'], baseCount: 420, size: 4, speedY: -1.1, sway: 0.35 },
  },
  // Trung thu: đèn lồng nhỏ bay lên.
  mid_autumn: {
    skyTint: '#ffe0b2',
    tintAmount: 0.14,
    particles: { kind: 'lanterns', colors: ['#ff9800', '#ffb74d', '#ff7043'], baseCount: 90, size: 7, speedY: 0.45, sway: 0.25 },
  },
  // Sinh nhật OCB: giấy màu xanh lá thương hiệu.
  ocb_birthday: {
    skyTint: '#c8f0d8',
    tintAmount: 0.14,
    particles: { kind: 'confetti', colors: ['#009e56', '#ffffff', '#ffd54f'], baseCount: 220, size: 5, speedY: -0.9, sway: 0.8 },
  },
};

function mixHex(a: string, b: string, t: number): string {
  const color = new Color(a);
  if (t > 0) color.lerp(new Color(b), Math.min(1, t));
  return '#' + color.getHexString();
}

/** Ghép buổi + thời tiết + chủ đề thành một bộ hiển thị — hàm thuần. */
export function resolveEnvironmentLook(input: FarmEnvironmentInput): FarmEnvironmentLook {
  const p = PHASE_PRESETS[input.phase];
  const w = WEATHER_MODIFIERS[input.weather];
  const theme = input.theme ? THEME_PRESETS[input.theme] : null;

  let sky = mixHex(p.sky, WEATHER_GRAY, input.phase === 'night' ? w.skyGrayMix * 0.4 : w.skyGrayMix);
  if (theme) sky = mixHex(sky, theme.skyTint, input.phase === 'night' ? theme.tintAmount * 0.4 : theme.tintAmount);

  return {
    sky,
    sunColor: p.sunColor,
    sunIntensity: p.sunIntensity * w.sunFactor,
    sunElevationDeg: p.sunElevationDeg,
    sunAzimuthDeg: p.sunAzimuthDeg,
    hemiSky: mixHex(p.hemiSky, WEATHER_GRAY, w.skyGrayMix * 0.5),
    hemiGround: p.hemiGround,
    hemiIntensity: p.hemiIntensity * w.hemiFactor,
    shadowIntensity: p.shadowIntensity * w.shadowFactor,
    decorLightsOn: input.phase === 'night',
    rain: w.rain,
    seasonal: theme ? theme.particles : null,
  };
}

/** Số hạt thực tế theo mức chất lượng (Thấp: 0). */
export function particleCount(base: number, particles: { enabled: boolean; density: number; maxCount: number }): number {
  if (!particles.enabled || base <= 0) return 0;
  return Math.max(0, Math.min(particles.maxCount, Math.round(base * particles.density)));
}
