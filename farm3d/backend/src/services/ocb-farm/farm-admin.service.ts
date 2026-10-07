/**
 * OCB Farm — logic nghiệp vụ quản trị: tìm nhân viên, sửa ngày vào làm,
 * điều chỉnh Hạt OCB và đặt lại nông trại (`GET /admin/users`,
 * `PATCH /admin/users/:id/join-date`, `POST /admin/users/:id/seeds`,
 * `POST /admin/users/:id/reset`).
 *
 * Route Express thực tế (`backend/src/routes/ocb-farm.routes.ts`, nhóm con
 * `/admin/*`) chỉ gọi các hàm export ở đây và định dạng response — theo đúng
 * khuôn mẫu route mỏng / service chứa logic đã dùng ở `farm-me.service.ts`,
 * `farm-init.service.ts`.
 *
 * Điều chỉnh Hạt OCB (`adjustSeedsByAdmin`, US-43):
 * - Validate TRƯỚC khi chạm DB: `reason` ≥ `admin_reason_min_len` ký tự,
 *   `amount` là số nguyên khác 0 và `|amount| ≤ admin_adjust_max`.
 * - `Idempotency-Key` (header, không phải body) được truyền vào CẢ hai nơi:
 *   `farm_admin_audit` (`action = 'adjust_seeds'`, tận dụng
 *   `uq_farm_admin_audit_action_idem` đã có — unique theo `(action,
 *   idempotency_key)`) và `appendFarmTransaction` (`idempotencyKey`, tận
 *   dụng `uq_farm_transactions_user_idem`). Trước khi mở transaction áp
 *   dụng, kiểm tra đã có dòng `farm_admin_audit` nào khớp
 *   `(action='adjust_seeds', idempotency_key)` chưa — nếu có, đọc lại
 *   `before_value`/`after_value` của dòng đó và trả về nguyên trạng
 *   (`replayed: true`), KHÔNG áp dụng lại hiệu lực (không trừ/cộng thêm một
 *   lần nữa).
 * - Trong transaction: khóa dòng bằng `readFarmStateForUpdate`, tính số dư
 *   sau (`seeds + amount`), từ chối với `ADMIN_ADJUST_NEGATIVE_BALANCE` nếu
 *   âm (422, không phải 500 — BR-9 vẫn là bất biến DB nhưng ở đây được chặn
 *   sớm bằng validate nghiệp vụ để trả lỗi rõ ràng), `persistFarmState` (chỉ
 *   đổi `seeds`, tăng `version`), `appendFarmTransaction` (`kind:
 *   'admin_adjust'`), `INSERT farm_admin_audit` (`action: 'adjust_seeds'`).
 * - Tạo thông báo cho nhân viên bằng mã `SEEDS_ADJUSTED_BY_ADMIN` (đã có
 *   trong `FARM_NOTICE_CODES`) — đọc lại ở `buildAdminAuditNotices` trong
 *   `farm-me.service.ts` (nhánh mới được thêm trong CHÍNH task này).
 *
 * Đặt lại nông trại (`previewResetFarm`/`resetFarmByAdmin`, US-44):
 * - `previewResetFarm`: KHÔNG ghi gì — chỉ tính và trả danh sách phần giữ
 *   lại (ngày vào làm, thâm niên, mốc Cây OCB, thành tựu, huy hiệu đang
 *   chọn) / phần bị mất (vật nuôi, cây trồng, trang trí, kho, Hạt OCB,
 *   chuỗi check-in, vùng đất đã mở) để UI dựng hộp xác nhận hai bước (xác
 *   nhận hai bước là UI concern — API chỉ cần hỗ trợ xem trước chính xác).
 * - `resetFarmByAdmin`: snapshot TOÀN BỘ dòng `farm_states` hiện tại vào
 *   `farm_admin_audit.before_value` (đủ để khôi phục thủ công nếu cần), xây
 *   `state` mới bằng {@link buildInitialFarmStateJson} (tái dùng ĐÚNG công
 *   thức nông trại khởi điểm của `POST /me/init`, task 4.3 — không chép lại
 *   một bản sao có thể trôi lệch) nhưng GHI ĐÈ `tree` và `badges_shown`
 *   bằng giá trị hiện tại (giữ nguyên mốc Cây OCB và huy hiệu đang chọn) —
 *   `farm_achievements` (bảng riêng, US-29) KHÔNG bị đụng tới vì không nằm
 *   trong `state` JSONB, nên "giữ nguyên thành tựu" tự động đúng mà không
 *   cần code thêm. `persistFarmState` (seeds về `initial_seeds`, tăng
 *   `version`), `appendFarmTransaction` (`kind: 'admin_reset'`, số dư sau =
 *   `initial_seeds`), `INSERT farm_admin_audit` (`action: 'reset_farm'`).
 * - Tạo thông báo cho nhân viên bằng mã `FARM_RESET_BY_ADMIN`.
 *
 * Quy tắc hợp lệ của ngày vào làm (BR-7) PHẢI khớp đúng phía nhân viên: cùng
 * khoảng [01/01/`ocb_founded_year`, hôm nay theo UTC+7]. Thay vì chép lại
 * logic validate, module này tái dùng {@link validateAdminJoinDate} — một
 * phiên bản export của logic trong `farm-init.service.ts` (hàm gốc
 * `validateJoinDate` không export, nên module này định nghĩa lại đúng công
 * thức bằng cùng `getFarmConfigValue('ocb_founded_year')` và `startOfDayVN`
 * — không chép hằng số năm thành lập, luôn đọc từ cấu hình).
 *
 * Sửa ngày vào làm:
 * - Đặt `join_date_admin_locked = true` (BR-8: một khi admin đã sửa, nhãn
 *   nguồn "do nhân viên tự khai" không áp dụng được nữa — nhân viên không tự
 *   sửa lại được nữa, chỉ admin mới sửa tiếp).
 * - Thâm niên và mốc Cây OCB (`milestone`, `branches`) được tính lại NGAY
 *   bằng `farm-seniority.ts` và ghi vào `state.tree` trong CÙNG transaction —
 *   để `GET /me` ngay sau đó phản ánh đúng mà không cần đợi lượt tick kế
 *   tiếp (khớp AC "trả thâm niên và mốc Cây OCB tính lại ngay" của US-42).
 * - Thành tựu, huy hiệu và vật phẩm (`animals`, `plants`, `decors`,
 *   `storage`, `badges_shown`, `counters`) KHÔNG bị đụng tới — chỉ sửa
 *   `join_date`, `join_date_source`, `join_date_admin_locked` và
 *   `state.tree`, giữ nguyên mọi phần khác của `state` (khớp AC "giữ nguyên
 *   thành tựu, huy hiệu và vật phẩm khi thâm niên giảm").
 * - Ghi `farm_admin_audit` với `action = 'update_join_date'`,
 *   `before_value`/`after_value` là `{ join_date, join_date_source }`.
 * - Tạo thông báo cho nhân viên bằng mã `JOIN_DATE_ADJUSTED_BY_ADMIN` (đã có
 *   trong `FARM_NOTICE_CODES`) — lưu vào `farm_admin_audit` nên không cần
 *   bảng/cột mới: `farm-me.service.ts` (phần `notices` của `GET /me`) đọc
 *   các dòng `farm_admin_audit` của `target_user_id = userId` xảy ra sau
 *   `last_seen_at` hiện tại để dựng notice một lần — việc wire đọc lại ở
 *   `GET /me` được thêm trong CHÍNH task này (không đợi task 8.x khác) để
 *   AC "tạo thông báo cho nhân viên" có hiệu lực thật, không chỉ là một cột
 *   chết trong `farm_admin_audit`.
 *
 * _Requirements: US-42, BR-7, BR-8, BR-26, BR-27_
 */

