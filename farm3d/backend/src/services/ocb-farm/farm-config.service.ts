/**
 * OCB Farm — service đọc/ghi cấu hình cân bằng game (`farm_config`).
 *
 * Đây là nguồn duy nhất mà các service khác (2.x hàm thuần, 5.x nhóm lệnh, ...)
 * dùng để lấy giá trị cấu hình theo khóa — không tự query `farm_config` ở nơi khác.
 *
 * Đặc điểm:
 * - Cache trong tiến trình (module-level, `Map<string, FarmConfigEntry>`), nạp từ
 *   DB ở lần đọc đầu tiên; mọi lần ghi qua {@link updateFarmConfig} sẽ tự làm mới
 *   cache ngay sau khi transaction COMMIT thành công (không chỉ đơn giản xoá cache
 *   rồi chờ lần đọc kế tiếp, để tránh cửa sổ đọc-cũ giữa các request đồng thời).
 * - Validate khoá và khoảng min/max ở tầng service TRƯỚC khi chạm DB, để trả lỗi
 *   nghiệp vụ rõ ràng (`CONFIG_KEY_UNKNOWN`, `CONFIG_VALUE_OUT_OF_RANGE`) thay vì
 *   để lộ vi phạm CHECK constraint thô của Postgres (constraint DB vẫn giữ làm
 *   lớp bảo vệ cuối, theo nguyên tắc "defense in depth").
 * - Mỗi lần ghi tạo đúng một dòng `farm_admin_audit` cho mỗi khóa thay đổi, với
 *   `action = 'update_config'`, `target_user_id = NULL` (không nhắm vào một nhân
 *   viên cụ thể), `before_value`/`after_value` dạng `{ key, value }` (BR-27).
 *
 * Quy ước báo lỗi: dự án chưa có một lớp `AppError`/`HttpError` dùng chung —
 * các service khác (`backend/src/services/budget/*`, `ideas.service.ts`, ...) tự
 * định nghĩa lỗi theo hai kiểu: hàm `httpError(message, statusCode, code)` trả về
 * `Error & { statusCode, code }`, hoặc `class XyzError extends Error { code = '...' }`.
 * Module này theo kiểu thứ hai bằng {@link FarmConfigError} (thuộc tính `code` khớp
 * `FarmErrorCode` để tầng route/command-service ở các task sau map thẳng sang
 * HTTP 422 mà không cần dịch mã).
 *
 * _Requirements: US-45, BR-27_
 */

import { pool } from '../../config/database';
import type {
  FarmConfigEntry,
  FarmConfigGroup,
  FarmConfigResponse,
  FarmErrorCode,
} from '../../types/ocb-farm.types';

// ============================================================================
// Lỗi nghiệp vụ
// ============================================================================

/**
 * Lỗi cấu hình OCB Farm — `code` khớp {@link FarmErrorCode} để tầng gọi (route,
 * `farm-command.service` ở task 5.x) map thẳng sang response 422 mà không cần
 * bảng dịch mã riêng.
 */
