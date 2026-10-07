/**
 * OCB Farm — nhóm lệnh hàng ngày/thường niên: `CLAIM_CHECKIN`,
 * `PICK_ANNIVERSARY_FRUIT`, `SELECT_BADGES`.
 *
 * Mọi handler ở đây THUẦN theo đúng chữ ký `FarmCommandHandler<C>` (xem
 * `types.ts`): không đọc/ghi DB, không gọi `tick()` (state truyền vào đã
 * được `farm-command.service.ts` tick tới `ctx.now` trước khi dispatch) —
 * chỉ nhận `state` đã tick + `payload` + `ctx` rồi trả `success()`/`fail()`.
 *
 * ## Điểm khác biệt so với các nhóm lệnh trước (5.2-5.5)
 *
 * `CLAIM_CHECKIN` và `PICK_ANNIVERSARY_FRUIT` KHÔNG có bảo đảm idempotency
 * thật nào ở TẦNG HANDLER — handler chỉ nhìn vào `ctx.lastCheckinDate` /
 * danh sách `farm_anniversary_claims` không tồn tại ở đây để quyết định "có
 * nên cho phép không". Lớp bảo vệ THẬT (chống hai request đồng thời cùng
 * vượt qua điều kiện này và cả hai đều được cộng thưởng) là UNIQUE constraint
 * của `farm_checkins`/`farm_anniversary_claims`, và việc ghi hai bảng này
 * nằm ở `farm-command.service.ts`, KHÔNG ở đây — xem `checkinUpdate`/
 * `anniversaryClaimInsert` trong `types.ts` và ghi chú race-handling ở
 * `farm-command.service.ts`. Lý do kiến trúc: giữ đúng D2 (handler là hàm
 * thuần, không chạm DB) trong khi vẫn cần hai bảng chuyên dụng ngoài `state`
 * (JSONB) để UNIQUE constraint có hiệu lực — xem thêm ghi chú đầu
 * `commands/types.ts` (trường `checkinStreak`/`lastCheckinDate`/`joinDate`/
 * `today`/`unlockedAchievementCodes` của `FarmCommandContext`).
 *
 * `SELECT_BADGES` thì khác: không cần bảng mới, chỉ validate dựa vào
 * `ctx.unlockedAchievementCodes` (đọc từ `farm_achievements` TRƯỚC khi
 * dispatch — không phải thành tựu vừa mở khóa ở CHÍNH lượt này, vì lượt
 * `SELECT_BADGES` không làm thay đổi tiến trình thành tựu nào) rồi ghi thẳng
 * vào `state.badges_shown` (đã có sẵn trong JSONB `state`, không cần cột mới).
 *
 * _Requirements: US-7, US-25, US-29, BR-6, BR-12, BR-13, BR-14_
 */

import { anniversaryOf } from '../farm-calendar';
import { milestoneReward, nextStreak } from '../farm-checkin';
import { seniority } from '../farm-seniority';
import { AchievementCode, FarmStateJson } from '../../../types/ocb-farm.types';
import { FarmCommandHandler, fail, success } from './types';

// ============================================================================
// CLAIM_CHECKIN (US-25, BR-13, BR-14)
// ============================================================================

