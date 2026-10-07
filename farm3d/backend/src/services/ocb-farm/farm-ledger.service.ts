/**
 * OCB Farm — logic nghiệp vụ của `GET /api/ocb-farm/me/ledger`.
 *
 * Route Express thực tế (`backend/src/routes/ocb-farm.routes.ts`) chỉ gọi
 * {@link getLedgerPage} và định dạng response — theo đúng khuôn mẫu route
 * mỏng / service chứa logic đã dùng ở `farm-me.service.ts`, `farm-init.service.ts`.
 *
 * Phân trang (US-21): mỗi dòng gồm thời điểm, nội dung (`kind`), dấu tăng/giảm
 * (suy ra từ dấu của `amount`), số thay đổi và số dư sau giao dịch —
 * `farm_transactions` (task 1.1, migration `20261001_002`) đã có đủ các cột
 * này, nên service chỉ cần đọc đúng trang và tính tổng.
 *
 * Lựa chọn kích thước trang (page_size): mặc định 20, tối đa 100. Đây KHÔNG
 * phải một tham số cân bằng game (không ảnh hưởng tới kinh tế/tiến trình
 * nông trại) mà là một cơ chế phân trang HTTP thuần — do đó không thêm khóa
 * `farm_config` mới cho giá trị này (tránh làm phình bộ cấu hình cân bằng
 * game với các giá trị không liên quan tới cân bằng game); hardcode hằng số
 * ở đây là đủ, nhất quán với cách `farm-init.service.ts` hardcode
 * `HR_LOOKUP_TIMEOUT_MS`. US-21 chỉ yêu cầu "tối thiểu 50 giao dịch gần nhất"
 * truy cập được qua phân trang — mặc định 20/trang vẫn thoả vì nhân viên xem
 * thêm được các trang sau; 100 là trần hợp lý để một request không kéo quá
 * nhiều dữ liệu.
 *
 * _Requirements: US-21_
 */

import { pool } from '../../config/database';
import { FarmConfigError } from './farm-config.service';
import type { FarmLedgerEntry, FarmLedgerKind, FarmLedgerPage } from '../../types/ocb-farm.types';

/** Kích thước trang mặc định khi `page_size` không được truyền (US-21). */
export const LEDGER_DEFAULT_PAGE_SIZE = 20;

/** Kích thước trang tối đa cho phép, bất kể giá trị client truyền (US-21). */
export const LEDGER_MAX_PAGE_SIZE = 100;

/** Tham số phân trang đã qua xác thực của {@link getLedgerPage}. */
export interface LedgerQuery {
  /** Chuỗi thô từ query string — `undefined` nghĩa là không truyền (dùng mặc định). */
  page?: string;
  page_size?: string;
}

interface ParsedPagination {
  page: number;
  pageSize: number;
}

/**
 * Phân tích và xác thực `page`/`page_size` từ query string.
 *
 * Ném {@link FarmConfigError} với mã `INVALID_PAYLOAD` khi giá trị truyền vào
 * không phải số nguyên dương — tái dùng mã lỗi nghiệp vụ đã có trong
 * `FARM_ERROR_CODES` (không thêm mã mới chỉ cho mục đích phân trang), đúng
 * quy ước "mã lỗi là hợp đồng ổn định giữa backend/frontend" của
 * `ocb-farm.types.ts`.
 *
 * `page_size` vượt {@link LEDGER_MAX_PAGE_SIZE} bị CHẶN LẠI (không coi là
 * lỗi) — client gửi giá trị lớn tuỳ ý vẫn chỉ nhận tối đa 100 dòng/trang.
 *
 * _Requirements: US-21_
 */
function parsePagination(query: LedgerQuery): ParsedPagination {
  const page = parsePositiveIntOrThrow(query.page, 1, 'page');
  const requestedPageSize = parsePositiveIntOrThrow(query.page_size, LEDGER_DEFAULT_PAGE_SIZE, 'page_size');
  const pageSize = Math.min(requestedPageSize, LEDGER_MAX_PAGE_SIZE);
  return { page, pageSize };
}

function parsePositiveIntOrThrow(raw: string | undefined, defaultValue: number, fieldName: string): number {
  if (raw === undefined || raw === '') {
    return defaultValue;
  }

  // `Number()` (không `parseInt`) để từ chối chuỗi có ký tự thừa phía sau
  // số (ví dụ "2abc") — `parseInt` sẽ âm thầm chấp nhận các chuỗi đó.
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

interface LedgerRow {
  id: number;
  occurred_at: Date;
  kind: FarmLedgerKind;
  amount: string; // BIGINT trả về dạng string qua driver `pg`
  balance_after: string;
  ref_type: string | null;
  ref_id: string | null;
  note: string | null;
  actor_user_id: number | null;
}

function rowToLedgerEntry(row: LedgerRow): FarmLedgerEntry {
  return {
    id: row.id,
    occurred_at: row.occurred_at.toISOString(),
    kind: row.kind,
    amount: Number(row.amount),
    balance_after: Number(row.balance_after),
    ref_type: row.ref_type,
    ref_id: row.ref_id,
    note: row.note,
    actor_user_id: row.actor_user_id,
  };
}

/**
 * Trả một trang lịch sử thu chi của `userId`, sắp xếp theo `occurred_at`
 * giảm dần (mới nhất trước), đúng hình dạng {@link FarmLedgerPage}.
 *
 * Nhân viên chưa có giao dịch nào vẫn nhận được một trang hợp lệ với
 * `entries: []`, `total: 0`, `has_more: false` — hướng dẫn trạng thái trống
 * (nội dung tiếng Việt) thuộc về frontend (`ledger-panel`, task 13.3), nên
 * response ở đây KHÔNG kèm trường thông báo/hướng dẫn nào ngoài hình dạng đã
 * khai báo trong `FarmLedgerPage`.
 *
 * _Requirements: US-21_
 */
export async function getLedgerPage(userId: number, query: LedgerQuery): Promise<FarmLedgerPage> {
  const { page, pageSize } = parsePagination(query);
  const offset = (page - 1) * pageSize;

  const [entriesResult, countResult] = await Promise.all([
    pool.query<LedgerRow>(
      `SELECT id, occurred_at, kind, amount, balance_after, ref_type, ref_id, note, actor_user_id
       FROM farm_transactions
       WHERE user_id = $1
       ORDER BY occurred_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, pageSize, offset],
    ),
    pool.query<{ total: string }>('SELECT COUNT(*) AS total FROM farm_transactions WHERE user_id = $1', [
      userId,
    ]),
  ]);

  const total = Number(countResult.rows[0]?.total ?? 0);
  const entries = entriesResult.rows.map(rowToLedgerEntry);

  return {
    entries,
    page,
    page_size: pageSize,
    total,
    has_more: offset + entries.length < total,
  };
}
