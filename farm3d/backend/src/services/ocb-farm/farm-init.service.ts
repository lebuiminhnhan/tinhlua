/**
 * OCB Farm — logic nghiệp vụ của `POST /me/init` và `GET /me/join-date-suggestion`.
 *
 * Route Express thực tế (`backend/src/routes/ocb-farm.routes.ts`) được viết ở
 * task 4.4 — file này CHỈ export hàm service, không có `express.Router` nào ở
 * đây, theo đúng khuôn mẫu route mỏng / service chứa logic đã dùng ở
 * `farm-me.service.ts` (task 4.2).
 *
 * _Requirements: US-1, US-2, US-3, BR-7_
 */

import { pool } from '../../config/database';
import { nowVN, startOfDayVN } from './farm-calendar';
import { FarmConfigError, getFarmConfigValue } from './farm-config.service';
import { appendFarmTransaction, insertInitialFarmState, readFarmState } from './farm-state.repository';
import { ensurePlotLayout, EXPANSION_PLOTS_V2 } from './farm-plot-layout';
import { CURRENT_GRID_VERSION } from './farm-grid-migration';
import { syncTreeWithSeniority } from './farm-seniority';
import type {
  FarmCounters,
  FarmErrorCode,
  FarmInitRequest,
  FarmJoinDateSuggestion,
  FarmSettings,
  FarmStateJson,
  FarmTreeState,
} from '../../types/ocb-farm.types';

// ============================================================================
// Cấu hình cục bộ của module này
// ============================================================================

/**
 * Thời gian chờ tối đa cho việc tra ngày vào làm từ nguồn nhân sự (US-3).
 *
 * Hardcode thành hằng số cục bộ (không phải một khóa `farm_config`) vì
 * {@link lookupJoinDateFromHr} hiện là một stub luôn trả về `null` ngay lập
 * tức (xem chú thích ở hàm đó) — thêm một khóa cấu hình cho một giá trị chưa
 * có tác dụng thực tế là scope creep. Nếu một lần tra cứu LDAP/HR thật được
 * cắm vào sau này và cần chỉnh thời gian chờ theo môi trường, giá trị này
 * nên chuyển thành khóa `farm_config` (nhóm `khoi_tao`) tại thời điểm đó.
 */
const HR_LOOKUP_TIMEOUT_MS = 3000;

// ============================================================================
// Validate ngày vào làm (US-2, BR-7) — dùng chung cho init và suggestion
// ============================================================================

export interface JoinDateRange {
  /** `YYYY-MM-DD` — 01/01 của `ocb_founded_year`. */
  minDate: string;
  /** `YYYY-MM-DD` — hôm nay theo giờ Việt Nam (UTC+7). */
  maxDate: string;
}

/**
 * Trả khoảng ngày vào làm hợp lệ: [01/01 năm thành lập OCB, hôm nay UTC+7].
 *
 * `ocb_founded_year` đọc từ `farm_config` (mặc định 1996 theo seed) — không
 * hardcode ở đây để admin điều chỉnh được qua `GET/PUT /admin/config` (task
 * 8.3) mà không cần sửa code.
 *
 * _Requirements: US-2, BR-7_
 */
async function getJoinDateRange(now: Date): Promise<JoinDateRange> {
  const foundedYear = await getFarmConfigValue('ocb_founded_year');
  const minDate = `${Math.trunc(foundedYear)}-01-01`;
  const maxDate = startOfDayVN(now).toISOString().slice(0, 10);
  return { minDate, maxDate };
}

/**
 * Phân tích chuỗi `YYYY-MM-DD` thành một `Date` ở đúng mốc 00:00:00 giờ Việt
 * Nam (UTC+7) của ngày đó.
 *
 * Cố ý dùng `T00:00:00+07:00` (KHÔNG dùng `new Date(dateStr)` trần — JS coi
 * chuỗi `YYYY-MM-DD` bare là UTC midnight, gây lệch múi giờ khi so sánh với
 * các mốc UTC+7 khác trong hệ thống này).
 *
 * Trả `null` khi chuỗi rỗng, thiếu, hoặc không parse được thành ngày hợp lệ.
 */
