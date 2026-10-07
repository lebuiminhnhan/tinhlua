import { Injectable, computed, inject, signal } from '@angular/core';
import { FARM_QUALITIES, FarmQuality } from '../models/ocb-farm.model';
import { FarmApiService } from './farm-api.service';
import { FarmSettingsSyncService } from './farm-settings-sync.service';

/**
 * OCB Farm — mức chất lượng đồ hoạ (US-36, US-38, RB-1).
 *
 * - Tự dò khả năng thiết bị → Thấp / Vừa / Cao kèm lý do; không xác định được → Thấp.
 *   Điện thoại luôn tự chọn Thấp (US-38).
 * - Lựa chọn thủ công ghi đè tự dò và được lưu theo nhân viên
 *   (`settings.quality` + `settings.quality_manual` qua `UPDATE_SETTINGS`).
 * - `tier` / `renderParams` là signal: khung 3D chỉ cần phản ứng và cập nhật renderer tại
 *   chỗ — không dựng lại cảnh, không đụng tới `FarmStateStore` hay đồng hồ đếm ngược.
 * - Theo dõi fps (`fps_floor`, `fps_low_window`) để gợi ý hạ một mức, có lựa chọn bỏ qua;
 *   bỏ qua đủ `fps_suggest_dismiss_max` lần thì ẩn gợi ý trong `fps_suggest_snooze_minutes`.
 */

// ---------------------------------------------------------------------------
// Tham số render theo mức — FarmSceneService đọc để cấu hình three.js
// ---------------------------------------------------------------------------

export type FarmShadowMode = 'none' | 'pcf' | 'pcf-soft';

export interface FarmRenderParams {
  tier: FarmQuality;
  shadows: {
    enabled: boolean;
    /** Ánh xạ sang `BasicShadowMap`/`PCFShadowMap`/`PCFSoftShadowMap`. */
    mode: FarmShadowMode;
    /** Cạnh shadow map (px) của `DirectionalLight`. */
    mapSize: number;
  };
  particles: {
    enabled: boolean;
    /** Hệ số mật độ 0..1 nhân với số hạt gốc (mưa, tuyết, hoa rơi). */
    density: number;
    maxCount: number;
  };
  /** Trần `devicePixelRatio` cho `renderer.setPixelRatio(min(dpr, cap))`. */
  maxPixelRatio: number;
  /** Bộ GLB theo mức (`FarmAssetFileSet[tier]`). */
  lod: FarmQuality;
  antialias: boolean;
  /** Bật `PointLight` của đèn trang trí vào buổi đêm. */
  decorPointLights: boolean;
  maxDecorPointLights: number;
}

export const FARM_RENDER_PARAMS: Readonly<Record<FarmQuality, Readonly<FarmRenderParams>>> = {
  low: {
    tier: 'low',
    shadows: { enabled: false, mode: 'none', mapSize: 0 },
    particles: { enabled: false, density: 0, maxCount: 0 },
    maxPixelRatio: 1,
    lod: 'low',
    antialias: false,
    decorPointLights: false,
    maxDecorPointLights: 0,
  },
  medium: {
    tier: 'medium',
    shadows: { enabled: true, mode: 'pcf', mapSize: 1024 },
    particles: { enabled: true, density: 0.4, maxCount: 400 },
    maxPixelRatio: 1.5,
    lod: 'medium',
    antialias: true,
    decorPointLights: true,
    maxDecorPointLights: 4,
  },
  high: {
    tier: 'high',
    shadows: { enabled: true, mode: 'pcf-soft', mapSize: 2048 },
    particles: { enabled: true, density: 1, maxCount: 1500 },
    maxPixelRatio: 2,
    lod: 'high',
    antialias: true,
    decorPointLights: true,
    maxDecorPointLights: 8,
  },
};

export const FARM_QUALITY_LABELS: Readonly<Record<FarmQuality, string>> = {
  low: 'Thấp',
  medium: 'Vừa',
  high: 'Cao',
};

