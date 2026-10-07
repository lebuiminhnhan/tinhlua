/**
 * OCB Farm — các hàm thuần tính chuỗi check-in liên tiếp và phần thưởng mốc
 * chuỗi (US-25, BR-13, BR-14).
 *
 * Không đọc/ghi DB, không có side effect nào khác — `farm-command.service`
 * (lệnh `CLAIM_CHECKIN`, task 5.6) gọi các hàm này trong transaction rồi tự
 * ghi `farm_states.checkin_streak` / `farm_states.last_checkin_date` và
 * `farm_checkins` (idempotent bằng `UNIQUE(user_id, checkin_date)`).
 *
 * Toàn bộ ngày dùng chuỗi `YYYY-MM-DD` theo giờ Việt Nam (UTC+7), khớp quy
 * ước của `ocb-farm.types.ts` — ranh giới ngày do caller tính sẵn qua
 * `farm-calendar.ts` (`startOfDayVN`) trước khi gọi vào đây.
 *
 * _Requirements: US-25, BR-13, BR-14_
 */

/** Số ngày mỗi mốc thưởng cơ bản (3/7/14/30) — khớp `streak_bonus_3/7/14/30`. */
const BASE_MILESTONE_DAYS = [3, 7, 14, 30] as const;

/** Mốc cao nhất trong danh sách mốc cơ bản — mốc lặp lại theo bội số của giá trị này. */
const REPEATING_MILESTONE_DAYS = 30;

/**
 * Tính chuỗi check-in mới sau khi nhân viên check-in vào ngày `today`.
 *
 * Quy tắc (BR-14):
 * - Đây là lần check-in đầu tiên (`lastCheckinDate` là `null`) → chuỗi = 1.
 * - `lastCheckinDate` đúng là ngày liền trước `today` → chuỗi = `currentStreak + 1`.
 * - `lastCheckinDate` cách `today` từ 2 ngày trở lên (bỏ ít nhất một ngày),
 *   hoặc `lastCheckinDate` không sớm hơn `today` (dữ liệu bất thường, ví dụ
 *   check-in lần hai trong cùng ngày hoặc đồng hồ lệch) → chuỗi đặt lại về 1.
 *
 * `lastCheckinDate` và `today` là chuỗi `YYYY-MM-DD` theo giờ Việt Nam —
 * hàm không tự suy ra "hôm nay", caller (endpoint `CLAIM_CHECKIN`) phải
 * truyền đúng ranh giới ngày UTC+7 đã tính sẵn.
 *
 * _Requirements: US-25, BR-14_
 */
export function nextStreak(
  lastCheckinDate: string | null,
  today: string,
  currentStreak: number
): number {
  if (lastCheckinDate === null) {
    return 1;
  }

  const dayGap = diffInCalendarDays(lastCheckinDate, today);
  const isConsecutive = dayGap === 1;

  return isConsecutive ? currentStreak + 1 : 1;
}

/**
 * Phần thưởng Hạt OCB một lần khi chuỗi check-in vừa đạt đúng một mốc
 * (US-25, BR-13): mốc cơ bản 3/7/14/30 ngày, và mỗi bội số của 30 ngày sau
 * đó (60, 90, 120, ...) lặp lại đúng phần thưởng của mốc 30.
 *
 * Trả về 0 khi `streak` không trùng chính xác một mốc — thưởng mốc là
 * thưởng một lần tại đúng ngày đạt mốc, cộng thêm vào thưởng check-in hằng
 * ngày (`checkin_reward`), không phải thưởng lặp lại ở mọi ngày sau mốc.
 *
 * `config` tra theo khóa `streak_bonus_3` / `streak_bonus_7` /
 * `streak_bonus_14` / `streak_bonus_30`, khớp
 * `20261001_010_seed_farm_config.sql`. Khóa vắng mặt trong `config` được
 * coi là 0 (không thưởng) thay vì gây lỗi.
 *
 * _Requirements: US-25, BR-13_
 */
export function milestoneReward(streak: number, config: Record<string, number>): number {
  if (!Number.isInteger(streak) || streak <= 0) {
    return 0;
  }

  const isBaseMilestone = (BASE_MILESTONE_DAYS as readonly number[]).includes(streak);
  const isRepeatingMilestone =
    streak > REPEATING_MILESTONE_DAYS && streak % REPEATING_MILESTONE_DAYS === 0;

  if (!isBaseMilestone && !isRepeatingMilestone) {
    return 0;
  }

  const milestoneKeyDays = isBaseMilestone ? streak : REPEATING_MILESTONE_DAYS;
  return config[`streak_bonus_${milestoneKeyDays}`] ?? 0;
}

/**
 * Số ngày lịch giữa hai chuỗi `YYYY-MM-DD` (`to` trừ `from`), tính bằng chênh
 * lệch mốc UTC 00:00:00 của từng ngày — không phụ thuộc múi giờ hệ thống vì
 * cả hai chuỗi đã là ngày UTC+7 do caller quy đổi sẵn.
 */
function diffInCalendarDays(from: string, to: string): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const fromMs = Date.parse(`${from}T00:00:00.000Z`);
  const toMs = Date.parse(`${to}T00:00:00.000Z`);
  return Math.round((toMs - fromMs) / MS_PER_DAY);
}
