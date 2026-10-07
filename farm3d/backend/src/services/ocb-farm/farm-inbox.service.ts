/**
 * OCB Farm — hộp thư của chủ nông trại: người đã giúp + lời chúc (US-8, US-27, US-48).
 *
 * Tách riêng khỏi `farm-social.service.ts` để `farm-me.service.ts` dùng được
 * {@link countInboxNew} mà không tạo vòng import (social → me → social).
 *
 * Cờ "mới" là cột `seen_by_owner` của `farm_helps` / `farm_greetings` —
 * `POST /me/inbox/read` đặt `true` và không bao giờ đặt lại `false`, nên dấu
 * mới đã xoá không xuất hiện lại.
 *
 * Chủ nông trại xoá được lời chúc (US-48): xoá mềm qua `deleted_at` trên
 * `farm_greetings` — nội dung đã xoá không hiển thị lại nhưng hạn mức gửi
 * trong ngày (đếm theo `sender_user_id, owner_user_id, greet_date`, không
 * lọc `deleted_at`) vẫn đúng. Danh sách người đã giúp không xoá được: đó là
 * nhật ký hoạt động, không phải nội dung do người khác gửi.
 *
 * _Requirements: US-8, US-27, US-48_
 */

import { pool } from '../../config/database';
import type {
  FarmInboxGreeting,
  FarmInboxHelp,
  FarmInboxResponse,
  GreetingKind,
  HelpActionType,
} from '../../types/ocb-farm.types';

/** Mã lỗi nghiệp vụ khi lời chúc không tồn tại hoặc không thuộc về chủ nông trại. */
export class FarmInboxGreetingNotFoundError extends Error {
  readonly code = 'GREETING_NOT_FOUND' as const;
  constructor() {
    super('Không tìm thấy lời chúc hoặc lời chúc đã được xoá trước đó.');
    this.name = 'FarmInboxGreetingNotFoundError';
  }
}

/** Số mục gần nhất trả về cho mỗi danh sách trong hộp thư. */
const INBOX_LIMIT = 100;

interface InboxHelpRow {
  id: string; // BIGSERIAL
  helper_user_id: number;
  helper_name: string | null;
  action_type: HelpActionType;
  help_date: string; // to_char(..., 'YYYY-MM-DD')
  created_at: Date;
  seen_by_owner: boolean;
}

interface InboxGreetingRow {
  id: string; // BIGSERIAL
  sender_user_id: number;
  sender_name: string | null;
  kind: GreetingKind;
  message: string;
  created_at: Date;
  seen_by_owner: boolean;
}

/** Số mục chưa xem (lượt giúp + lời chúc chưa bị xoá) của chủ nông trại. */
export async function countInboxNew(ownerUserId: number): Promise<number> {
  const result = await pool.query<{ total: string }>(
    `SELECT
       (SELECT COUNT(*) FROM farm_helps WHERE owner_user_id = $1 AND seen_by_owner = false)
       + (SELECT COUNT(*) FROM farm_greetings
          WHERE owner_user_id = $1 AND seen_by_owner = false AND deleted_at IS NULL) AS total`,
    [ownerUserId],
  );
  return Number(result.rows[0]?.total ?? 0);
}

/**
 * `GET /me/inbox` — người đã giúp + lời chúc, mới nhất trước, kèm cờ "mới".
 * Lời chúc vẫn được giữ và hiển thị dù chủ nông trại không truy cập đúng ngày
 * kỷ niệm (US-8) — không có lọc theo ngày ở đây.
 */
