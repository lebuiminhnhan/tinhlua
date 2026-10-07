/**
 * OCB Farm — các hàm thuần xác định buổi trong ngày, thời tiết và chủ đề
 * mùa lễ tại một thời điểm cho trước.
 *
 * Toàn bộ hàm trong module này là hàm thuần của thời gian (và một `seed` cố
 * định cho thời tiết): không truy cập DB, không có side effect, cùng đầu vào
 * luôn cho cùng đầu ra. Đây là điều kiện để BR-30 đúng — mọi nông trại nhìn
 * thấy đúng một trạng thái thời tiết tại cùng một thời điểm, bất kể tick của
 * riêng nông trại đó chạy lúc nào — vì trạng thái không được lưu, mà được
 * suy ra lại từ thời gian hiện tại mỗi lần cần.
 *
 * _Requirements: US-30, US-31, US-33, BR-30_
 */

import type { DayPhase, SeasonTheme, Weather } from '../../types/ocb-farm.types';
import { WEATHER_STATES } from '../../types/ocb-farm.types';

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;

// ============================================================================
// 1. Buổi trong ngày (US-30, US-33)
// ============================================================================

/**
 * Giờ bắt đầu (giờ Việt Nam, 0..23) của từng buổi — khớp khóa cấu hình
 * `day_phase_morning_start` / `..._noon_start` / `..._afternoon_start` /
 * `..._night_start` ở `20261001_010_seed_farm_config.sql`.
 *
 * 4 buổi phủ kín 24 giờ, không chồng lấn: một giờ bất kỳ luôn rơi vào đúng
 * một buổi. Buổi đêm bọc qua nửa đêm (ví dụ 18h hôm nay → 05h hôm sau).
 */
export interface DayPhaseConfig {
  /** Giờ bắt đầu buổi sáng — mặc định 5 (05:00 UTC+7). */
  morningStart: number;
  /** Giờ bắt đầu buổi trưa — mặc định 11 (11:00 UTC+7). */
  noonStart: number;
  /** Giờ bắt đầu buổi chiều — mặc định 14 (14:00 UTC+7). */
  afternoonStart: number;
  /** Giờ bắt đầu buổi đêm — mặc định 18 (18:00 UTC+7), kéo tới giờ bắt đầu buổi sáng. */
  nightStart: number;
}

/** Cấu hình buổi mặc định — trùng giá trị khởi điểm trong seed cấu hình game. */
export const DEFAULT_DAY_PHASE_CONFIG: DayPhaseConfig = {
  morningStart: 5,
  noonStart: 11,
  afternoonStart: 14,
  nightStart: 18,
};

/**
 * Trả về buổi trong ngày (sáng/trưa/chiều/đêm) mà thời điểm `ts` rơi vào,
 * theo giờ Việt Nam (UTC+7).
 *
 * Ranh giới thuộc về buổi *bắt đầu* tại giờ đó — ví dụ đúng 11:00:00.000
 * UTC+7 đã thuộc buổi trưa, không còn thuộc buổi sáng. Với cấu hình mặc
 * định, 4 buổi phủ kín đúng 24 giờ và không chồng lấn nhau: sáng 05–11,
 * trưa 11–14, chiều 14–18, đêm 18–05 (bọc qua nửa đêm).
 *
 * _Requirements: US-30, US-33_
 */
export function dayPhaseAt(ts: Date, config: DayPhaseConfig = DEFAULT_DAY_PHASE_CONFIG): DayPhase {
  const hourVN = getHourVN(ts);
  const { morningStart, noonStart, afternoonStart, nightStart } = config;

  if (isHourInRange(hourVN, morningStart, noonStart)) return 'morning';
  if (isHourInRange(hourVN, noonStart, afternoonStart)) return 'noon';
  if (isHourInRange(hourVN, afternoonStart, nightStart)) return 'afternoon';
  // Buổi đêm là phần còn lại của 24h — bọc qua nửa đêm (ví dụ 18h → 05h hôm sau).
  return 'night';
}

