/**
 * OCB Farm — middleware kiểm tra quyền truy cập ứng dụng `ocb-farm` theo
 * `app_permissions` (dành cho trường hợp app được đổi lại thành
 * `access_mode = 'restricted'`).
 *
 * KHÔNG còn được gắn vào `ocb-farm.routes.ts` — app `ocb-farm` hiện tại là
 * `public`: mọi nhân viên đã đăng nhập (qua `authMiddleware`) đều dùng được
 * phần nông trại, chỉ nhóm `/admin/*` mới cần `adminMiddleware` riêng.
 *
 * Giữ lại hàm này để tái sử dụng nếu sau này app quay lại chế độ restricted.
 *
 * _Requirements: US-45, BR-25, BR-26_
 */

import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';

const FORBIDDEN_RESPONSE = {
  error: true,
  code: 'FORBIDDEN',
  message: 'Bạn không có quyền truy cập Nông trại OCB.',
} as const;

/**
 * Kiểm tra quyền truy cập ứng dụng OCB Farm (restricted app, BR-25).
 * Phải chạy sau `authMiddleware`.
 */
export async function farmAccessMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const roles = req.user?.roles ?? [];

  // Admin luôn có quyền truy cập (BR-25).
  if (roles.includes('admin')) {
    return next();
  }

  try {
    const userId = req.user?.sub;
    if (!userId) {
      res.status(403).json(FORBIDDEN_RESPONSE);
      return;
    }

    const userResult = await pool.query('SELECT department_id FROM users WHERE id = $1', [userId]);
    const deptId = userResult.rows[0]?.department_id ?? null;

    const permResult = await pool.query(
      `SELECT 1 FROM app_permissions
       WHERE app_id = 'ocb-farm'
         AND (user_id = $1 OR (department_id IS NOT NULL AND department_id = $2))
       LIMIT 1`,
      [userId, deptId],
    );

    if (permResult.rows.length > 0) {
      return next();
    }

    res.status(403).json(FORBIDDEN_RESPONSE);
  } catch {
    res.status(403).json(FORBIDDEN_RESPONSE);
  }
}
