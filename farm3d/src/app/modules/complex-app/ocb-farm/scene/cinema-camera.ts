/**
 * OCB Farm — hàm thuần cho Cinema_Camera_Controller: tính biên camera cho Cinema_Mode,
 * sinh đoạn chuyển động (segment) kế tiếp, và nội suy vị trí camera tại một thời điểm.
 * Không phụ thuộc Angular, three.js, hay DOM/window nên test được trực tiếp.
 *
 * Quy ước toạ độ: giống `farm-scene-math.ts` — ô `"hàng,cột"` → `x = cột × CELL_SIZE`,
 * `z = hàng × CELL_SIZE`. Góc phương vị (azimuth) ở đây là **liên tục** trong
 * `[0, 2π)`, khác với `lerpAngle`/4-góc-90° dùng cho xoay camera thủ công — vì vậy
 * module này KHÔNG dùng `lerpAngle` (tránh logic quay đường ngắn nhất kiểu "quarter
 * turn") mà nội suy tuyến tính thẳng từ `fromAzimuth` tới `toAzimuth` (giá trị đích
 * đã được chọn trực tiếp trong `[0, 2π)`, không cần chọn hướng quay ngắn nhất).
 *
 * Nội suy thời gian dùng **hiệu số timestamp thực** (`nowMs - startedAtMs`), không
 * cộng dồn theo số khung hình — nhờ vậy khi tab bị trình duyệt tiết giảm tần số khung
 * hình (background throttling) rồi focus lại, `t` tự động vượt 1 ngay lập tức thay vì
 * "nhảy cóc" nội suy sai.
 *
 * _Requirements: 2.2, 2.3, 2.4, 2.9_
 */
import type { FarmPlot } from '../models/ocb-farm.model';
import { CELL_SIZE, parseCell } from './farm-scene-math';

/** Biên lưới (hàng/cột) dùng để sinh target ngẫu nhiên cho Cinema_Mode. */
export interface CinemaBounds {
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
}

/** Một đoạn chuyển động camera — nội suy từ `from*` sang `to*` trong `durationMs`. */
export interface CinemaSegment {
  fromX: number;
  fromZ: number;
  fromZoom: number;
  fromAzimuth: number;
  toX: number;
  toZ: number;
  toZoom: number;
  toAzimuth: number;
  durationMs: number;
}

/** Trạng thái Cinema_Camera_Controller — segment hiện tại + mốc thời gian thực bắt đầu. */
export interface CinemaState {
  segment: CinemaSegment;
  /** Thời điểm thực (performance.now() / Date.now()) khi segment hiện tại bắt đầu. */
  startedAtMs: number;
}

/** Số lần tối đa thử sinh lại target khi trùng y nguyên segment trước (AC 2.3). */
const MAX_RETRY = 10;

/**
 * Thời gian một đoạn chuyển động cinema, chọn ngẫu nhiên trong khoảng 8–16 giây.
 * Khoảng này đủ chậm để tạo cảm giác "quay phim" chill (không gây chóng mặt như
 * chuyển cảnh nhanh), nhưng vẫn đủ ngắn để nhân viên thấy nhiều góc nông trại trong
 * một lượt xem Cinema_Mode ngắn.
 */
const MIN_SEGMENT_DURATION_MS = 8000;
const MAX_SEGMENT_DURATION_MS = 16000;

/** Biên lưới chỉ tính từ các ô thuộc vùng đã mở khóa (`plot.unlocked === true`). */
export function cinemaBoundsFromPlots(plots: readonly FarmPlot[]): CinemaBounds | null {
  let bounds: CinemaBounds | null = null;
  for (const plot of plots) {
    if (!plot.unlocked) continue;
    for (const ref of plot.cells) {
      const c = parseCell(ref);
      if (!c) continue;
      if (!bounds) {
        bounds = { minCol: c.col, maxCol: c.col, minRow: c.row, maxRow: c.row };
      } else {
        bounds.minCol = Math.min(bounds.minCol, c.col);
        bounds.maxCol = Math.max(bounds.maxCol, c.col);
        bounds.minRow = Math.min(bounds.minRow, c.row);
        bounds.maxRow = Math.max(bounds.maxRow, c.row);
      }
    }
  }
  return bounds;
}

function randomInRange(min: number, max: number, rand: () => number): number {
  if (max <= min) return min;
  return min + rand() * (max - min);
}