const claimCheckin: FarmCommandHandler<'CLAIM_CHECKIN'> = (state, _payload, ctx) => {
  // Đã nhận thưởng check-in trong ngày hôm nay (theo `last_checkin_date` đã
  // đọc cùng dòng với `state` TRƯỚC khi tick/dispatch) — từ chối, giữ nguyên
  // số dư và chuỗi, cho phép thử lại trong ngày (US-25, AC "nhận thưởng lần
  // thứ hai trong cùng một ngày ... không cộng thêm Hạt OCB và không thay
  // đổi chuỗi"). Đây là lớp kiểm tra NHANH dựa trên state đã đọc — lớp bảo
  // vệ THẬT chống đua điều kiện giữa hai request đồng thời là UNIQUE
  // constraint của `farm_checkins`, xử lý ở `farm-command.service.ts`.
  if (ctx.lastCheckinDate === ctx.today) {
    return fail(
      'CHECKIN_ALREADY_CLAIMED',
      'Bạn đã nhận thưởng check-in hôm nay rồi, vui lòng quay lại vào ngày mai.',
      { last_checkin_date: ctx.lastCheckinDate },
    );
  }

  const newStreak = nextStreak(ctx.lastCheckinDate, ctx.today, ctx.checkinStreak);
  const baseReward = ctx.config['checkin_reward'] ?? 0;
  const streakBonus = milestoneReward(newStreak, ctx.config);
  const totalReward = baseReward + streakBonus;

  return success(state, {
    seedsDelta: totalReward,
    ledgerLines: [
      {
        kind: 'checkin',
        amount: baseReward,
        refType: 'checkin',
        refId: ctx.today,
        note: `Check-in ngày ${ctx.today}`,
      },
      ...(streakBonus > 0
        ? [
            {
              kind: 'streak_bonus' as const,
              amount: streakBonus,
              refType: 'checkin',
              refId: ctx.today,
              note: `Thưởng mốc chuỗi check-in ${newStreak} ngày`,
            },
          ]
        : []),
    ],
    notices: [
      {
        code: 'CHECKIN_CLAIMED',
        level: 'success',
        message:
          streakBonus > 0
            ? `Check-in thành công: +${baseReward} Hạt OCB, chuỗi ${newStreak} ngày (+${streakBonus} Hạt OCB thưởng mốc).`
            : `Check-in thành công: +${baseReward} Hạt OCB, chuỗi ${newStreak} ngày.`,
        data: { streak: newStreak, base_reward: baseReward, streak_bonus: streakBonus },
      },
    ],
    checkinUpdate: {
      streak: newStreak,
      lastCheckinDate: ctx.today,
      tableInsert: {
        checkinDate: ctx.today,
        reward: baseReward,
        streakBonus,
        streakAfter: newStreak,
      },
    },
  });
};

// ============================================================================
// PICK_ANNIVERSARY_FRUIT (US-7, BR-6, BR-13)
// ============================================================================