export class FarmConfigError extends Error {
  readonly code: FarmErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: FarmErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

// ============================================================================
// Cache trong tiến trình
// ============================================================================

interface ConfigCache {
  /** `key` → dòng cấu hình đầy đủ. */
  entries: Map<string, FarmConfigEntry>;
  /** Thời điểm nạp cache gần nhất — dùng cho `refreshed_at` của {@link FarmConfigResponse}. */
  refreshedAt: string;
}

let cache: ConfigCache | null = null;

/** Xoá cache hiện tại — lần đọc kế tiếp sẽ nạp lại từ DB. Dùng cho test. */
export function invalidateFarmConfigCache(): void {
  cache = null;
}

interface FarmConfigRow {
  key: string;
  value: string; // NUMERIC trả về dạng string qua driver `pg`
  unit: string | null;
  min_value: string | null;
  max_value: string | null;
  config_group: string;
  description: string | null;
  updated_at: Date;
}

function rowToEntry(row: FarmConfigRow): FarmConfigEntry {
  return {
    key: row.key,
    value: Number(row.value),
    unit: row.unit,
    min_value: row.min_value === null ? null : Number(row.min_value),
    max_value: row.max_value === null ? null : Number(row.max_value),
    config_group: row.config_group as FarmConfigGroup,
    description: row.description,
    updated_at: row.updated_at.toISOString(),
  };
}

/** Nạp toàn bộ `farm_config` từ DB và ghi vào cache trong tiến trình. */
async function loadCacheFromDb(): Promise<ConfigCache> {
  const result = await pool.query<FarmConfigRow>(
    'SELECT key, value, unit, min_value, max_value, config_group, description, updated_at FROM farm_config',
  );

  const entries = new Map<string, FarmConfigEntry>();
  for (const row of result.rows) {
    entries.set(row.key, rowToEntry(row));
  }

  const loaded: ConfigCache = { entries, refreshedAt: new Date().toISOString() };
  cache = loaded;
  return loaded;
}

/** Trả cache hiện tại, nạp từ DB nếu chưa có (lần đọc đầu tiên hoặc sau khi invalidate). */
async function getCache(): Promise<ConfigCache> {
  if (cache) return cache;
  return loadCacheFromDb();
}

// ============================================================================
// Đọc cấu hình
// ============================================================================

/**
 * Trả toàn bộ cấu hình đang áp dụng, đúng hình dạng {@link FarmConfigResponse}
 * dùng cho `GET /config` và `GET/PUT /admin/config` (US-45).
 *
 * _Requirements: US-45_
 */
export async function getFarmConfig(): Promise<FarmConfigResponse> {
  const { entries, refreshedAt } = await getCache();

  const values: Record<string, number> = {};
  const entryList: FarmConfigEntry[] = [];
  for (const entry of entries.values()) {
    values[entry.key] = entry.value;
    entryList.push(entry);
  }

  return { values, entries: entryList, refreshed_at: refreshedAt };
}

/**
 * Trả giá trị số của một khóa cấu hình duy nhất, dùng cache.
 *
 * Ném {@link FarmConfigError} với mã `CONFIG_KEY_UNKNOWN` khi khóa không tồn
 * tại trong `farm_config` — các module hàm thuần ở backend (`farm-seniority.ts`,
 * `farm-economy.ts`, ...) dùng hàm này để dựng đối tượng cấu hình của riêng
 * chúng (ví dụ `FarmSeniorityConfig`) trước khi gọi hàm thuần.
 *
 * _Requirements: US-45_
 */
export async function getFarmConfigValue(key: string): Promise<number> {
  const { entries } = await getCache();
  const entry = entries.get(key);

  if (!entry) {
    throw new FarmConfigError('CONFIG_KEY_UNKNOWN', `Không tìm thấy khoá cấu hình "${key}".`, { key });
  }

  return entry.value;
}

/**
 * Trả giá trị số của nhiều khóa cấu hình cùng lúc, dùng cache — tiện cho các
 * hàm dựng đối tượng cấu hình nhiều khóa (ví dụ `FarmSeniorityConfig` cần cả
 * `tree_max_milestone` và `tree_max_branches`) mà không phải gọi tuần tự.
 *
 * Ném {@link FarmConfigError} `CONFIG_KEY_UNKNOWN` cho khóa đầu tiên không
 * tìm thấy trong danh sách.
 *
 * _Requirements: US-45_
 */
export async function getFarmConfigValues(keys: readonly string[]): Promise<Record<string, number>> {
  const { entries } = await getCache();
  const result: Record<string, number> = {};

  for (const key of keys) {
    const entry = entries.get(key);
    if (!entry) {
      throw new FarmConfigError('CONFIG_KEY_UNKNOWN', `Không tìm thấy khoá cấu hình "${key}".`, { key });
    }
    result[key] = entry.value;
  }

  return result;
}

// ============================================================================
// Ghi cấu hình
// ============================================================================

/** Một thay đổi cấu hình được yêu cầu bởi quản trị viên. */
export interface FarmConfigUpdate {
  key: string;
  value: number;
}

export interface UpdateFarmConfigInput {
  adminUserId: number;
  updates: FarmConfigUpdate[];
  reason?: string;
}

/**
 * Cập nhật một hoặc nhiều giá trị cấu hình.
 *
 * Với mỗi khóa: xác thực khóa tồn tại, xác thực giá trị mới nằm trong
 * [`min_value`, `max_value`] (validate ở service TRƯỚC khi chạm DB, để trả lỗi
 * nghiệp vụ rõ ràng thay vì lỗi CHECK constraint thô — CHECK ở DB vẫn giữ làm
 * lớp bảo vệ cuối). Toàn bộ thay đổi áp dụng trong một transaction; ghi một
 * dòng `farm_admin_audit` cho mỗi khóa thay đổi (`action = 'update_config'`,
 * `target_user_id = NULL` vì không nhắm vào một nhân viên cụ thể). Sau khi
 * COMMIT, làm mới cache trong tiến trình để lần đọc kế tiếp thấy giá trị mới.
 *
 * Không có thay đổi nào được áp dụng nếu bất kỳ khóa nào không hợp lệ — toàn
 * bộ mảng `updates` được xác thực trước khi mở transaction.
 *
 * _Requirements: US-45, BR-27_
 */
export async function updateFarmConfig(input: UpdateFarmConfigInput): Promise<FarmConfigEntry[]> {
  const { adminUserId, updates, reason } = input;

  if (updates.length === 0) {
    return [];
  }

  // Xác thực toàn bộ trước khi chạm DB — tất cả hoặc không gì cả.
  const { entries } = await getCache();
  for (const update of updates) {
    const entry = entries.get(update.key);
    if (!entry) {
      throw new FarmConfigError('CONFIG_KEY_UNKNOWN', `Không tìm thấy khoá cấu hình "${update.key}".`, {
        key: update.key,
      });
    }
    if (
      (entry.min_value !== null && update.value < entry.min_value) ||
      (entry.max_value !== null && update.value > entry.max_value)
    ) {
      throw new FarmConfigError(
        'CONFIG_VALUE_OUT_OF_RANGE',
        `Giá trị của "${update.key}" phải nằm trong khoảng [${entry.min_value ?? '-∞'}, ${entry.max_value ?? '+∞'}].`,
        { key: update.key, value: update.value, min_value: entry.min_value, max_value: entry.max_value },
      );
    }
  }

  const client = await pool.connect();
  const updatedEntries: FarmConfigEntry[] = [];

  try {
    await client.query('BEGIN');

    for (const update of updates) {
      const beforeEntry = entries.get(update.key)!;

      const result = await client.query<FarmConfigRow>(
        `UPDATE farm_config
         SET value = $1, updated_by = $2, updated_at = NOW()
         WHERE key = $3
         RETURNING key, value, unit, min_value, max_value, config_group, description, updated_at`,
        [update.value, adminUserId, update.key],
      );

      const updatedRow = result.rows[0];
      if (!updatedRow) {
        // Khoá bị xoá giữa lúc xác thực và lúc ghi (rất hiếm) — coi như không tồn tại.
        throw new FarmConfigError('CONFIG_KEY_UNKNOWN', `Không tìm thấy khoá cấu hình "${update.key}".`, {
          key: update.key,
        });
      }

      await client.query(
        `INSERT INTO farm_admin_audit
           (admin_user_id, target_user_id, action, before_value, after_value, reason)
         VALUES ($1, NULL, 'update_config', $2, $3, $4)`,
        [
          adminUserId,
          JSON.stringify({ key: update.key, value: beforeEntry.value }),
          JSON.stringify({ key: update.key, value: update.value }),
          reason ?? null,
        ],
      );

      updatedEntries.push(rowToEntry(updatedRow));
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Làm mới cache sau khi COMMIT thành công, để lần đọc kế tiếp thấy giá trị mới.
  await loadCacheFromDb();

  return updatedEntries;
}