// ---------------------------------------------------------------------------
// Tự dò thiết bị
// ---------------------------------------------------------------------------

export type FarmGpuClass = 'software' | 'integrated' | 'discrete' | 'unknown';

/** Dữ kiện thô về thiết bị — tách riêng để `classifyDevice` là hàm thuần, dễ test. */
export interface FarmDeviceProbe {
  /** `false` khi không có `window`/`navigator` hoặc dò lỗi (không xác định được). */
  available: boolean;
  webgl: 'webgl2' | 'webgl' | 'none';
  gpuRenderer: string | null;
  maxTextureSize: number | null;
  cores: number | null;
  memoryGb: number | null;
  mobile: boolean;
}

export interface FarmQualityDetection {
  tier: FarmQuality;
  reason: string;
  /** `false` khi không xác định được khả năng thiết bị. */
  determined: boolean;
}

const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;
const DISCRETE_GPU = /nvidia|geforce|quadro|rtx|gtx|radeon\s*(rx|pro|r9|vega)|apple\s*m\d/i;
const INTEGRATED_GPU = /intel|uhd|iris|hd graphics|radeon(\(tm\))?\s*graphics|vega\s*\d+\s*graphics|mali|adreno|powervr|apple gpu/i;

export function classifyGpu(renderer: string | null): FarmGpuClass {
  if (!renderer) return 'unknown';
  if (SOFTWARE_GPU.test(renderer)) return 'software';
  if (DISCRETE_GPU.test(renderer)) return 'discrete';
  if (INTEGRATED_GPU.test(renderer)) return 'integrated';
  return 'unknown';
}

/** Quy tắc chọn mức từ dữ kiện thiết bị — hàm thuần. */
export function classifyDevice(probe: FarmDeviceProbe): FarmQualityDetection {
  const undetermined: FarmQualityDetection = {
    tier: 'low',
    reason: 'Không xác định được khả năng thiết bị nên dùng mức Thấp.',
    determined: false,
  };
  if (!probe.available) return undetermined;
  if (probe.webgl === 'none') {
    return {
      tier: 'low',
      reason: 'Trình duyệt không hỗ trợ đồ hoạ 3D tăng tốc (WebGL) nên dùng mức Thấp.',
      determined: true,
    };
  }
  if (probe.mobile) {
    return { tier: 'low', reason: 'Thiết bị di động nên dùng mức Thấp để ưu tiên độ mượt.', determined: true };
  }

  const gpu = classifyGpu(probe.gpuRenderer);
  if (gpu === 'software') {
    return {
      tier: 'low',
      reason: 'Đồ hoạ đang chạy bằng phần mềm (không có card đồ hoạ) nên dùng mức Thấp.',
      determined: true,
    };
  }
  if (gpu === 'unknown' && probe.cores === null && probe.memoryGb === null) return undetermined;

  const cores = probe.cores ?? 0;
  const memOk = (min: number): boolean => probe.memoryGb === null || probe.memoryGb >= min;
  const texture = probe.maxTextureSize ?? 0;

  if (gpu === 'discrete' && cores >= 6 && memOk(8) && texture >= 8192) {
    return { tier: 'high', reason: 'Thiết bị có card đồ hoạ rời và cấu hình mạnh nên dùng mức Cao.', determined: true };
  }
  if (gpu !== 'unknown' && cores >= 4 && memOk(4) && texture >= 4096) {
    return { tier: 'medium', reason: 'Thiết bị có cấu hình phổ thông nên dùng mức Vừa.', determined: true };
  }
  if (gpu === 'unknown' && cores >= 8 && memOk(8)) {
    return {
      tier: 'medium',
      reason: 'Không nhận diện được card đồ hoạ nhưng bộ xử lý đủ mạnh nên dùng mức Vừa.',
      determined: true,
    };
  }
  return { tier: 'low', reason: 'Cấu hình thiết bị hạn chế nên dùng mức Thấp để ưu tiên độ mượt.', determined: true };
}