/** Số ngày lịch (UTC, không phụ thuộc múi giờ máy chủ) từ `from` tới `to` — cả hai đã là mốc 00:00 UTC+7. */
function diffInDays(from: Date, to: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

const pickAnniversaryFruit: FarmCommandHandler<'PICK_ANNIVERSARY_FRUIT'> = (state, payload, ctx) => {
  if (ctx.joinDate === null) {
    return fail('FARM_NOT_INITIALIZED', 'Nông trại chưa xác nhận ngày vào làm.');
  }

  const minYears = ctx.config['anniversary_min_years'] ?? 3;
  const { years: seniorityYears } = seniority(ctx.joinDate, ctx.now);

  if (seniorityYears < minYears) {
    return fail(
      'SENIORITY_TOO_LOW',
      `Cần thâm niên từ ${minYears} năm để hái quả kỷ niệm trên Cây OCB.`,
      { required_years: minYears, current_years: seniorityYears },
    );
  }

  const todayStart = new Date(`${ctx.today}T00:00:00.000Z`);
  // `anniversaryOf` trả mốc 00:00:00 UTC+7 của ngày kỷ niệm trong năm hiện
  // tại của `ctx.now` — nếu ngày kỷ niệm năm nay CHƯA tới (ví dụ hôm nay là
  // tháng 1 nhưng ngày vào làm là tháng 11), ngày kỷ niệm "đang áp dụng" vẫn
  // là của năm trước (đã qua, có thể còn trong thời gian ân hạn).
  const currentYear = Number(ctx.today.slice(0, 4));
  const anniversaryThisYear = anniversaryOf(ctx.joinDate, currentYear);
  const anniversaryIsUpcoming = anniversaryThisYear.getTime() > todayStart.getTime();
  const applicableYear = anniversaryIsUpcoming ? currentYear - 1 : currentYear;
  const applicableAnniversary = anniversaryIsUpcoming
    ? anniversaryOf(ctx.joinDate, applicableYear)
    : anniversaryThisYear;

  const graceDays = ctx.config['anniversary_grace_days'] ?? 0;
  const daysSinceAnniversary = diffInDays(applicableAnniversary, todayStart);
  const isAnniversaryToday = daysSinceAnniversary === 0;
  const isWithinGrace = daysSinceAnniversary > 0 && daysSinceAnniversary <= graceDays;

  if (!isAnniversaryToday && !isWithinGrace) {
    // Không phải đúng ngày kỷ niệm và cũng không còn trong thời gian ân hạn
    // — phân biệt hai lý do để thông báo đúng (US-7, AC "nếu nhân viên không
    // mở nông trại trong ngày kỷ niệm, phần thưởng vẫn nhận được trong thời
    // gian ân hạn ... sau thời gian đó phần thưởng của năm hiện tại không
    // còn nhận được").
    if (daysSinceAnniversary > graceDays) {
      return fail(
        'ANNIVERSARY_GRACE_EXPIRED',
        'Đã hết thời gian ân hạn để nhận quả kỷ niệm của năm nay.',
        { anniversary_year: applicableYear, grace_days: graceDays, days_since: daysSinceAnniversary },
      );
    }
    return fail(
      'ANNIVERSARY_NOT_ACTIVE',
      'Hôm nay không phải ngày kỷ niệm vào làm, chưa thể hái quả.',
      { anniversary_year: applicableYear },
    );
  }

  if (payload.anniversary_year !== applicableYear) {
    return fail(
      'INVALID_PAYLOAD',
      'Năm kỷ niệm không khớp với năm kỷ niệm hiện đang áp dụng.',
      { expected_year: applicableYear, received_year: payload.anniversary_year },
    );
  }

  const fruitCount = ctx.config['anniversary_fruit_count'] ?? 0;
  const reward = ctx.config['anniversary_reward'] ?? 0;

  return success(state, {
    seedsDelta: reward,
    ledgerLines: [
      {
        kind: 'anniversary',
        amount: reward,
        refType: 'anniversary',
        refId: String(applicableYear),
        note: `Hái quả kỷ niệm ${seniorityYears} năm đồng hành (năm ${applicableYear})`,
      },
    ],
    notices: [
      {
        code: 'ANNIVERSARY_FRUIT_PICKED',
        level: 'success',
        message: `Chúc mừng ${seniorityYears} năm đồng hành! Bạn đã hái ${fruitCount} quả và nhận ${reward} Hạt OCB.`,
        data: { anniversary_year: applicableYear, seniority_years: seniorityYears, fruit_count: fruitCount, reward },
      },
    ],
    anniversaryClaimInsert: {
      anniversaryYear: applicableYear,
      seniorityYears,
      fruitPicked: fruitCount,
      rewardTotal: reward,
    },
  });
};

// ============================================================================
// SELECT_BADGES (US-29)
// ============================================================================

const selectBadges: FarmCommandHandler<'SELECT_BADGES'> = (state, payload, ctx) => {
  const maxBadges = ctx.config['badges_shown_max'] ?? 3;

  if (!Array.isArray(payload.badges)) {
    return fail('INVALID_PAYLOAD', 'Danh sách huy hiệu không hợp lệ.');
  }

  if (payload.badges.length > maxBadges) {
    return fail(
      'BADGE_LIMIT_EXCEEDED',
      `Chỉ được chọn tối đa ${maxBadges} huy hiệu hiển thị đồng thời.`,
      { max: maxBadges, requested: payload.badges.length },
    );
  }

  const unlockedSet = new Set<AchievementCode>(ctx.unlockedAchievementCodes);
  const notUnlocked = payload.badges.find((code) => !unlockedSet.has(code));
  if (notUnlocked) {
    return fail(
      'BADGE_NOT_UNLOCKED',
      'Chỉ có thể chọn hiển thị huy hiệu đã đạt được.',
      { code: notUnlocked },
    );
  }

  const nextState: FarmStateJson = { ...state, badges_shown: [...payload.badges] };

  return success(nextState);
};

// ============================================================================
// Đăng ký — export để `command-registry.ts` spread vào `COMMAND_REGISTRY`
// ============================================================================

export const DAILY_COMMAND_HANDLERS = {
  CLAIM_CHECKIN: claimCheckin,
  PICK_ANNIVERSARY_FRUIT: pickAnniversaryFruit,
  SELECT_BADGES: selectBadges,
};