function parseJoinDateVN(dateStr: string | undefined | null): Date | null {
  if (!dateStr) return null;
  const parsed = new Date(`${dateStr}T00:00:00+07:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

/**
 * Xác thực `join_date` (chuỗi `YYYY-MM-DD`) nằm trong khoảng hợp lệ.
 *
 * Ném {@link FarmConfigError} với mã `JOIN_DATE_REQUIRED` khi thiếu/rỗng, hoặc
 * `JOIN_DATE_OUT_OF_RANGE` khi ngoài khoảng [minDate, maxDate] (US-2, BR-7).
 * Được gọi TRƯỚC khi chạm DB ở {@link initFarm}, để một ngày không hợp lệ
 * không bao giờ tạo ra một nông trại dở dang.
 */
async function validateJoinDate(joinDate: string | undefined | null, now: Date): Promise<void> {
  if (!joinDate || joinDate.trim() === '') {
    throw new FarmConfigError('JOIN_DATE_REQUIRED', 'Vui lòng chọn ngày vào làm.');
  }

  const parsed = parseJoinDateVN(joinDate);
  if (parsed === null) {
    throw new FarmConfigError('JOIN_DATE_REQUIRED', 'Ngày vào làm không đúng định dạng.');
  }

  const { minDate, maxDate } = await getJoinDateRange(now);
  const minParsed = parseJoinDateVN(minDate)!;
  const maxParsed = parseJoinDateVN(maxDate)!;

  if (parsed.getTime() < minParsed.getTime() || parsed.getTime() > maxParsed.getTime()) {
    throw new FarmConfigError(
      'JOIN_DATE_OUT_OF_RANGE',
      `Ngày vào làm phải trong khoảng từ ${minDate} đến ${maxDate}.`,
      { min_date: minDate, max_date: maxDate },
    );
  }
}

// ============================================================================
// Nông trại khởi điểm (US-1)
// ============================================================================

/**
 * Dựng vùng đất khởi đầu: khối 5×5 ô đất, vùng `id: 1`, đã mở khóa, địa hình
 * `land`. Ô đầu tiên (`cells[0]`) là ô trung tâm dành cho Cây OCB — bất khả
 * xâm phạm theo quy ước của `centerCell()` trong `farm-grid.ts` ("ô trung
 * tâm luôn là ô đầu tiên của vùng đất số 1").
 *
 * Ô trung tâm được đặt tại `"2,2"` (giữa khối 5×5 từ `"0,0"` tới `"4,4"`) để
 * Cây OCB nằm giữa hình học, không lệch về một góc.
 */
function buildStartingPlotCells(): string[] {
  const cells: string[] = [];
  // Ô trung tâm trước tiên — bắt buộc theo quy ước `centerCell()`.
  cells.push('2,2');
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const cell = `${row},${col}`;
      if (cell !== '2,2') {
        cells.push(cell);
      }
    }
  }
  return cells;
}

/**
 * Dựng `FarmStateJson` khởi điểm cho một nông trại mới (US-1).
 *
 * Exported để `farm-admin.service.ts` (task 8.2, `POST /admin/users/:id/reset`)
 * tái dùng đúng một công thức "nông trại khởi điểm" — tránh hai nơi tự dựng
 * hai hình dạng khởi điểm có thể trôi lệch nhau theo thời gian.
 *
 * Nông trại mới được dựng thẳng trên lưới 20×25 (`EXPANSION_PLOTS_V2`) và
 * đặt `grid_version: CURRENT_GRID_VERSION` ngay từ đầu — khác với
 * `Legacy_Grid_Farm`, nông trại mới không cần qua `migrateGridTo20x25` vì
 * không có gì để mở rộng (US-7, US-8 — bản nâng cấp Cinema).
 */
export function buildInitialFarmStateJson(now: Date): FarmStateJson {
  const tree: FarmTreeState = {
    milestone: 0,
    branches: 0,
    last_evaluated_at: now.toISOString(),
  };

  const counters: FarmCounters = {
    harvest_count: 0,
    water_count: 0,
    help_given: 0,
    species_owned: [],
  };

  // `ensurePlotLayout` bổ sung các vùng mở rộng đang khoá (lưới 20×25 mới qua
  // `EXPANSION_PLOTS_V2`) + ao khởi đầu 2×2 đã mở (tối thiểu 4 ô nước để thả
  // cá ngay — xem `farm-plot-layout.ts`).
  return ensurePlotLayout(
    {
      schema: 1,
      plots: [
        {
          id: 1,
          unlocked: true,
          cells: buildStartingPlotCells(),
          terrain: 'land',
        },
      ],
      animals: [],
      plants: [],
      decors: [],
      storage: {},
      tree,
      badges_shown: [],
      counters,
      grid_version: CURRENT_GRID_VERSION,
    },
    EXPANSION_PLOTS_V2,
  );
}

/**
 * Thiết lập mặc định của một nông trại mới — âm thanh tắt theo BR-29, mức
 * chất lượng `low` là giá trị an toàn (auto-detect thật diễn ra ở frontend,
 * task rất sau — đây chỉ là default DB).
 */
const DEFAULT_INITIAL_SETTINGS: FarmSettings = {
  quality: 'low',
  quality_manual: false,
  bgm: false,
  sfx: false,
  scene_lock: null,
};

// ============================================================================
// `POST /me/init` (US-1, US-2, US-3, BR-7)
// ============================================================================

/** Kết quả thành công của {@link initFarm} — đủ dữ liệu để route (task 4.4) dựng `FarmMeResponse`. */
export interface FarmInitResult {
  join_date: string;
  join_date_source: FarmInitRequest['join_date_source'];
  join_date_admin_locked: boolean;
  farm_name: string;
  seeds: number;
  state: FarmStateJson;
  settings: FarmSettings;
  version: number;
  last_tick_at: string;
  /** `true` khi lệnh gọi này là lệnh tạo ra nông trại; `false` khi nông trại đã tồn tại từ trước (phiên/thiết bị khác thắng race). */
  created: boolean;
}

/**
 * Khởi tạo nông trại cho `userId`, idempotent theo `user_id` (US-1: "hai thẻ
 * hai thiết bị gọi đồng thời chỉ tạo một nông trại duy nhất").
 *
 * Thứ tự thực hiện:
 * 1. Validate `join_date` (khoảng hợp lệ, bắt buộc) TRƯỚC khi mở transaction —
 *    một ngày không hợp lệ không bao giờ để lại nông trại dở dang.
 * 2. `BEGIN` → `INSERT ... ON CONFLICT (user_id) DO NOTHING RETURNING *` —
 *    idempotency ở tầng DB (lớp bảo vệ thứ hai, độc lập với việc application
 *    có kiểm tra tồn tại trước hay không) vì `user_id` là PRIMARY KEY.
 * 3. Nếu `INSERT` thực sự tạo dòng mới (có `RETURNING`): ghi thêm một dòng
 *    `farm_transactions` cho số Hạt OCB khởi điểm (`initial_seeds`), rồi
 *    `COMMIT`.
 * 4. Nếu không có dòng nào được tạo (đã tồn tại — trường hợp "tab/thiết bị
 *    thứ hai"): không có gì để ghi, `ROLLBACK` (không có tác dụng vì chưa
 *    ghi gì), đọc lại dòng đã tồn tại và trả về như một kết quả thành công
 *    (KHÔNG coi là lỗi — đúng AC "phiên còn lại mở đúng nông trại đã tạo").
 *
 * _Requirements: US-1, US-2, US-3, BR-7_
 */
export async function initFarm(userId: number, request: FarmInitRequest): Promise<FarmInitResult> {
  const now = nowVN();

  // Bước 1 — validate TRƯỚC khi chạm DB (không để lại nông trại dở dang).
  await validateJoinDate(request.join_date, now);

  const farmName = (request.farm_name ?? '').trim() || 'Nông trại của tôi';
  // Cây OCB khởi điểm đã đúng mốc + số nhánh theo ngày vào làm (US-5, US-6).
  const initialState = syncTreeWithSeniority(buildInitialFarmStateJson(now), request.join_date, now, {
    treeMaxMilestone: await getFarmConfigValue('tree_max_milestone'),
    treeMaxBranches: await getFarmConfigValue('tree_max_branches'),
  });
  const initialSeeds = Math.trunc(await getFarmConfigValue('initial_seeds'));

  const client = await pool.connect();
  let alreadyExisted = false;

  try {
    await client.query('BEGIN');

    const insertResult = await insertInitialFarmState(client, {
      userId,
      farmName,
      joinDate: request.join_date,
      joinDateSource: request.join_date_source,
      seeds: initialSeeds,
      state: initialState,
      settings: DEFAULT_INITIAL_SETTINGS,
      lastTickAt: now,
    });

    if (insertResult === null) {
      // Đã tồn tại từ trước — thua cuộc đua, không có gì để ghi thêm.
      alreadyExisted = true;
      await client.query('ROLLBACK');
    } else {
      // Dòng mới được tạo — ghi nhận Hạt OCB khởi điểm vào sổ thu chi.
      //
      // Chọn `kind: 'admin_adjust'` trong `FARM_LEDGER_KINDS` cho khoản cấp
      // Hạt OCB khởi điểm này. Không có khóa nào trong danh sách hiện tại mô
      // tả đúng "cấp vốn khởi điểm khi tạo nông trại" — các khóa còn lại đều
      // gắn với một hành động nghiệp vụ cụ thể (mua/bán/cho ăn/check-in/
      // giúp đỡ/thành tựu) mà khoản này không phải. `admin_adjust` là khóa
      // GENERIC nhất trong danh sách cho "cộng/trừ Hạt OCB không gắn với một
      // giao dịch mua-bán/hoạt động cụ thể nào", nên được chọn thay vì thêm
      // một khóa mới (`FARM_LEDGER_KINDS` không được sửa trong task này để
      // tránh scope creep vượt phạm vi 4.3 — nếu một khóa `initial_grant`
      // riêng biệt là cần thiết, nên thêm ở một task/spec riêng có thảo luận
      // với người dùng).
      await appendFarmTransaction(client, {
        userId,
        kind: 'admin_adjust',
        amount: initialSeeds,
        balanceAfter: initialSeeds,
        refType: 'farm_init',
        note: 'Hạt OCB khởi điểm khi tạo nông trại',
      });

      await client.query('COMMIT');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  if (alreadyExisted) {
    const existing = await readFarmState(userId);
    if (existing === null) {
      // Không thể xảy ra trong điều kiện bình thường (vừa xác nhận có xung
      // đột user_id nghĩa là dòng đã tồn tại) — nhưng nếu có (ví dụ dòng bị
      // xoá giữa hai bước), coi như lỗi hạ tầng để caller (route, task 4.4)
      // trả 500 thay vì che giấu bằng một kết quả giả.
      throw new Error(`Không đọc lại được farm_states sau khi INSERT ON CONFLICT cho user_id=${userId}.`);
    }

    return {
      join_date: existing.join_date ?? request.join_date,
      join_date_source: existing.join_date_source ?? request.join_date_source,
      join_date_admin_locked: existing.join_date_admin_locked,
      farm_name: existing.farm_name ?? farmName,
      seeds: existing.seeds,
      state: existing.state,
      settings: existing.settings,
      version: existing.version,
      last_tick_at: existing.last_tick_at,
      created: false,
    };
  }

  return {
    join_date: request.join_date,
    join_date_source: request.join_date_source,
    join_date_admin_locked: false,
    farm_name: farmName,
    seeds: initialSeeds,
    state: initialState,
    settings: DEFAULT_INITIAL_SETTINGS,
    version: 0,
    last_tick_at: now.toISOString(),
    created: true,
  };
}

// ============================================================================
// `GET /me/join-date-suggestion` (US-3)
// ============================================================================

/**
 * Tra ngày vào làm từ nguồn dữ liệu nhân sự (LDAP/`users`).
 *
 * ⚠ Cần xác nhận: XN-2 — chưa có nguồn ngày vào làm thật trong users/LDAP;
 * nhân viên luôn tự khai (self) cho tới khi nguồn này được bổ sung. Bảng
 * `users` hiện không có cột `hire_date`/`ngay_vao_lam` nào (đã kiểm tra toàn
 * bộ migration), và LDAP hiện tại (`backend/src/config/ldap.ts`) không đồng
 * bộ trường ngày vào làm. Hàm này luôn resolve `null` ngay lập tức, nhưng
 * giữ chữ ký `Promise<{ joinDate: Date } | null>` và không đổi cách gọi ở
 * {@link getJoinDateSuggestion} (vẫn qua `Promise.race` với timeout), để một
 * lần tra cứu LDAP/HR thật có thể cắm vào thay thân hàm này mà không cần sửa
 * logic gọi.
 */
async function lookupJoinDateFromHr(_userId: number): Promise<{ joinDate: Date } | null> {
  return null;
}

/** Chờ `promise` tối đa `timeoutMs` — nếu hết giờ, resolve `null` (không reject). */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}

/**
 * Trả gợi ý ngày vào làm cho màn hình khởi tạo (US-3).
 *
 * Hàm này KHÔNG BAO GIỜ throw — mọi lỗi/timeout/giá trị ngoài khoảng được
 * chuyển thành `{ available: false, reason }` để không chặn nhân viên hoàn
 * tất khởi tạo (đúng AC "không chặn nhân viên hoàn tất khởi tạo" của US-3).
 *
 * _Requirements: US-3_
 */
export async function getJoinDateSuggestion(userId: number): Promise<FarmJoinDateSuggestion> {
  const now = nowVN();
  const { minDate, maxDate } = await getJoinDateRange(now);

  let hrResult: { joinDate: Date } | null;
  try {
    hrResult = await withTimeout(lookupJoinDateFromHr(userId), HR_LOOKUP_TIMEOUT_MS);
  } catch {
    hrResult = null;
  }

  if (hrResult === null) {
    return {
      available: false,
      join_date: null,
      source: null,
      reason: 'Không tìm thấy dữ liệu ngày vào làm từ hệ thống nhân sự.',
      min_date: minDate,
      max_date: maxDate,
    };
  }

  const suggestedDateStr = startOfDayVN(hrResult.joinDate).toISOString().slice(0, 10);
  const minParsed = parseJoinDateVN(minDate)!;
  const maxParsed = parseJoinDateVN(maxDate)!;
  const suggestedParsed = parseJoinDateVN(suggestedDateStr)!;

  const inRange =
    suggestedParsed.getTime() >= minParsed.getTime() && suggestedParsed.getTime() <= maxParsed.getTime();

  if (!inRange) {
    return {
      available: false,
      join_date: null,
      source: null,
      reason: 'Ngày vào làm từ dữ liệu nhân sự nằm ngoài khoảng hợp lệ.',
      min_date: minDate,
      max_date: maxDate,
    };
  }

  return {
    available: true,
    join_date: suggestedDateStr,
    source: 'hr',
    reason: null,
    min_date: minDate,
    max_date: maxDate,
  };
}

// Re-export kiểu lỗi để route/other callers không cần import trực tiếp từ
// `farm-config.service.ts` chỉ để bắt lỗi của module này (tiện cho task 4.4).
export type { FarmErrorCode };
export { FarmConfigError };