interface NavigatorWithHints extends Navigator {
  deviceMemory?: number;
  userAgentData?: { mobile?: boolean };
}

/** Thu thập dữ kiện thiết bị trên trình duyệt; mọi lỗi đều trả về "không xác định". */
export function probeDevice(): FarmDeviceProbe {
  const empty: FarmDeviceProbe = {
    available: false,
    webgl: 'none',
    gpuRenderer: null,
    maxTextureSize: null,
    cores: null,
    memoryGb: null,
    mobile: false,
  };
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof navigator === 'undefined') {
    return empty;
  }
  try {
    const nav = navigator as NavigatorWithHints;
    const cores = typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0 ? nav.hardwareConcurrency : null;
    const memoryGb = typeof nav.deviceMemory === 'number' && nav.deviceMemory > 0 ? nav.deviceMemory : null;
    const mobile =
      nav.userAgentData?.mobile === true ||
      /Android|iPhone|iPod|Mobile|Windows Phone/i.test(nav.userAgent) ||
      // iPadOS báo là Mac nhưng có cảm ứng.
      (/Macintosh/i.test(nav.userAgent) && nav.maxTouchPoints > 1) ||
      (window.matchMedia?.('(pointer: coarse)').matches === true && Math.min(window.screen.width, window.screen.height) < 600);

    const canvas = document.createElement('canvas');
    let gl: WebGLRenderingContext | WebGL2RenderingContext | null = canvas.getContext('webgl2');
    let webgl: FarmDeviceProbe['webgl'] = gl ? 'webgl2' : 'none';
    if (!gl) {
      gl = canvas.getContext('webgl');
      if (gl) webgl = 'webgl';
    }

    let gpuRenderer: string | null = null;
    let maxTextureSize: number | null = null;
    if (gl) {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const raw: unknown = gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
      gpuRenderer = typeof raw === 'string' && raw.length > 0 ? raw : null;
      const tex: unknown = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      maxTextureSize = typeof tex === 'number' ? tex : null;
      // Trả context ngay để không chiếm giới hạn số context WebGL của trình duyệt.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }

    return { available: true, webgl, gpuRenderer, maxTextureSize, cores, memoryGb, mobile };
  } catch {
    return empty;
  }
}

// ---------------------------------------------------------------------------
// Theo dõi fps
// ---------------------------------------------------------------------------

/** Khoá `farm_config` và giá trị mặc định (design: 25 fps / 30 giây). */
export const FARM_QUALITY_CONFIG_DEFAULTS = {
  fps_floor: 25,
  fps_low_window: 30,
  /** Số lần bỏ qua gợi ý trước khi tạm ẩn (US-36 "đủ số lần theo cấu hình"). */
  fps_suggest_dismiss_max: 3,
  fps_suggest_snooze_minutes: 60,
} as const;

export type FarmQualityConfigKey = keyof typeof FARM_QUALITY_CONFIG_DEFAULTS;
export type FarmQualityConfig = Record<FarmQualityConfigKey, number>;

export interface FarmQualitySuggestion {
  from: FarmQuality;
  to: FarmQuality;
  averageFps: number;
  message: string;
}

export type FarmQualitySource = 'auto' | 'manual';

/** Khoảng lấy mẫu fps (ms). */
const FPS_SAMPLE_MS = 1000;
/** Khung hình cách nhau quá lâu (tab ẩn, debugger) → bỏ, không tính là chậm. */
const FRAME_GAP_RESET_MS = 1000;

function lowerTier(tier: FarmQuality): FarmQuality | null {
  const index = FARM_QUALITIES.indexOf(tier);
  return index > 0 ? FARM_QUALITIES[index - 1] : null;
}

