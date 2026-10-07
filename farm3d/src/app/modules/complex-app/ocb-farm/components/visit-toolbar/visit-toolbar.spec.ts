import * as fc from 'fast-check';
import type { FarmHelpAvailability, FarmStateJson } from '../../models/ocb-farm.model';
import {
  containsForbiddenWord,
  greetingBlockReason,
  hasSomethingToHelp,
  helpBlockMessage,
  helpBlockReason,
} from './visit-toolbar';

function makeAvailability(overrides: Partial<FarmHelpAvailability> = {}): FarmHelpAvailability {
  return {
    remaining_quota: 5,
    already_helped_today: false,
    can_water: true,
    can_feed: true,
    resets_at: '2026-01-02T00:00:00+07:00',
    ...overrides,
  };
}

function makeState(overrides: Partial<FarmStateJson> = {}): FarmStateJson {
  return {
    schema: 1,
    plots: [],
    animals: [],
    plants: [],
    decors: [],
    storage: {},
    tree: { milestone: 0, branches: 0, last_evaluated_at: '2026-01-01T00:00:00Z' },
    badges_shown: [],
    counters: { harvest_count: 0, water_count: 0, help_given: 0, species_owned: [] },
    ...overrides,
  };
}

describe('helpBlockReason', () => {
  it('chưa có nông trại → nothing_to_help', () => {
    expect(helpBlockReason(makeAvailability(), 'water', false)).toBe('nothing_to_help');
  });

  it('hết lượt giúp trong ngày → quota_exceeded (ưu tiên trước các lý do khác)', () => {
    const avail = makeAvailability({ remaining_quota: 0, already_helped_today: true, can_water: false });
    expect(helpBlockReason(avail, 'water', true)).toBe('quota_exceeded');
  });

  it('đã giúp nông trại này hôm nay → already_helped_today', () => {
    const avail = makeAvailability({ already_helped_today: true });
    expect(helpBlockReason(avail, 'feed', true)).toBe('already_helped_today');
  });

  it('không có gì cần giúp (can_water=false) → nothing_to_help', () => {
    const avail = makeAvailability({ can_water: false });
    expect(helpBlockReason(avail, 'water', true)).toBe('nothing_to_help');
  });

  it('đủ điều kiện → không chặn (null)', () => {
    expect(helpBlockReason(makeAvailability(), 'water', true)).toBeNull();
  });

  /**
   * Property: khi `remaining_quota` <= 0, kết quả luôn là 'quota_exceeded' bất kể các
   * trường khác — đây là lý do có mức ưu tiên cao nhất theo thiết kế.
   * **Validates: Requirements US-27, BR-21**
   */
  it('property: hết lượt giúp luôn ưu tiên trên mọi lý do khác', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -5, max: 0 }),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        fc.constantFrom('water', 'feed'),
        (quota, alreadyHelped, canWater, canFeed, action) => {
          const avail = makeAvailability({
            remaining_quota: quota,
            already_helped_today: alreadyHelped,
            can_water: canWater,
            can_feed: canFeed,
          });
          expect(helpBlockReason(avail, action as 'water' | 'feed', true)).toBe('quota_exceeded');
        },
      ),
    );
  });
});

describe('helpBlockMessage', () => {
  it('null → không có thông báo', () => {
    expect(helpBlockMessage(null, '00:00 ngày mai')).toBeNull();
  });

  it('mỗi lý do có thông báo riêng, không rỗng', () => {
    for (const reason of ['quota_exceeded', 'already_helped_today', 'nothing_to_help'] as const) {
      expect(helpBlockMessage(reason, '00:00 ngày mai')).toBeTruthy();
    }
  });
});

describe('hasSomethingToHelp', () => {
  it('state null → false', () => {
    expect(hasSomethingToHelp(null)).toBe(false);
  });

  it('có vật nuôi đói (fullness = 0) → true', () => {
    const state = makeState({
      animals: [
        {
          id: 'a1',
          species: 'chicken',
          cell: '0,0',
          fed_at: '2026-01-01T00:00:00Z',
          fullness: 0,
          cycle_started_at: '2026-01-01T00:00:00Z',
          pending: 0,
        },
      ],
    });
    expect(hasSomethingToHelp(state)).toBe(true);
  });

  it('vật nuôi no đủ và không có cây → false', () => {
    const state = makeState({
      animals: [
        {
          id: 'a1',
          species: 'chicken',
          cell: '0,0',
          fed_at: '2026-01-01T00:00:00Z',
          fullness: 50,
          cycle_started_at: '2026-01-01T00:00:00Z',
          pending: 0,
        },
      ],
    });
    expect(hasSomethingToHelp(state)).toBe(false);
  });
});

describe('containsForbiddenWord', () => {
  it('không phát hiện từ ngữ bình thường', () => {
    expect(containsForbiddenWord('Chúc mừng bạn đã gắn bó 5 năm với OCB!')).toBe(false);
  });

  it('phát hiện không phân biệt hoa thường', () => {
    expect(containsForbiddenWord('ĐỊT con này')).toBe(true);
  });
});

describe('greetingBlockReason', () => {
  it('đã gửi trong phiên này → quota_exceeded (ưu tiên trước rỗng/dài)', () => {
    expect(greetingBlockReason('', 200, true)).toBe('quota_exceeded');
  });

  it('rỗng sau khi trim → empty', () => {
    expect(greetingBlockReason('   ', 200, false)).toBe('empty');
  });

  it('vượt độ dài tối đa → too_long', () => {
    expect(greetingBlockReason('a'.repeat(201), 200, false)).toBe('too_long');
  });

  it('hợp lệ → null', () => {
    expect(greetingBlockReason('Chúc mừng!', 200, false)).toBeNull();
  });

  /**
   * Property: với mọi độ dài thông điệp (đã trim) và mọi maxLen, kết quả 'too_long' xảy
   * ra khi và chỉ khi độ dài vượt quá maxLen (và chưa gửi trong phiên, không rỗng).
   * **Validates: Requirements US-8**
   */
  it('property: too_long khi và chỉ khi độ dài sau trim vượt maxLen', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 300 }).filter((s) => s.trim().length > 0),
        fc.integer({ min: 1, max: 300 }),
        (message, maxLen) => {
          const reason = greetingBlockReason(message, maxLen, false);
          const trimmedLen = message.trim().length;
          if (trimmedLen > maxLen) {
            expect(reason).toBe('too_long');
          } else {
            expect(reason).toBeNull();
          }
        },
      ),
    );
  });
});
