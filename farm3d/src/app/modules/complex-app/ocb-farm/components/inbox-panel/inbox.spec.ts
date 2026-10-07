import * as fc from 'fast-check';
import type { FarmInboxGreeting, FarmInboxHelp } from '../../models/ocb-farm.model';
import { countNewItems, formatInboxTime, toInboxGreetingRow, toInboxHelpRow } from './inbox';

function makeHelp(overrides: Partial<FarmInboxHelp> = {}): FarmInboxHelp {
  return {
    id: 1,
    helper_user_id: 42,
    helper_name: 'Nguyễn Văn A',
    action_type: 'water',
    help_date: '2026-01-05',
    created_at: '2026-01-05T03:00:00.000Z',
    is_new: true,
    ...overrides,
  };
}

function makeGreeting(overrides: Partial<FarmInboxGreeting> = {}): FarmInboxGreeting {
  return {
    id: 1,
    sender_user_id: 42,
    sender_name: 'Trần Thị B',
    kind: 'text',
    message: 'Chúc mừng bạn!',
    created_at: '2026-01-05T03:00:00.000Z',
    is_new: true,
    ...overrides,
  };
}

describe('formatInboxTime', () => {
  it('chuyển ISO UTC sang dd/MM/yyyy HH:mm theo giờ Việt Nam (UTC+7)', () => {
    // 03:00 UTC == 10:00 giờ Việt Nam
    expect(formatInboxTime('2026-01-05T03:00:00.000Z')).toBe('05/01/2026 10:00');
  });

  it('chuỗi không hợp lệ → giữ nguyên', () => {
    expect(formatInboxTime('not-a-date')).toBe('not-a-date');
  });
});

describe('toInboxHelpRow', () => {
  it('ánh xạ đúng tên, loại hành động và cờ mới', () => {
    const row = toInboxHelpRow(makeHelp({ action_type: 'feed', is_new: false }));
    expect(row.helperName).toBe('Nguyễn Văn A');
    expect(row.actionLabel).toContain('ăn');
    expect(row.isNew).toBe(false);
  });

  it('tên trống → dùng nhãn mặc định "Đồng nghiệp"', () => {
    const row = toInboxHelpRow(makeHelp({ helper_name: '' }));
    expect(row.helperName).toBe('Đồng nghiệp');
  });
});

describe('toInboxGreetingRow', () => {
  it('ánh xạ đúng nội dung, người gửi và cờ mới', () => {
    const row = toInboxGreetingRow(makeGreeting({ message: 'Chúc mừng 5 năm!', is_new: true }));
    expect(row.senderName).toBe('Trần Thị B');
    expect(row.message).toBe('Chúc mừng 5 năm!');
    expect(row.isNew).toBe(true);
    expect(row.isEmoji).toBe(false);
  });

  it('kind=emoji → isEmoji true', () => {
    const row = toInboxGreetingRow(makeGreeting({ kind: 'emoji', message: '🎉' }));
    expect(row.isEmoji).toBe(true);
  });
});

describe('countNewItems', () => {
  it('đếm đúng tổng số mục is_new=true của cả hai danh sách', () => {
    const helps = [makeHelp({ id: 1, is_new: true }), makeHelp({ id: 2, is_new: false })];
    const greetings = [
      makeGreeting({ id: 1, is_new: true }),
      makeGreeting({ id: 2, is_new: true }),
    ];
    expect(countNewItems(helps, greetings)).toBe(3);
  });

  it('danh sách rỗng → 0', () => {
    expect(countNewItems([], [])).toBe(0);
  });

  /**
   * Property: `countNewItems` luôn bằng tổng số phần tử `is_new=true` đếm thủ công ở cả
   * hai danh sách, với mọi tổ hợp cờ `is_new` ngẫu nhiên.
   * **Validates: Requirements US-8, US-27**
   */
  it('property: luôn bằng tổng số mục is_new=true đếm thủ công', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { maxLength: 20 }),
        fc.array(fc.boolean(), { maxLength: 20 }),
        (helpFlags, greetingFlags) => {
          const helps = helpFlags.map((isNew, i) => makeHelp({ id: i, is_new: isNew }));
          const greetings = greetingFlags.map((isNew, i) => makeGreeting({ id: i, is_new: isNew }));
          const expected =
            helpFlags.filter(Boolean).length + greetingFlags.filter(Boolean).length;
          expect(countNewItems(helps, greetings)).toBe(expected);
        },
      ),
    );
  });
});