/** Khoá localStorage lưu thời điểm hết tạm ẩn gợi ý (theo thiết bị — fps là đặc tính thiết bị). */
const SNOOZE_STORAGE_KEY = 'ocb-farm.quality-suggest-snooze-until';

function readSnooze(): number {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SNOOZE_STORAGE_KEY) : null;
    const value = raw === null ? 0 : Number(raw);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function writeSnooze(until: number): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(SNOOZE_STORAGE_KEY, String(until));
  } catch {
    // Bộ nhớ trình duyệt bị chặn — chỉ tạm ẩn trong phiên.
  }
}

@Injectable({ providedIn: 'root' })
export class QualityService {
  private settingsSync = inject(FarmSettingsSyncService);
  private api = inject(FarmApiService);

  private readonly _detection = signal<FarmQualityDetection>(classifyDevice(probeDevice()));
  private readonly _config = signal<FarmQualityConfig>({ ...FARM_QUALITY_CONFIG_DEFAULTS });
  private readonly _suggestion = signal<FarmQualitySuggestion | null>(null);
  private readonly _measuredFps = signal<number | null>(null);

  /** Kết quả tự dò trên thiết bị hiện tại. */
  readonly detection = this._detection.asReadonly();

  readonly source = computed<FarmQualitySource>(() =>
    this.settingsSync.settings().quality_manual ? 'manual' : 'auto',
  );

  /** Mức đang áp dụng — khung 3D phản ứng theo signal này. */
  readonly tier = computed<FarmQuality>(() => {
    const settings = this.settingsSync.settings();
    return settings.quality_manual ? settings.quality : this._detection().tier;
  });

  readonly tierLabel = computed(() => FARM_QUALITY_LABELS[this.tier()]);

  /** Lý do của mức đang áp dụng, hiển thị cho nhân viên. */
  readonly reason = computed(() =>
    this.source() === 'manual'
      ? `Bạn đã tự chọn mức ${FARM_QUALITY_LABELS[this.tier()]}.`
      : this._detection().reason,
  );

  readonly renderParams = computed<Readonly<FarmRenderParams>>(() => FARM_RENDER_PARAMS[this.tier()]);

  /** Gợi ý hạ mức đang hiển thị (null = không có). */
  readonly suggestion = this._suggestion.asReadonly();
  /** Fps trung bình của giây gần nhất (null khi chưa đo). */
  readonly measuredFps = this._measuredFps.asReadonly();

  // Trạng thái đo fps (không cần reactive).
  private lastFrameAt: number | null = null;
  private sampleStart: number | null = null;
  private sampleFrames = 0;
  private lowSince: number | null = null;
  private lowFpsSum = 0;
  private lowFpsCount = 0;
  private dismissCount = 0;
  private snoozedUntil = readSnooze();

  constructor() {
    // Ngưỡng fps lấy từ cấu hình quản trị; lỗi tải giữ mặc định, không chặn nông trại.
    this.api.getConfig().subscribe({
      next: (res) => this.applyConfig(res.values),
      error: (err: unknown) => console.warn('[ocb-farm] Không tải được cấu hình hiệu năng, dùng mặc định.', err),
    });
  }

  // -------------------------------------------------------------------------
  // Chọn mức
  // -------------------------------------------------------------------------

  /** Nhân viên tự chọn mức — ghi đè tự dò, áp dụng ngay và lưu theo nhân viên. */
  setManualQuality(tier: FarmQuality): void {
    this.settingsSync.update({ quality: tier, quality_manual: true });
    this.afterTierChange();
  }

  /** Quay về tự dò theo thiết bị. */
  useAutoQuality(): void {
    this.settingsSync.update({ quality: this._detection().tier, quality_manual: false });
    this.afterTierChange();
  }

  /** Dò lại thiết bị (ví dụ sau khi mất context WebGL). */
  redetect(): void {
    this._detection.set(classifyDevice(probeDevice()));
  }