import { PoolClient } from 'pg';
import { pool } from '../../config/database';
import { nowVN, startOfDayVN } from './farm-calendar';
import { FarmConfigError, getFarmConfigValue } from './farm-config.service';
import { buildInitialFarmStateJson } from './farm-init.service';
import { branchCount, milestoneIndex, seniority, type FarmSeniorityConfig } from './farm-seniority';
import {
  appendFarmTransaction,
  persistFarmState,
  readFarmStateForUpdate,
} from './farm-state.repository';
import type {
  FarmAdminAuditLogItem,
  FarmAdminAuditLogPage,
  FarmAdminAuditQuery,
  FarmAdminJoinDatePatchRequest,
  FarmAdminJoinDatePatchResponse,
  FarmAdminResetPreview,
  FarmAdminResetPreviewItem,
  FarmAdminResetRequest,
  FarmAdminResetResponse,
  FarmAdminSeedsAdjustRequest,
  FarmAdminSeedsAdjustResponse,
  FarmAdminStatsCheckinByDay,
  FarmAdminStatsPopularEntry,
  FarmAdminStatsQuery,
  FarmAdminStatsResponse,
  FarmAdminStatsSeniorityBucket,
  FarmAdminUserListItem,
  FarmAdminUserListPage,
  FarmSeniority,
  FarmStateJson,
} from '../../types/ocb-farm.types';

// ============================================================================
// `GET /admin/users` — tìm nhân viên theo tên hoặc phòng ban (US-42)
// ============================================================================

/** Kích thước trang mặc định/tối đa — cùng giá trị đã dùng ở `farm-ledger.service.ts` (US-21). */
export const ADMIN_USERS_DEFAULT_PAGE_SIZE = 20;
export const ADMIN_USERS_MAX_PAGE_SIZE = 100;

/** Tham số truy vấn thô của `GET /admin/users`. */
export interface AdminUsersQuery {
  /** Tìm theo tên hoặc tên đăng nhập — khớp một phần, không phân biệt hoa/thường. */
  q?: string;
  department_id?: string;
  page?: string;
  page_size?: string;
}

function parsePositiveIntOrThrow(raw: string | undefined, defaultValue: number, fieldName: string): number {
  if (raw === undefined || raw === '') {
    return defaultValue;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new FarmConfigError(
      'INVALID_PAYLOAD',
      `Giá trị "${fieldName}" phải là số nguyên dương.`,
      { field: fieldName, value: raw },
    );
  }
  return parsed;
}

interface AdminUserRow {
  user_id: number;
  full_name: string | null;
  username: string;
  department_id: number | null;
  department_name: string | null;
  has_farm: boolean;
  join_date: Date | null;
  join_date_source: FarmAdminUserListItem['join_date_source'];
  join_date_admin_locked: boolean | null;
}

/**
 * Chuyển `DATE` của Postgres thành `YYYY-MM-DD` — đọc theo giờ ĐỊA PHƯƠNG của tiến trình
 * Node (server luôn chạy giờ Việt Nam), KHÔNG dùng `toISOString()` (quy đổi UTC, lùi mất
 * 1 ngày so với local UTC+7). Xem giải thích đầy đủ ở hàm cùng tên trong
 * `farm-state.repository.ts` (nguồn chân lý của bug này).
 */