/** Giờ trong ngày theo giờ Việt Nam (0..23), không lệ thuộc múi giờ hệ thống. */
function getHourVN(ts: Date): number {
  const shifted = new Date(ts.getTime() + VN_OFFSET_MS);
  return shifted.getUTCHours();
}

/**
 * `true` khi `hour` thuộc [start, end) trên vòng tròn 24 giờ — hỗ trợ
 * khoảng bọc qua nửa đêm khi `start > end` (ví dụ [18, 5) nghĩa là
 * 18,19,...,23,0,1,...,4).
 */
function isHourInRange(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

// ============================================================================
// 2. Thời tiết (US-30, US-31, BR-30)
// ============================================================================

/** Cấu hình chu kỳ thời tiết. */
export interface WeatherConfig {
  /** Độ dài một chu kỳ thời tiết, tính bằng phút — khớp khóa cấu hình `weather_cycle`. */
  cycleMinutes: number;
}

/** Cấu hình thời tiết mặc định — trùng giá trị khởi điểm `weather_cycle = 60` phút. */
export const DEFAULT_WEATHER_CONFIG: WeatherConfig = {
  cycleMinutes: 60,
};

/**
 * Trả về thời tiết tại thời điểm `ts`, là hàm thuần của thời gian và `seed`.
 *
 * Thời gian được lượng tử hoá theo chu kỳ `config.cycleMinutes`: mọi thời
 * điểm trong cùng một chu kỳ trả về cùng một thời tiết. Với cùng `seed`,
 * hai lệnh gọi ở hai tiến trình server khác nhau nhưng cùng thời điểm luôn
 * cho cùng kết quả — đây là điều BR-30 yêu cầu ("mọi nông trại thấy thời
 * tiết giống nhau tại cùng một thời điểm"). Đổi `seed` (ví dụ theo môi
 * trường dev/prod) sẽ đổi toàn bộ lịch thời tiết mà không cần đổi code.
 *
 * Phân bố: xấp xỉ 45% nắng, 35% nhiều mây, 20% mưa (không phải phân bố đều
 * 3 trạng thái, để nắng là trạng thái phổ biến nhất và mưa hiếm hơn).
 *
 * _Requirements: US-30, US-31, BR-30_
 */
export function weatherAt(
  ts: Date,
  seed: number,
  config: WeatherConfig = DEFAULT_WEATHER_CONFIG
): Weather {
  const cycleIndex = weatherCycleIndex(ts, config);
  const bucket = hashToUnitInterval(cycleIndex, seed);
  return weatherFromBucket(bucket);
}

/** Chỉ số chu kỳ thời tiết (số nguyên) chứa thời điểm `ts`. */
function weatherCycleIndex(ts: Date, config: WeatherConfig): number {
  const cycleMs = Math.max(1, config.cycleMinutes) * MS_PER_MINUTE;
  return Math.floor(ts.getTime() / cycleMs);
}

/** Mốc bắt đầu (ISO) của chu kỳ thời tiết chứa thời điểm `ts`. */
function weatherCycleStart(ts: Date, config: WeatherConfig): Date {
  const cycleMs = Math.max(1, config.cycleMinutes) * MS_PER_MINUTE;
  const index = weatherCycleIndex(ts, config);
  return new Date(index * cycleMs);
}

/** Mốc kết thúc (loại trừ, ISO) của chu kỳ thời tiết chứa thời điểm `ts`. */
function weatherCycleEnd(ts: Date, config: WeatherConfig): Date {
  const cycleMs = Math.max(1, config.cycleMinutes) * MS_PER_MINUTE;
  return new Date(weatherCycleStart(ts, config).getTime() + cycleMs);
}

/**
 * Băm `(index, seed)` thành một số thực xác định trong [0, 1).
 *
 * Dùng một hàm băm số nguyên đơn giản (biến thể của "mulberry32"/xorshift)
 * thay vì `Math.random()` để bảo đảm tính thuần: không có trạng thái toàn
 * cục, không phụ thuộc thời điểm gọi, cùng đầu vào luôn ra cùng đầu ra.
 */
function hashToUnitInterval(index: number, seed: number): number {
  let h = (index ^ seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 0x100000000;
}

/** Ánh xạ một số trong [0, 1) sang thời tiết theo phân bố 45/35/20. */
function weatherFromBucket(bucket: number): Weather {
  if (bucket < 0.45) return WEATHER_STATES[0]; // sunny
  if (bucket < 0.8) return WEATHER_STATES[1]; // cloudy
  return WEATHER_STATES[2]; // rainy
}

/** Một khoảng thời gian [start, end) mà thời tiết là mưa. */
export interface RainWindow {
  start: Date;
  end: Date;
}

/**
 * Trả về danh sách khoảng thời gian trong [`from`, `to`) mà thời tiết là
 * mưa, theo đúng chu kỳ và `seed` mà `weatherAt` dùng.
 *
 * Dùng bởi `farm-simulation.ts` để tự động tưới cây trong các chu kỳ mưa
 * khi mô phỏng tiến trình offline (US-31): cây không cần nhân viên tưới
 * tay nếu khoảng thời gian vắng mặt trùng với lúc mưa.
 *
 * Các khoảng liên tiếp cùng là mưa được gộp lại thành một khoảng duy nhất.
 * Nếu `to <= from`, trả về danh sách rỗng (khoảng thời gian không hợp lệ
 * hoặc bằng 0 thì không có gì để tính).
 *
 * _Requirements: US-31, BR-30_
 */
export function rainWindowsBetween(
  from: Date,
  to: Date,
  seed: number,
  config: WeatherConfig = DEFAULT_WEATHER_CONFIG
): RainWindow[] {
  if (to.getTime() <= from.getTime()) return [];

  const windows: RainWindow[] = [];
  let current: RainWindow | null = null;

  let cursor = weatherCycleStart(from, config);
  while (cursor.getTime() < to.getTime()) {
    const cycleEnd = weatherCycleEnd(cursor, config);
    const isRainy = weatherAt(cursor, seed, config) === 'rainy';

    if (isRainy) {
      const windowStart = cursor.getTime() < from.getTime() ? from : cursor;
      const windowEnd = cycleEnd.getTime() > to.getTime() ? to : cycleEnd;

      if (current && current.end.getTime() === windowStart.getTime()) {
        // Chu kỳ mưa liên tiếp với khoảng trước — gộp lại thay vì tạo mới.
        current.end = windowEnd;
      } else {
        current = { start: windowStart, end: windowEnd };
        windows.push(current);
      }
    } else {
      current = null;
    }

    cursor = cycleEnd;
  }

  return windows;
}

// ============================================================================
// 3. Chủ đề mùa lễ (US-33)
// ============================================================================

/**
 * Một dịp lễ/mùa cấu hình được: khoảng ngày lặp lại hằng năm (theo tháng và
 * ngày, không theo năm cụ thể) hoặc khoảng ngày cố định một năm duy nhất.
 *
 * Ngày kết thúc (`endMonth`/`endDay`) là *bao gồm* — dịp lễ vẫn đang hoạt
 * động vào chính ngày kết thúc đó.
 *
 * Khoảng có thể bọc qua năm mới khi `startMonth > endMonth` (ví dụ Tết chạy
 * từ cuối tháng 1 dương lịch sang giữa tháng 2 dương lịch).
 */
export interface SeasonThemeDefinition {
  theme: SeasonTheme;
  /** Tên hiển thị tiếng Việt. */
  name: string;
  /** Ưu tiên — số lớn hơn thắng khi nhiều dịp lễ chồng lấn. Không được trùng giữa hai dịp. */
  priority: number;
  startMonth: number; // 1..12
  startDay: number; // 1..31
  endMonth: number; // 1..12
  endDay: number; // 1..31
}

/**
 * Danh sách dịp lễ/mùa mặc định cho phiên bản đầu (XN-4, `SEASON_THEMES`):
 * Tết Nguyên Đán, Giáng sinh, Trung thu, Sinh nhật OCB.
 *
 * ⚠ Cần xác nhận: ngày dương lịch cụ thể của Tết Nguyên Đán và Trung thu
 * đổi theo năm (âm lịch) — bảng dưới đây dùng khoảng ngày dương lịch xấp xỉ
 * (khung 15 ngày quanh thời điểm thường gặp) làm giá trị khởi điểm; admin
 * chỉnh lại đúng ngày từng năm qua tham số `config` của `seasonThemeAt`
 * (không hardcode phía gọi). Sinh nhật OCB và Giáng sinh có ngày dương lịch
 * cố định nên không cần điều chỉnh hằng năm.
 */
export const DEFAULT_SEASON_THEMES: SeasonThemeDefinition[] = [
  {
    theme: 'tet',
    name: 'Tết Nguyên Đán',
    priority: 30,
    startMonth: 1,
    startDay: 20,
    endMonth: 2,
    endDay: 15,
  },
  {
    theme: 'mid_autumn',
    name: 'Trung Thu',
    priority: 20,
    startMonth: 9,
    startDay: 10,
    endMonth: 9,
    endDay: 20,
  },
  {
    theme: 'ocb_birthday',
    name: 'Sinh nhật OCB',
    priority: 15,
    // Ngày thành lập OCB: 10/06 — khung 1 tuần quanh ngày thành lập.
    startMonth: 6,
    startDay: 7,
    endMonth: 6,
    endDay: 13,
  },
  {
    theme: 'christmas',
    name: 'Giáng Sinh',
    priority: 10,
    startMonth: 12,
    startDay: 20,
    endMonth: 12,
    endDay: 26,
  },
];

/**
 * Trả về dịp lễ/mùa đang hoạt động tại `date`, chọn dịp có `priority` cao
 * nhất nếu nhiều dịp chồng lấn nhau. Trả `null` khi không có dịp nào đang
 * hoạt động (chủ đề mặc định).
 *
 * Ngày và tháng được đọc theo giờ Việt Nam (UTC+7) — dùng cùng quy ước với
 * các mốc nghiệp vụ khác của OCB Farm.
 *
 * _Requirements: US-33_
 */
export function seasonThemeAt(
  date: Date,
  config: SeasonThemeDefinition[] = DEFAULT_SEASON_THEMES
): SeasonThemeDefinition | null {
  const { month, day } = getMonthDayVN(date);

  const active = config.filter((def) => isMonthDayInSeasonRange(month, day, def));
  if (active.length === 0) return null;

  return active.reduce((best, current) => (current.priority > best.priority ? current : best));
}

/** Tháng (1..12) và ngày (1..31) theo giờ Việt Nam, không lệ thuộc múi giờ hệ thống. */
function getMonthDayVN(date: Date): { month: number; day: number } {
  const shifted = new Date(date.getTime() + VN_OFFSET_MS);
  return { month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/**
 * `true` khi (month, day) rơi vào khoảng [start, end] (bao gồm hai đầu) của
 * một định nghĩa dịp lễ, so sánh theo thứ tự (tháng, ngày) trong năm.
 * Hỗ trợ khoảng bọc qua năm mới khi điểm bắt đầu "lớn hơn" điểm kết thúc.
 */
function isMonthDayInSeasonRange(month: number, day: number, def: SeasonThemeDefinition): boolean {
  const target = month * 100 + day;
  const start = def.startMonth * 100 + def.startDay;
  const end = def.endMonth * 100 + def.endDay;

  if (start <= end) return target >= start && target <= end;
  // Khoảng bọc qua năm mới, ví dụ Tết chạy từ tháng 1 sang tháng 2 dương lịch
  // nhưng có thể được cấu hình bọc từ cuối tháng 12 sang đầu tháng 1.
  return target >= start || target <= end;
}