  /** Nạp ngưỡng từ `GET /config` (`values`); khoá thiếu/không hợp lệ giữ mặc định. */
  applyConfig(values: Readonly<Record<string, number>>): void {
    const next: FarmQualityConfig = { ...FARM_QUALITY_CONFIG_DEFAULTS };
    for (const key of Object.keys(FARM_QUALITY_CONFIG_DEFAULTS) as FarmQualityConfigKey[]) {
      const value = values[key];
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) next[key] = value;
    }
    this._config.set(next);
  }

  // -------------------------------------------------------------------------
  // Theo dõi fps — FarmSceneService gọi `recordFrame` mỗi khung hình
  // -------------------------------------------------------------------------

  /** Ghi nhận một khung hình (`now` = `performance.now()` hoặc timestamp của rAF). */
  recordFrame(now: number): void {
    if (this.lastFrameAt !== null && now - this.lastFrameAt > FRAME_GAP_RESET_MS) {
      this.resetFpsTracking();
    }
    this.lastFrameAt = now;

    if (this.sampleStart === null) {
      this.sampleStart = now;
      this.sampleFrames = 0;
      return;
    }
    this.sampleFrames++;
    const elapsed = now - this.sampleStart;
    if (elapsed < FPS_SAMPLE_MS) return;

    const fps = (this.sampleFrames * 1000) / elapsed;
    this.sampleStart = now;
    this.sampleFrames = 0;
    this._measuredFps.set(Math.round(fps));
    this.evaluateSample(fps, now);
  }

  /** Dừng đo (khung 3D bị huỷ / tạm dừng). */
  resetFpsTracking(): void {
    this.lastFrameAt = null;
    this.sampleStart = null;
    this.sampleFrames = 0;
    this.lowSince = null;
    this.lowFpsSum = 0;
    this.lowFpsCount = 0;
  }

  /** Đồng ý gợi ý: hạ một mức (tính là lựa chọn thủ công). */
  acceptSuggestion(): void {
    const suggestion = this._suggestion();
    if (!suggestion) return;
    this._suggestion.set(null);
    this.setManualQuality(suggestion.to);
  }

  /** Bỏ qua gợi ý; bỏ qua đủ số lần thì tạm ẩn gợi ý theo cấu hình. */
  dismissSuggestion(now: number = Date.now()): void {
    if (!this._suggestion()) return;
    this._suggestion.set(null);
    this.resetFpsTracking();
    this.dismissCount++;
    const config = this._config();
    if (this.dismissCount >= config.fps_suggest_dismiss_max) {
      this.dismissCount = 0;
      this.snoozedUntil = now + config.fps_suggest_snooze_minutes * 60_000;
      writeSnooze(this.snoozedUntil);
    }
  }

  private evaluateSample(fps: number, frameNow: number): void {
    const config = this._config();
    if (fps >= config.fps_floor) {
      this.lowSince = null;
      this.lowFpsSum = 0;
      this.lowFpsCount = 0;
      return;
    }
    if (this.lowSince === null) this.lowSince = frameNow;
    this.lowFpsSum += fps;
    this.lowFpsCount++;

    const lowForMs = frameNow - this.lowSince;
    if (lowForMs < config.fps_low_window * 1000) return;
    if (this._suggestion() || Date.now() < this.snoozedUntil) return;

    const from = this.tier();
    const to = lowerTier(from);
    if (!to) return;
    const averageFps = Math.round(this.lowFpsSum / Math.max(1, this.lowFpsCount));
    this._suggestion.set({
      from,
      to,
      averageFps,
      message:
        `Nông trại đang chạy chậm (khoảng ${averageFps} khung hình/giây). ` +
        `Bạn có muốn hạ chất lượng đồ hoạ từ ${FARM_QUALITY_LABELS[from]} xuống ${FARM_QUALITY_LABELS[to]}?`,
    });
  }

  private afterTierChange(): void {
    this._suggestion.set(null);
    // Mức mới cần được đo lại từ đầu.
    this.resetFpsTracking();
  }
}