export async function getInbox(ownerUserId: number): Promise<FarmInboxResponse> {
  const [helpsResult, greetingsResult] = await Promise.all([
    pool.query<InboxHelpRow>(
      `SELECT h.id, h.helper_user_id, COALESCE(u.full_name, u.username) AS helper_name,
              h.action_type, to_char(h.help_date, 'YYYY-MM-DD') AS help_date,
              h.created_at, h.seen_by_owner
       FROM farm_helps h
       LEFT JOIN users u ON u.id = h.helper_user_id
       WHERE h.owner_user_id = $1
       ORDER BY h.created_at DESC
       LIMIT $2`,
      [ownerUserId, INBOX_LIMIT],
    ),
    pool.query<InboxGreetingRow>(
      `SELECT g.id, g.sender_user_id, COALESCE(u.full_name, u.username) AS sender_name,
              g.kind, g.message, g.created_at, g.seen_by_owner
       FROM farm_greetings g
       LEFT JOIN users u ON u.id = g.sender_user_id
       WHERE g.owner_user_id = $1 AND g.deleted_at IS NULL
       ORDER BY g.created_at DESC
       LIMIT $2`,
      [ownerUserId, INBOX_LIMIT],
    ),
  ]);

  const helps: FarmInboxHelp[] = helpsResult.rows.map((row) => ({
    id: Number(row.id),
    helper_user_id: row.helper_user_id,
    helper_name: row.helper_name ?? '',
    action_type: row.action_type,
    help_date: row.help_date,
    created_at: row.created_at.toISOString(),
    is_new: !row.seen_by_owner,
  }));

  const greetings: FarmInboxGreeting[] = greetingsResult.rows.map((row) => ({
    id: Number(row.id),
    sender_user_id: row.sender_user_id,
    sender_name: row.sender_name ?? '',
    kind: row.kind,
    message: row.message,
    created_at: row.created_at.toISOString(),
    is_new: !row.seen_by_owner,
  }));

  return { helps, greetings, new_count: await countInboxNew(ownerUserId) };
}

export interface FarmInboxReadResult {
  helps_marked: number;
  greetings_marked: number;
  new_count: number;
}

/**
 * `POST /me/inbox/read` — xoá cờ "mới" của toàn bộ mục trong hộp thư.
 * Idempotent: gọi lại lần nữa chỉ trả 0 mục được đánh dấu.
 */
export async function markInboxRead(ownerUserId: number): Promise<FarmInboxReadResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const helps = await client.query(
      'UPDATE farm_helps SET seen_by_owner = true WHERE owner_user_id = $1 AND seen_by_owner = false',
      [ownerUserId],
    );
    const greetings = await client.query(
      'UPDATE farm_greetings SET seen_by_owner = true WHERE owner_user_id = $1 AND seen_by_owner = false',
      [ownerUserId],
    );
    await client.query('COMMIT');
    return {
      helps_marked: helps.rowCount ?? 0,
      greetings_marked: greetings.rowCount ?? 0,
      new_count: 0,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export interface FarmInboxDeleteGreetingResult {
  deleted: boolean;
  new_count: number;
}

/**
 * `DELETE /me/inbox/greetings/:id` — xoá mềm một lời chúc trong hộp thư của
 * chủ nông trại hiện tại. Chỉ xoá được lời chúc của chính mình (`owner_user_id`
 * khớp người gọi) và chưa bị xoá trước đó; ngược lại ném
 * {@link FarmInboxGreetingNotFoundError} (422, không rò rỉ việc lời chúc có
 * tồn tại dưới quyền người khác hay không).
 */
export async function deleteGreeting(
  ownerUserId: number,
  greetingId: number,
): Promise<FarmInboxDeleteGreetingResult> {
  const result = await pool.query(
    `UPDATE farm_greetings
     SET deleted_at = NOW()
     WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL`,
    [greetingId, ownerUserId],
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new FarmInboxGreetingNotFoundError();
  }
  return { deleted: true, new_count: await countInboxNew(ownerUserId) };
}

export interface FarmInboxClearGreetingsResult {
  cleared: number;
  new_count: number;
}

/**
 * `DELETE /me/inbox/greetings` — xoá mềm toàn bộ lời chúc chưa xoá trong hộp
 * thư của chủ nông trại hiện tại ("xoá toàn bộ", US-48). Idempotent: gọi lại
 * khi đã trống trả `cleared: 0`, không lỗi.
 */
export async function clearGreetings(ownerUserId: number): Promise<FarmInboxClearGreetingsResult> {
  const result = await pool.query(
    `UPDATE farm_greetings
     SET deleted_at = NOW()
     WHERE owner_user_id = $1 AND deleted_at IS NULL`,
    [ownerUserId],
  );
  return { cleared: result.rowCount ?? 0, new_count: await countInboxNew(ownerUserId) };
}