/** Sinh một ứng viên target (x, z, zoom, azimuth) ngẫu nhiên trong biên hợp lệ. */
function randomTarget(
  bounds: CinemaBounds,
  minZoom: number,
  maxZoom: number,
  rand: () => number,
): { x: number; z: number; zoom: number; azimuth: number } {
  const xMin = bounds.minCol * CELL_SIZE;
  const xMax = bounds.maxCol * CELL_SIZE;
  const zMin = bounds.minRow * CELL_SIZE;
  const zMax = bounds.maxRow * CELL_SIZE;
  return {
    x: randomInRange(xMin, xMax, rand),
    z: randomInRange(zMin, zMax, rand),
    zoom: randomInRange(minZoom, maxZoom, rand),
    azimuth: randomInRange(0, Math.PI * 2, rand),
  };
}

function sameTarget(
  a: { x: number; z: number; zoom: number; azimuth: number },
  b: { x: number; z: number; zoom: number; azimuth: number },
): boolean {
  return a.x === b.x && a.z === b.z && a.zoom === b.zoom && a.azimuth === b.azimuth;
}

/**
 * Sinh segment kế tiếp cho Cinema_Mode — target/zoom ngẫu nhiên trong biên hợp lệ,
 * azimuth ngẫu nhiên liên tục `[0, 2π)`. `from*` lấy từ `to*` của `previous` (vị trí
 * camera hiện tại khi bắt đầu segment mới); nếu không có `previous` (segment đầu
 * tiên của lượt Cinema_Mode), dùng tâm biên, zoom giữa `minZoom`/`maxZoom`, và
 * azimuth 0 làm điểm xuất phát mặc định.
 *
 * Retry tối đa `MAX_RETRY` lần nếu target ngẫu nhiên trùng y nguyên `previous.to*`
 * (AC 2.3) — hết số lần thử vẫn trùng thì chấp nhận kết quả cuối cùng.
 */
export function nextCinemaSegment(
  bounds: CinemaBounds,
  minZoom: number,
  maxZoom: number,
  previous: CinemaSegment | null,
  nowMs: number,
  rand: () => number = Math.random,
): CinemaSegment {
  const from = previous
    ? { x: previous.toX, z: previous.toZ, zoom: previous.toZoom, azimuth: previous.toAzimuth }
    : {
        x: ((bounds.minCol + bounds.maxCol) / 2) * CELL_SIZE,
        z: ((bounds.minRow + bounds.maxRow) / 2) * CELL_SIZE,
        zoom: (minZoom + maxZoom) / 2,
        azimuth: 0,
      };

  let target = randomTarget(bounds, minZoom, maxZoom, rand);
  if (previous) {
    let attempts = 0;
    while (sameTarget(target, from) && attempts < MAX_RETRY) {
      target = randomTarget(bounds, minZoom, maxZoom, rand);
      attempts += 1;
    }
  }

  return {
    fromX: from.x,
    fromZ: from.z,
    fromZoom: from.zoom,
    fromAzimuth: from.azimuth,
    toX: target.x,
    toZ: target.z,
    toZoom: target.zoom,
    toAzimuth: target.azimuth,
    durationMs: randomInRange(MIN_SEGMENT_DURATION_MS, MAX_SEGMENT_DURATION_MS, rand),
  };
}

/** Ease-out cubic — cùng công thức đã dùng cho xoay camera thủ công ở `farm-scene.service.ts`. */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/**
 * Vị trí camera nội suy tại `nowMs` — thuần hàm của `(state, nowMs)`, không có state
 * nội bộ tích lũy. `t` tính từ hiệu số timestamp thực `(nowMs - startedAtMs) /
 * durationMs`, clamp về tối đa 1 TRƯỚC khi áp easing (không cộng dồn theo số khung
 * hình). `finished` báo `true` khi giá trị `t` thô (trước khi clamp) đã `>= 1`, để
 * phía gọi biết cần sinh segment kế tiếp.
 *
 * Azimuth nội suy tuyến tính thẳng (không dùng `lerpAngle`) vì giá trị đích đã được
 * chọn trực tiếp trong `[0, 2π)` — không cần/không nên chọn hướng quay ngắn nhất như
 * khi xoay camera theo 4 góc 90°.
 */
export function cinemaCameraAt(
  state: CinemaState,
  nowMs: number,
): { x: number; z: number; zoom: number; azimuth: number; finished: boolean } {
  const { segment, startedAtMs } = state;
  const rawT = segment.durationMs > 0 ? (nowMs - startedAtMs) / segment.durationMs : 1;
  const clampedT = Math.min(1, Math.max(0, rawT));
  const eased = easeOutCubic(clampedT);
  return {
    x: lerp(segment.fromX, segment.toX, eased),
    z: lerp(segment.fromZ, segment.toZ, eased),
    zoom: lerp(segment.fromZoom, segment.toZoom, eased),
    azimuth: lerp(segment.fromAzimuth, segment.toAzimuth, eased),
    finished: rawT >= 1,
  };
}