function dateOnlyToIsoDateString(value: Date | null): string | null {
  if (value === null) return null;
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function seniorityConfigFrom(values: Record<string, number>): FarmSeniorityConfig {
  return {
    treeMaxMilestone: values['tree_max_milestone'] ?? 40,
    treeMaxBranches: values['tree_max_branches'] ?? 30,
  };
}

function buildSeniorityView(
  joinDate: string | null,
  now: Date,
  config: FarmSeniorityConfig,
): FarmSeniority | null {
  if (joinDate === null) {
    return null;
  }

  const joinDateObj = new Date(`${joinDate}T00:00:00.000Z`);
  const s = seniority(joinDateObj, now);
  const milestone = milestoneIndex(joinDateObj, now, config);
  const branches = branchCount(joinDateObj, now, config);

  return {
    join_date: joinDate,
    years: s.years,
    months: s.months,
    total_months: s.totalMonths,
    milestone,
    branches,
    // `GET /admin/users` chỉ cần thâm niên hiện tại để admin đối chiếu khi
    // tìm nhân viên — "số ngày tới mốc kế tiếp" không cần ở danh sách tìm
    // kiếm (chỉ có ý nghĩa ở `ocb-tree-panel` phía nhân viên, US-5), nên
    // không tính `daysToNextMilestone` ở đây để tránh một lệ thuộc không
    // cần thiết.
    days_to_next_milestone: null,
    at_max_milestone: milestone >= config.treeMaxMilestone,
  };
}

/**
 * Tìm nhân viên theo tên (hoặc tên đăng nhập) hoặc phòng ban, phân trang.
 *
 * Khi không có kết quả nào khớp, trả về trang hợp lệ với `items: []`,
 * `total: 0`, `has_more: false` — trạng thái "không có kết quả rõ ràng"
 * (US-42) là trách nhiệm hiển thị của frontend (trang quản trị, task sau),
 * response ở đây chỉ cần phân biệt được rõ ràng "không có" khỏi "lỗi".
 *
 * _Requirements: US-42_
 */
export async function searchAdminUsers(query: AdminUsersQuery): Promise<FarmAdminUserListPage> {
  const page = parsePositiveIntOrThrow(query.page, 1, 'page');
  const requestedPageSize = parsePositiveIntOrThrow(query.page_size, ADMIN_USERS_DEFAULT_PAGE_SIZE, 'page_size');
  const pageSize = Math.min(requestedPageSize, ADMIN_USERS_MAX_PAGE_SIZE);
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  const q = query.q?.trim();
  if (q) {
    conditions.push('(u.full_name ILIKE $' + idx + ' OR u.username ILIKE $' + idx + ')');
    values.push('%' + q + '%');
    idx++;
  }

  if (query.department_id !== undefined && query.department_id !== '') {
    const departmentId = Number(query.department_id);
    if (!Number.isInteger(departmentId)) {
      throw new FarmConfigError(
        'INVALID_PAYLOAD',
        'Giá trị "department_id" phải là số nguyên.',
        { field: 'department_id', value: query.department_id },
      );
    }
    conditions.push('u.department_id = $' + idx);
    values.push(departmentId);
    idx++;
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const listSql =
    `SELECT u.id AS user_id, u.full_name, u.username, u.department_id, d.name AS department_name,
            (fs.user_id IS NOT NULL) AS has_farm,
            fs.join_date, fs.join_date_source, fs.join_date_admin_locked
     FROM users u
     LEFT JOIN departments d ON d.id = u.department_id
     LEFT JOIN farm_states fs ON fs.user_id = u.id
     ${whereClause}
     ORDER BY u.full_name ASC NULLS LAST, u.username ASC
     LIMIT $` + idx + ' OFFSET $' + (idx + 1);
  const listValues = [...values, pageSize, offset];

  const countSql = `SELECT COUNT(*) AS total FROM users u ${whereClause}`;

  const [listResult, countResult] = await Promise.all([
    pool.query<AdminUserRow>(listSql, listValues),
    pool.query<{ total: string }>(countSql, values),
  ]);

  const now = nowVN();
  const seniorityConfig = seniorityConfigFrom({
    tree_max_milestone: await getFarmConfigValue('tree_max_milestone'),
    tree_max_branches: await getFarmConfigValue('tree_max_branches'),
  });

  const items: FarmAdminUserListItem[] = listResult.rows.map((row) => {
    const joinDate = dateOnlyToIsoDateString(row.join_date);
    return {
      user_id: row.user_id,
      full_name: row.full_name || row.username || '',
      username: row.username,
      department_id: row.department_id,
      department_name: row.department_name,
      has_farm: row.has_farm,
      join_date: joinDate,
      join_date_source: row.join_date_source,
      join_date_admin_locked: row.join_date_admin_locked ?? false,
      seniority: buildSeniorityView(joinDate, now, seniorityConfig),
    };
  });

  const total = Number(countResult.rows[0]?.total ?? 0);

  return {
    items,
    page,
    page_size: pageSize,
    total,
    has_more: offset + items.length < total,
  };
}

// ============================================================================
// `PATCH /admin/users/:id/join-date` — sửa ngày vào làm (US-42, BR-7, BR-8, BR-27)
// ============================================================================

/** Trả khoảng ngày vào làm hợp lệ — PHẢI khớp đúng `getJoinDateRange` ở `farm-init.service.ts` (BR-7). */
async function getJoinDateRangeForAdmin(now: Date): Promise<{ minDate: string; maxDate: string }> {
  const foundedYear = await getFarmConfigValue('ocb_founded_year');
  const minDate = `${Math.trunc(foundedYear)}-01-01`;
  const maxDate = startOfDayVN(now).toISOString().slice(0, 10);
  return { minDate, maxDate };
}

/** Phân tích `YYYY-MM-DD` ở đúng mốc 00:00:00 giờ Việt Nam — xem giải thích ở `farm-init.service.ts`. */
function parseJoinDateVN(dateStr: string | undefined | null): Date | null {
  if (!dateStr) return null;
  const parsed = new Date(`${dateStr}T00:00:00+07:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

/**
 * Xác thực `join_date` theo đúng quy tắc hợp lệ áp dụng cho nhân viên (BR-7):
 * nằm trong khoảng [01/01/`ocb_founded_year`, hôm nay theo UTC+7].
 *
 * Ném {@link FarmConfigError} `JOIN_DATE_REQUIRED` khi thiếu/rỗng/sai định
 * dạng, hoặc `JOIN_DATE_OUT_OF_RANGE` khi ngoài khoảng — cùng mã lỗi dùng ở
 * `farm-init.service.ts` để frontend xử lý nhất quán cho cả hai luồng.
 *
 * _Requirements: US-42, BR-7_
 */
async function validateAdminJoinDate(joinDate: string | undefined | null, now: Date): Promise<Date> {
  if (!joinDate || joinDate.trim() === '') {
    throw new FarmConfigError('JOIN_DATE_REQUIRED', 'Vui lòng chọn ngày vào làm.');
  }

  const parsed = parseJoinDateVN(joinDate);
  if (parsed === null) {
    throw new FarmConfigError('JOIN_DATE_REQUIRED', 'Ngày vào làm không đúng định dạng.');
  }

  const { minDate, maxDate } = await getJoinDateRangeForAdmin(now);
  const minParsed = parseJoinDateVN(minDate)!;
  const maxParsed = parseJoinDateVN(maxDate)!;

  if (parsed.getTime() < minParsed.getTime() || parsed.getTime() > maxParsed.getTime()) {
    throw new FarmConfigError(
      'JOIN_DATE_OUT_OF_RANGE',
      `Ngày vào làm phải trong khoảng từ ${minDate} đến ${maxDate}.`,
      { min_date: minDate, max_date: maxDate },
    );
  }

  return parsed;
}

/** Lỗi nghiệp vụ khi nhân viên đích chưa có nông trại — không có gì để sửa. */
export class FarmAdminTargetNotFoundError extends Error {
  readonly code = 'TARGET_FARM_NOT_FOUND' as const;
  constructor() {
    super('Nhân viên này chưa có nông trại nên không có ngày vào làm để sửa.');
  }
}

/**
 * Cập nhật `state.tree` (milestone/branches) theo đúng `joinDate`/`now` mới
 * — áp dụng NGAY trong transaction sửa ngày vào làm, không chờ lượt tick kế
 * tiếp. Chỉ sửa khóa `tree`, giữ nguyên mọi phần khác của `state`
 * (animals/plants/decors/storage/badges_shown/counters) — khớp AC "giữ
 * nguyên thành tựu, huy hiệu và vật phẩm khi thâm niên giảm".
 */
function recomputeTreeState(
  state: FarmStateJson,
  joinDateObj: Date,
  now: Date,
  config: FarmSeniorityConfig,
): FarmStateJson {
  return {
    ...state,
    tree: {
      milestone: milestoneIndex(joinDateObj, now, config),
      branches: branchCount(joinDateObj, now, config),
      last_evaluated_at: now.toISOString(),
    },
  };
}

/**
 * Sửa ngày vào làm của nhân viên `targetUserId` theo yêu cầu của quản trị
 * viên `adminUserId`.
 *
 * Thứ tự thực hiện:
 * 1. Validate `join_date` mới theo đúng khoảng hợp lệ (BR-7) TRƯỚC khi mở
 *    transaction.
 * 2. `BEGIN` → khóa dòng `farm_states` của nhân viên đích bằng
 *    `readFarmStateForUpdate` → nếu không tồn tại, `ROLLBACK` và ném
 *    {@link FarmAdminTargetNotFoundError}.
 * 3. Tính lại `state.tree` theo ngày vào làm mới, `UPDATE farm_states` với
 *    `join_date`, `join_date_source = 'admin'`, `join_date_admin_locked =
 *    true`, `state` mới — KHÔNG tăng `version` một cách "nghiệp vụ cạnh
 *    tranh" vì đây là admin ghi đè trực tiếp cột, không phải lệnh
 *    `POST /commands`; vẫn tăng `version + 1` để các phiên client đang mở
 *    (polling `/me`) nhận ra trạng thái đã đổi khi họ gửi lệnh kế tiếp với
 *    `version` cũ (409 kèm state mới nhất, D3).
 * 4. Ghi `farm_admin_audit` với `before_value`/`after_value` là
 *    `{ join_date, join_date_source }`, `COMMIT`.
 *
 * _Requirements: US-42, BR-7, BR-8, BR-26, BR-27_
 */
export async function updateJoinDateByAdmin(
  adminUserId: number,
  targetUserId: number,
  request: FarmAdminJoinDatePatchRequest,
): Promise<FarmAdminJoinDatePatchResponse> {
  const now = nowVN();

  // Bước 1 — validate TRƯỚC khi chạm DB.
  const newJoinDateObj = await validateAdminJoinDate(request.join_date, now);

  const seniorityConfig = seniorityConfigFrom({
    tree_max_milestone: await getFarmConfigValue('tree_max_milestone'),
    tree_max_branches: await getFarmConfigValue('tree_max_branches'),
  });

  const client: PoolClient = await pool.connect();
  let previousJoinDate: string | null;
  let previousJoinDateSource: FarmAdminJoinDatePatchResponse['join_date_source'] | null;
  let auditId: number;
  let newState: FarmStateJson;

  try {
    await client.query('BEGIN');

    const row = await readFarmStateForUpdate(client, targetUserId);
    if (row === null) {
      await client.query('ROLLBACK');
      throw new FarmAdminTargetNotFoundError();
    }

    previousJoinDate = row.join_date;
    previousJoinDateSource = row.join_date_source;

    newState = recomputeTreeState(row.state, newJoinDateObj, now, seniorityConfig);

    await client.query(
      `UPDATE farm_states
       SET join_date = $1,
           join_date_source = 'admin',
           join_date_admin_locked = true,
           state = $2,
           version = version + 1,
           updated_at = NOW()
       WHERE user_id = $3`,
      [request.join_date, JSON.stringify(newState), targetUserId],
    );

    const auditResult = await client.query<{ id: number }>(
      `INSERT INTO farm_admin_audit
         (admin_user_id, target_user_id, action, before_value, after_value, reason)
       VALUES ($1, $2, 'update_join_date', $3, $4, $5)
       RETURNING id`,
      [
        adminUserId,
        targetUserId,
        JSON.stringify({ join_date: previousJoinDate, join_date_source: previousJoinDateSource }),
        JSON.stringify({ join_date: request.join_date, join_date_source: 'admin' }),
        request.reason ?? null,
      ],
    );
    auditId = auditResult.rows[0]!.id;

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const seniorityView = buildSeniorityView(request.join_date, now, seniorityConfig)!;

  return {
    user_id: targetUserId,
    join_date: request.join_date,
    join_date_source: 'admin',
    join_date_admin_locked: true,
    previous_join_date: previousJoinDate,
    seniority: seniorityView,
    tree: newState.tree,
    audit_id: auditId,
  };
}

// ============================================================================
// `POST /admin/users/:id/seeds` — điều chỉnh Hạt OCB (US-43, BR-9, BR-26, BR-27)
// ============================================================================

/**
 * Xác thực `reason`/`amount` của yêu cầu điều chỉnh Hạt OCB TRƯỚC khi chạm DB.
 *
 * Ném {@link FarmConfigError}:
 * - `ADMIN_REASON_TOO_SHORT` khi `reason` thiếu hoặc ngắn hơn `admin_reason_min_len`.
 * - `ADMIN_ADJUST_INVALID_AMOUNT` khi `amount` không phải số nguyên hoặc bằng 0.
 * - `ADMIN_ADJUST_LIMIT_EXCEEDED` khi `|amount| > admin_adjust_max`.
 *
 * _Requirements: US-43_
 */
async function validateSeedsAdjustRequest(
  request: FarmAdminSeedsAdjustRequest,
): Promise<{ reason: string; amount: number }> {
  const reason = (request.reason ?? '').trim();
  const minLen = await getFarmConfigValue('admin_reason_min_len');
  if (reason.length < minLen) {
    throw new FarmConfigError(
      'ADMIN_REASON_TOO_SHORT',
      `Lý do điều chỉnh phải có ít nhất ${minLen} ký tự.`,
      { min_length: minLen },
    );
  }

  const amount = request.amount;
  if (!Number.isInteger(amount) || amount === 0) {
    throw new FarmConfigError(
      'ADMIN_ADJUST_INVALID_AMOUNT',
      'Mức điều chỉnh phải là số nguyên khác 0.',
      { amount: request.amount },
    );
  }

  const maxAdjust = await getFarmConfigValue('admin_adjust_max');
  if (Math.abs(amount) > maxAdjust) {
    throw new FarmConfigError(
      'ADMIN_ADJUST_LIMIT_EXCEEDED',
      `Mức điều chỉnh không được vượt quá ${maxAdjust} Hạt OCB.`,
      { max: maxAdjust, amount },
    );
  }

  return { reason, amount };
}

interface AdminAuditRowForReplay {
  id: number;
  before_value: { balance_before?: number; reason?: string } | null;
  after_value: { balance_after?: number; amount?: number } | null;
}

/**
 * Tìm dòng `farm_admin_audit` đã ghi trước đó cho `(action, idempotencyKey)`
 * — dùng để phát hiện request lặp lại (replay) TRƯỚC khi mở transaction áp
 * dụng, theo đúng ràng buộc `uq_farm_admin_audit_action_idem` đã có sẵn
 * trong `20261001_009_create_farm_admin_audit.sql`.
 */
async function findExistingAdminAudit(
  action: string,
  idempotencyKey: string,
): Promise<AdminAuditRowForReplay | null> {
  const result = await pool.query<AdminAuditRowForReplay>(
    `SELECT id, before_value, after_value
     FROM farm_admin_audit
     WHERE action = $1 AND idempotency_key = $2`,
    [action, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

/**
 * Điều chỉnh số dư Hạt OCB của nhân viên `targetUserId` theo yêu cầu của
 * quản trị viên `adminUserId`.
 *
 * `idempotencyKey` đến từ header `Idempotency-Key` (route, task này) —
 * `undefined`/rỗng nghĩa là không áp dụng bảo đảm chống lặp (không khuyến
 * khích, nhưng không chặn, vì AC chỉ yêu cầu bảo đảm khi header được gửi).
 *
 * _Requirements: US-43, BR-9, BR-26, BR-27_
 */
export async function adjustSeedsByAdmin(
  adminUserId: number,
  targetUserId: number,
  request: FarmAdminSeedsAdjustRequest,
  idempotencyKey: string | undefined,
): Promise<FarmAdminSeedsAdjustResponse> {
  // Bước 1 — validate TRƯỚC khi chạm DB.
  const { reason, amount } = await validateSeedsAdjustRequest(request);

  // Bước 2 — phát hiện replay bằng khóa idempotency đã ghi trước đó.
  if (idempotencyKey) {
    const existing = await findExistingAdminAudit('adjust_seeds', idempotencyKey);
    if (existing) {
      return {
        user_id: targetUserId,
        amount: existing.after_value?.amount ?? amount,
        reason: existing.before_value?.reason ?? reason,
        balance_before: existing.before_value?.balance_before ?? 0,
        balance_after: existing.after_value?.balance_after ?? 0,
        audit_id: existing.id,
        transaction_id: null,
        replayed: true,
      };
    }
  }

  const now = nowVN();
  const client: PoolClient = await pool.connect();
  let balanceBefore: number;
  let balanceAfter: number;
  let auditId: number;
  let transactionId: number | null;

  try {
    await client.query('BEGIN');

    const row = await readFarmStateForUpdate(client, targetUserId);
    if (row === null) {
      await client.query('ROLLBACK');
      throw new FarmAdminTargetNotFoundError();
    }

    balanceBefore = row.seeds;
    balanceAfter = balanceBefore + amount;

    if (balanceAfter < 0) {
      await client.query('ROLLBACK');
      throw new FarmConfigError(
        'ADMIN_ADJUST_NEGATIVE_BALANCE',
        'Không thể điều chỉnh vì số dư sau khi trừ sẽ nhỏ hơn 0.',
        { balance_before: balanceBefore, amount },
      );
    }

    await persistFarmState(client, {
      userId: targetUserId,
      state: row.state,
      seeds: balanceAfter,
      incrementVersion: true,
      lastTickAt: now,
    });

    transactionId = await appendFarmTransaction(client, {
      userId: targetUserId,
      kind: 'admin_adjust',
      amount,
      balanceAfter,
      refType: 'admin_adjust_seeds',
      note: reason,
      actorUserId: adminUserId,
      idempotencyKey,
    });

    const auditResult = await client.query<{ id: number }>(
      `INSERT INTO farm_admin_audit
         (admin_user_id, target_user_id, action, before_value, after_value, reason, idempotency_key)
       VALUES ($1, $2, 'adjust_seeds', $3, $4, $5, $6)
       RETURNING id`,
      [
        adminUserId,
        targetUserId,
        JSON.stringify({ balance_before: balanceBefore, reason }),
        JSON.stringify({ balance_after: balanceAfter, amount }),
        reason,
        idempotencyKey ?? null,
      ],
    );
    auditId = auditResult.rows[0]!.id;

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return {
    user_id: targetUserId,
    amount,
    reason,
    balance_before: balanceBefore,
    balance_after: balanceAfter,
    audit_id: auditId,
    transaction_id: transactionId,
    replayed: false,
  };
}

// ============================================================================
// `POST /admin/users/:id/reset` — đặt lại nông trại (US-44, BR-26, BR-27)
// ============================================================================

/**
 * Dựng danh sách phần giữ lại / phần bị mất khi đặt lại nông trại của
 * `row` — dùng chung cho cả xem trước (`previewResetFarm`) và kết quả thật
 * (`resetFarmByAdmin`), để hai luồng không bao giờ hiển thị khác nhau.
 *
 * _Requirements: US-44_
 */
function buildResetPreviewItems(
  state: FarmStateJson,
  achievementCount: number,
): { kept: FarmAdminResetPreviewItem[]; lost: FarmAdminResetPreviewItem[] } {
  const unlockedPlotCount = state.plots.filter((plot) => plot.unlocked).length;

  const kept: FarmAdminResetPreviewItem[] = [
    { label: 'Ngày vào làm và thâm niên' },
    {
      label: 'Mốc Cây OCB',
      detail: `Mốc ${state.tree.milestone}, ${state.tree.branches} nhánh`,
    },
    {
      label: 'Thành tựu đã đạt',
      detail: `${achievementCount} thành tựu`,
    },
    {
      label: 'Huy hiệu đang chọn hiển thị',
      detail: `${state.badges_shown.length} huy hiệu`,
    },
  ];

  const lost: FarmAdminResetPreviewItem[] = [
    { label: 'Số dư Hạt OCB hiện tại', detail: 'Trở về số Hạt OCB khởi điểm' },
    { label: 'Vật nuôi', detail: `${state.animals.length} con` },
    { label: 'Cây trồng', detail: `${state.plants.length} cây` },
    { label: 'Vật phẩm trang trí', detail: `${state.decors.length} vật phẩm` },
    { label: 'Sản phẩm trong kho' },
    { label: 'Chuỗi check-in hiện tại' },
    {
      label: 'Vùng đất đã mở rộng',
      detail: `${unlockedPlotCount} vùng — trở về 1 vùng khởi đầu`,
    },
  ];

  return { kept, lost };
}

async function countAchievements(userId: number): Promise<number> {
  const result = await pool.query<{ count: string }>(
    'SELECT COUNT(*) AS count FROM farm_achievements WHERE user_id = $1',
    [userId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

/**
 * Trả danh sách phần giữ lại / phần bị mất khi đặt lại nông trại của
 * `targetUserId`, KHÔNG ghi gì vào DB — phục vụ UI dựng hộp xác nhận hai
 * bước trước khi gọi {@link resetFarmByAdmin}.
 *
 * _Requirements: US-44_
 */
export async function previewResetFarm(targetUserId: number): Promise<FarmAdminResetPreview> {
  const row = await pool.query<{ state: FarmStateJson }>(
    'SELECT state FROM farm_states WHERE user_id = $1',
    [targetUserId],
  );
  const stateRow = row.rows[0];
  if (!stateRow) {
    throw new FarmAdminTargetNotFoundError();
  }

  const achievementCount = await countAchievements(targetUserId);
  const { kept, lost } = buildResetPreviewItems(stateRow.state, achievementCount);

  return { user_id: targetUserId, kept, lost };
}

/**
 * Đặt lại nông trại của `targetUserId` về trạng thái khởi tạo, giữ nguyên
 * ngày vào làm, thâm niên, mốc Cây OCB (`state.tree`), thành tựu
 * (`farm_achievements`, bảng riêng — không bị đụng tới) và huy hiệu đang
 * chọn (`state.badges_shown`).
 *
 * Snapshot TOÀN BỘ dòng `farm_states` hiện tại (trước khi đổi) vào
 * `farm_admin_audit.before_value` để hỗ trợ khôi phục thủ công nếu cần.
 *
 * _Requirements: US-44, BR-9, BR-26, BR-27_
 */
export async function resetFarmByAdmin(
  adminUserId: number,
  targetUserId: number,
  request: FarmAdminResetRequest,
): Promise<FarmAdminResetResponse> {
  const now = nowVN();
  const reason = request.reason?.trim() || null;
  const initialSeeds = Math.trunc(await getFarmConfigValue('initial_seeds'));

  const client: PoolClient = await pool.connect();
  let newState: FarmStateJson;
  let auditId: number;
  let achievementCount: number;
  let newVersion: number;

  try {
    await client.query('BEGIN');

    const row = await readFarmStateForUpdate(client, targetUserId);
    if (row === null) {
      await client.query('ROLLBACK');
      throw new FarmAdminTargetNotFoundError();
    }

    // Snapshot đầy đủ TRƯỚC khi đổi — đủ dữ liệu để khôi phục thủ công.
    const beforeSnapshot = {
      farm_name: row.farm_name,
      join_date: row.join_date,
      join_date_source: row.join_date_source,
      join_date_admin_locked: row.join_date_admin_locked,
      seeds: row.seeds,
      checkin_streak: row.checkin_streak,
      last_checkin_date: row.last_checkin_date,
      total_assets_cached: row.total_assets_cached,
      state: row.state,
      settings: row.settings,
      version: row.version,
    };

    // Nông trại khởi điểm — tái dùng ĐÚNG công thức của `POST /me/init`, chỉ
    // ghi đè `tree` và `badges_shown` để giữ nguyên mốc Cây OCB và huy hiệu.
    const freshState = buildInitialFarmStateJson(now);
    newState = {
      ...freshState,
      tree: row.state.tree,
      badges_shown: row.state.badges_shown,
    };

    await persistFarmState(client, {
      userId: targetUserId,
      state: newState,
      seeds: initialSeeds,
      incrementVersion: true,
      lastTickAt: now,
    });

    await client.query(
      `UPDATE farm_states
       SET checkin_streak = 0,
           last_checkin_date = NULL
       WHERE user_id = $1`,
      [targetUserId],
    );

    await appendFarmTransaction(client, {
      userId: targetUserId,
      kind: 'admin_reset',
      amount: initialSeeds - row.seeds,
      balanceAfter: initialSeeds,
      refType: 'admin_reset_farm',
      note: reason ?? 'Đặt lại nông trại bởi quản trị viên',
      actorUserId: adminUserId,
    });

    const auditResult = await client.query<{ id: number }>(
      `INSERT INTO farm_admin_audit
         (admin_user_id, target_user_id, action, before_value, after_value, reason)
       VALUES ($1, $2, 'reset_farm', $3, $4, $5)
       RETURNING id`,
      [
        adminUserId,
        targetUserId,
        JSON.stringify(beforeSnapshot),
        JSON.stringify({ state: newState, seeds: initialSeeds }),
        reason,
      ],
    );
    auditId = auditResult.rows[0]!.id;
    newVersion = row.version + 1;

    await client.query('COMMIT');

    achievementCount = await countAchievements(targetUserId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const { kept, lost } = buildResetPreviewItems(newState, achievementCount);

  return {
    user_id: targetUserId,
    kept,
    lost,
    seeds: initialSeeds,
    state: newState,
    version: newVersion,
    audit_id: auditId,
  };
}

// ============================================================================
// `GET /admin/stats` — thống kê sử dụng, lọc theo phòng ban (US-46)
// ============================================================================

/** Kích thước cửa sổ "lượt check-in theo ngày" — 30 ngày gần nhất theo giờ Việt Nam. */
const STATS_CHECKIN_WINDOW_DAYS = 30;

/** Số khoảng thâm niên hiển thị trong phân bố — ví dụ "0-1 năm" .. "4-5 năm" .. "5+ năm". */
const SENIORITY_BUCKET_MAX_YEARS = 5;

function buildDepartmentFilter(departmentId: number | null, paramIndex: number): { clause: string; value?: number } {
  if (departmentId === null) {
    return { clause: '' };
  }
  return { clause: ' AND u.department_id = $' + paramIndex, value: departmentId };
}

/** Phân tích `department_id` thô từ query string — `undefined`/rỗng nghĩa là không lọc. */
function parseDepartmentIdOrThrow(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new FarmConfigError(
      'INVALID_PAYLOAD',
      'Giá trị "department_id" phải là số nguyên.',
      { field: 'department_id', value: raw },
    );
  }
  return parsed;
}

interface FarmStateForStatsRow {
  state: FarmStateJson;
  join_date: Date | null;
}

/** Khoảng thâm niên cố định dùng để dựng `seniority_distribution` — nhãn tiếng Việt. */
function seniorityBucketDefinitions(): Array<{ label: string; minYears: number; maxYears: number | null }> {
  const buckets: Array<{ label: string; minYears: number; maxYears: number | null }> = [];
  for (let y = 0; y < SENIORITY_BUCKET_MAX_YEARS; y++) {
    buckets.push({ label: `${y}-${y + 1} năm`, minYears: y, maxYears: y + 1 });
  }
  buckets.push({ label: `${SENIORITY_BUCKET_MAX_YEARS}+ năm`, minYears: SENIORITY_BUCKET_MAX_YEARS, maxYears: null });
  return buckets;
}

/**
 * Đếm loài vật nuôi / loại cây phổ biến nhất, hạng cao nhất đứng đầu danh
 * sách — tính trong application code trên các dòng `state` JSONB đã lấy về
 * (cùng cách `buildLimits` ở `farm-me.service.ts` xử lý `state`, thay vì
 * viết một câu `jsonb_array_elements` phức tạp phải tự JOIN lại điều kiện
 * lọc phòng ban).
 */
function countMostPopular(
  rows: FarmStateForStatsRow[],
  pick: (state: FarmStateJson) => string[],
): FarmAdminStatsPopularEntry[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const code of pick(row.state)) {
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);
}

/** Dựng phân bố thâm niên theo khoảng năm cố định, từ danh sách `join_date` đã lọc. */
function buildSeniorityDistribution(
  rows: FarmStateForStatsRow[],
  now: Date,
): FarmAdminStatsSeniorityBucket[] {
  const buckets = seniorityBucketDefinitions();
  const counts = buckets.map(() => 0);

  for (const row of rows) {
    if (row.join_date === null) continue;
    const { years } = seniority(row.join_date, now);
    const bucketIndex = Math.min(years, SENIORITY_BUCKET_MAX_YEARS);
    counts[bucketIndex] = (counts[bucketIndex] ?? 0) + 1;
  }

  return buckets.map((bucket, index) => ({
    label: bucket.label,
    min_years: bucket.minYears,
    max_years: bucket.maxYears,
    count: counts[index] ?? 0,
  }));
}

/**
 * Trả thống kê sử dụng OCB Farm cho trang quản trị: tổng số nông trại, nhân
 * viên hoạt động 7/30 ngày, lượt check-in theo ngày (30 ngày gần nhất), loài
 * vật nuôi và loại cây phổ biến nhất, phân bố thâm niên — tất cả tính trực
 * tiếp mỗi lần gọi (không cache), lọc được theo phòng ban.
 *
 * Khi không có nông trại nào khớp bộ lọc, mọi mảng trả về rỗng và mọi số
 * đếm trả về 0 — không bao giờ `null` — để frontend tự quyết định hiển thị
 * trạng thái trống (US-46) mà không phải phân biệt "lỗi" khỏi "không có
 * dữ liệu".
 *
 * _Requirements: US-37, US-45, US-46, BR-26, BR-27_
 */
export async function getAdminStats(query: FarmAdminStatsQuery): Promise<FarmAdminStatsResponse> {
  const departmentId = parseDepartmentIdOrThrow(query.department_id);
  const now = nowVN();

  const deptFilterOnStates = buildDepartmentFilter(departmentId, 1);
  const deptParamsOnStates = deptFilterOnStates.value !== undefined ? [deptFilterOnStates.value] : [];

  const totalFarmsSql =
    `SELECT COUNT(*) AS total
     FROM farm_states fs
     JOIN users u ON u.id = fs.user_id
     WHERE 1=1${deptFilterOnStates.clause}`;

  const activeEmployeesSql = (days: number) =>
    `SELECT COUNT(DISTINCT fs.user_id) AS total
     FROM farm_states fs
     JOIN users u ON u.id = fs.user_id
     WHERE fs.last_seen_at >= NOW() - INTERVAL '${days} days'${deptFilterOnStates.clause}`;

  const stateRowsSql =
    `SELECT fs.state, fs.join_date
     FROM farm_states fs
     JOIN users u ON u.id = fs.user_id
     WHERE 1=1${deptFilterOnStates.clause}`;

  const checkinDeptFilter = buildDepartmentFilter(departmentId, 2);
  const checkinParams: unknown[] = [STATS_CHECKIN_WINDOW_DAYS];
  if (checkinDeptFilter.value !== undefined) checkinParams.push(checkinDeptFilter.value);

  const checkinsByDaySql =
    `SELECT fc.checkin_date, COUNT(*) AS total
     FROM farm_checkins fc
     JOIN users u ON u.id = fc.user_id
     WHERE fc.checkin_date >= (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - $1::int${checkinDeptFilter.clause}
     GROUP BY fc.checkin_date
     ORDER BY fc.checkin_date ASC`;

  const [totalFarmsResult, active7dResult, active30dResult, stateRowsResult, checkinsResult] = await Promise.all([
    pool.query<{ total: string }>(totalFarmsSql, deptParamsOnStates),
    pool.query<{ total: string }>(activeEmployeesSql(7), deptParamsOnStates),
    pool.query<{ total: string }>(activeEmployeesSql(30), deptParamsOnStates),
    pool.query<FarmStateForStatsRow>(stateRowsSql, deptParamsOnStates),
    pool.query<{ checkin_date: Date; total: string }>(checkinsByDaySql, checkinParams),
  ]);

  const stateRows = stateRowsResult.rows;

  const mostPopularAnimalSpecies = countMostPopular(stateRows, (state) =>
    state.animals.map((animal) => animal.species),
  );
  const mostPopularPlantKind = countMostPopular(stateRows, (state) => state.plants.map((plant) => plant.kind));
  const seniorityDistribution = buildSeniorityDistribution(stateRows, now);

  const checkinsByDay: FarmAdminStatsCheckinByDay[] = checkinsResult.rows.map((row) => ({
    // `row.checkin_date` là cột `DATE` do driver `pg` parse theo giờ địa phương (server
    // chạy giờ Việt Nam) — dùng `dateOnlyToIsoDateString` thay vì `toISOString()` để
    // không bị lùi mất 1 ngày (xem ghi chú đầy đủ ở định nghĩa hàm, đầu file này).
    date: dateOnlyToIsoDateString(row.checkin_date) ?? '',
    count: Number(row.total),
  }));

  return {
    department_id: departmentId,
    total_farms: Number(totalFarmsResult.rows[0]?.total ?? 0),
    active_employees_7d: Number(active7dResult.rows[0]?.total ?? 0),
    active_employees_30d: Number(active30dResult.rows[0]?.total ?? 0),
    checkins_by_day: checkinsByDay,
    most_popular_animal_species: mostPopularAnimalSpecies,
    most_popular_plant_kind: mostPopularPlantKind,
    seniority_distribution: seniorityDistribution,
    timezone_note: 'Mọi số liệu được tính theo giờ Việt Nam (UTC+7).',
    computed_at: now.toISOString(),
  };
}

// ============================================================================
// `GET /admin/audit` — xem dòng lưu vết, chỉ đọc, phân trang (BR-27)
// ============================================================================

export const ADMIN_AUDIT_DEFAULT_PAGE_SIZE = 20;
export const ADMIN_AUDIT_MAX_PAGE_SIZE = 100;

interface AdminAuditRow {
  id: number;
  admin_user_id: number;
  admin_full_name: string | null;
  admin_username: string;
  target_user_id: number | null;
  target_full_name: string | null;
  target_username: string | null;
  action: string;
  before_value: unknown;
  after_value: unknown;
  reason: string | null;
  occurred_at: Date;
}

/**
 * Trả danh sách dòng `farm_admin_audit`, phân trang, sắp xếp `occurred_at
 * DESC` (mới nhất trước), kèm `full_name`/`username` của admin và nhân
 * viên bị tác động (nhân viên bị tác động nullable — `update_config` không
 * nhắm vào một nhân viên cụ thể). Hỗ trợ lọc tuỳ chọn theo `target_user_id`
 * hoặc `action`. Chỉ đọc — không có hàm ghi nào trong module này.
 *
 * _Requirements: BR-27_
 */
export async function getAdminAuditPage(query: FarmAdminAuditQuery): Promise<FarmAdminAuditLogPage> {
  const page = parsePositiveIntOrThrow(query.page, 1, 'page');
  const requestedPageSize = parsePositiveIntOrThrow(query.page_size, ADMIN_AUDIT_DEFAULT_PAGE_SIZE, 'page_size');
  const pageSize = Math.min(requestedPageSize, ADMIN_AUDIT_MAX_PAGE_SIZE);
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (query.target_user_id !== undefined && query.target_user_id !== '') {
    const targetUserId = Number(query.target_user_id);
    if (!Number.isInteger(targetUserId)) {
      throw new FarmConfigError(
        'INVALID_PAYLOAD',
        'Giá trị "target_user_id" phải là số nguyên.',
        { field: 'target_user_id', value: query.target_user_id },
      );
    }
    conditions.push('a.target_user_id = $' + idx);
    values.push(targetUserId);
    idx++;
  }

  if (query.action !== undefined && query.action.trim() !== '') {
    conditions.push('a.action = $' + idx);
    values.push(query.action.trim());
    idx++;
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const listSql =
    `SELECT a.id, a.admin_user_id, admin_u.full_name AS admin_full_name, admin_u.username AS admin_username,
            a.target_user_id, target_u.full_name AS target_full_name, target_u.username AS target_username,
            a.action, a.before_value, a.after_value, a.reason, a.occurred_at
     FROM farm_admin_audit a
     JOIN users admin_u ON admin_u.id = a.admin_user_id
     LEFT JOIN users target_u ON target_u.id = a.target_user_id
     ${whereClause}
     ORDER BY a.occurred_at DESC
     LIMIT $` + idx + ' OFFSET $' + (idx + 1);
  const listValues = [...values, pageSize, offset];

  const countSql = `SELECT COUNT(*) AS total FROM farm_admin_audit a ${whereClause}`;

  const [listResult, countResult] = await Promise.all([
    pool.query<AdminAuditRow>(listSql, listValues),
    pool.query<{ total: string }>(countSql, values),
  ]);

  const items: FarmAdminAuditLogItem[] = listResult.rows.map((row) => ({
    id: row.id,
    admin_user_id: row.admin_user_id,
    admin_full_name: row.admin_full_name || row.admin_username || '',
    admin_username: row.admin_username,
    target_user_id: row.target_user_id,
    target_full_name: row.target_full_name,
    target_username: row.target_username,
    action: row.action,
    before_value: row.before_value,
    after_value: row.after_value,
    reason: row.reason,
    occurred_at: row.occurred_at.toISOString(),
  }));

  const total = Number(countResult.rows[0]?.total ?? 0);

  return {
    items,
    page,
    page_size: pageSize,
    total,
    has_more: offset + items.length < total,
  };
}
