import * as fc from 'fast-check';
import type { FarmListItem } from '../../models/ocb-farm.model';
import {
  VISIT_SEARCH_MIN_CHARS,
  collectDepartmentOptions,
  isSearchableQuery,
  seniorityLabel,
} from './visit-browser';

function makeItem(overrides: Partial<FarmListItem> = {}): FarmListItem {
  return {
    user_id: 1,
    full_name: 'Nguyễn Văn A',
    department_id: 10,
    department_name: 'Phòng CNTT',
    farm_name: 'Nông trại A',
    seniority_months: 14,
    badges_shown: [],
    is_anniversary_today: false,
    has_farm: true,
    ...overrides,
  };
}

describe('isSearchableQuery', () => {
  it('cho phép chuỗi rỗng (bỏ lọc tên)', () => {
    expect(isSearchableQuery('')).toBe(true);
    expect(isSearchableQuery('   ')).toBe(true);
  });

  it(`từ chối chuỗi ngắn hơn ${VISIT_SEARCH_MIN_CHARS} ký tự sau khi trim`, () => {
    expect(isSearchableQuery('a')).toBe(false);
    expect(isSearchableQuery(' a ')).toBe(false);
  });

  it(`chấp nhận chuỗi đủ ${VISIT_SEARCH_MIN_CHARS} ký tự`, () => {
    expect(isSearchableQuery('an')).toBe(true);
    expect(isSearchableQuery('nguyen van a')).toBe(true);
  });

  /**
   * Property: với mọi chuỗi, kết quả chỉ phụ thuộc độ dài sau khi trim — rỗng hoặc
   * ≥ VISIT_SEARCH_MIN_CHARS thì searchable, ngược lại thì không.
   * **Validates: Requirements US-26**
   */
  it('property: searchable khi và chỉ khi rỗng hoặc đủ độ dài sau trim', () => {
    fc.assert(
      fc.property(fc.string(), (q) => {
        const trimmedLen = q.trim().length;
        const expected = trimmedLen === 0 || trimmedLen >= VISIT_SEARCH_MIN_CHARS;
        expect(isSearchableQuery(q)).toBe(expected);
      }),
    );
  });
});

describe('seniorityLabel', () => {
  it('dưới 12 tháng chỉ hiển thị số tháng', () => {
    expect(seniorityLabel(5)).toBe('5 tháng');
    expect(seniorityLabel(0)).toBe('0 tháng');
  });

  it('đúng số năm tròn không hiển thị phần tháng', () => {
    expect(seniorityLabel(24)).toBe('2 năm');
  });

  it('năm lẫn tháng dư hiển thị cả hai', () => {
    expect(seniorityLabel(14)).toBe('1 năm 2 tháng');
  });

  /**
   * Property: với mọi số tháng không âm, nhãn luôn phân giải đúng ngược lại thành
   * đúng số năm và số tháng dư ban đầu (years*12 + rest === months).
   * **Validates: Requirements US-26**
   */
  it('property: năm*12 + tháng dư luôn bằng số tháng đầu vào (đã sàn về số nguyên không âm)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1000 }), (months) => {
        const label = seniorityLabel(months);
        const yearMatch = /^(\d+) năm(?: (\d+) tháng)?$/.exec(label);
        const monthOnlyMatch = /^(\d+) tháng$/.exec(label);
        let years = 0;
        let rest = 0;
        if (yearMatch) {
          years = Number(yearMatch[1]);
          rest = yearMatch[2] ? Number(yearMatch[2]) : 0;
        } else if (monthOnlyMatch) {
          rest = Number(monthOnlyMatch[1]);
        }
        expect(years * 12 + rest).toBe(months);
      }),
    );
  });
});

describe('collectDepartmentOptions', () => {
  it('gộp phòng ban mới, bỏ qua department_id null', () => {
    const items = [makeItem({ department_id: 1, department_name: 'A' }), makeItem({ department_id: null })];
    const result = collectDepartmentOptions(items, []);
    expect(result).toEqual([{ id: 1, name: 'A' }]);
  });

  it('không trùng id khi gọi nhiều lần với các trang khác nhau', () => {
    const page1 = [makeItem({ department_id: 1, department_name: 'A' })];
    const page2 = [makeItem({ department_id: 1, department_name: 'A' }), makeItem({ department_id: 2, department_name: 'B' })];
    const afterPage1 = collectDepartmentOptions(page1, []);
    const afterPage2 = collectDepartmentOptions(page2, afterPage1);
    expect(afterPage2.map((d) => d.id).sort()).toEqual([1, 2]);
  });

  it('sắp theo tên tiếng Việt', () => {
    const items = [
      makeItem({ department_id: 2, department_name: 'Ban Nhân sự' }),
      makeItem({ department_id: 1, department_name: 'Ban Công nghệ' }),
    ];
    const result = collectDepartmentOptions(items, []);
    expect(result.map((d) => d.id)).toEqual([1, 2]);
  });
});
