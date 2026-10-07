/**
 * OCB Farm — route nền: `/api/ocb-farm` (`/config`, `/me`, `/me/init`,
 * `/me/join-date-suggestion`, `/commands`, `/me/ledger`, `/me/achievements`).
 *
 * Route mỏng / logic ở service, theo đúng khuôn mẫu `device.routes.ts`:
 * handler chỉ gọi service (task 4.2, 4.3, 5.1, 5.7) và định dạng response,
 * không tự chứa nghiệp vụ.
 *
 * Toàn bộ router yêu cầu `authMiddleware` (app `ocb-farm` là public —
 * mọi nhân viên đã đăng nhập đều dùng được). Nhóm `/admin/*` (task 8.x) tự
 * nối thêm `adminMiddleware` vào một router con riêng để giới hạn phần
 * quản lý cho vai trò admin.
 *
 * _Requirements: US-1, US-2, US-3, US-21, US-29_
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { adminMiddleware } from '../middleware/admin.middleware';
import { getConfigSnapshot, getMeSnapshot } from '../services/ocb-farm/farm-me.service';
import { FarmConfigError, getJoinDateSuggestion, initFarm } from '../services/ocb-farm/farm-init.service';
import { applyFarmCommand } from '../services/ocb-farm/farm-command.service';
import { getLedgerPage } from '../services/ocb-farm/farm-ledger.service';
import { getAchievementsView } from '../services/ocb-farm/farm-achievements-view.service';
import {
  adjustSeedsByAdmin,
  FarmAdminTargetNotFoundError,
  getAdminAuditPage,
  getAdminStats,
  previewResetFarm,
  resetFarmByAdmin,
  searchAdminUsers,
  updateJoinDateByAdmin,
} from '../services/ocb-farm/farm-admin.service';
import { getFarmConfig, updateFarmConfig } from '../services/ocb-farm/farm-config.service';
import { getFarmVisit, helpFarm, listFarms, sendGreeting } from '../services/ocb-farm/farm-social.service';
import {
  clearGreetings,
  deleteGreeting,
  FarmInboxGreetingNotFoundError,
  getInbox,
  markInboxRead,
} from '../services/ocb-farm/farm-inbox.service';
import { getLeaderboard } from '../services/ocb-farm/farm-leaderboard.service';
import type {
  FarmAdminConfigPutRequest,
  FarmAdminJoinDatePatchRequest,
  FarmAdminResetRequest,
  FarmAdminSeedsAdjustRequest,
  FarmInitRequest,
} from '../types/ocb-farm.types';

const router = Router();

// App `ocb-farm` là public (access_mode = 'public') — mọi nhân viên đã đăng
// nhập đều dùng được phần nông trại. Nhóm `/admin/*` phía dưới tự nối thêm
// `adminMiddleware` để giới hạn riêng cho vai trò admin (BR-26).
router.use(authMiddleware);

// GET /api/ocb-farm/config
router.get('/config', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await getConfigSnapshot();
    res.status(200).json(config);
  } catch (err) {
    next(err);
  }
});

// GET /api/ocb-farm/me
router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await getMeSnapshot(req.user!.sub);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/ocb-farm/me/init
router.post('/me/init', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await initFarm(req.user!.sub, req.body as FarmInitRequest);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof FarmConfigError) {
      res.status(422).json({
        error: true,
        code: err.code,
        message: err.message,
        details: err.details,
      });
      return;
    }
    next(err);
  }
});

// GET /api/ocb-farm/me/join-date-suggestion
router.get('/me/join-date-suggestion', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const suggestion = await getJoinDateSuggestion(req.user!.sub);
    res.status(200).json(suggestion);
  } catch (err) {
    // getJoinDateSuggestion không bao giờ throw (documented), nhưng vẫn bọc
    // try/catch cho xử lý 500 phòng thủ, nhất quán với các route khác.
    next(err);
  }
});

// POST /api/ocb-farm/commands
//
// Endpoint lệnh duy nhất (task 5.1) — xử lý toàn bộ logic trong
// `farm-command.service.ts`. Route chỉ map discriminated `FarmCommandResult`
// sang HTTP status tương ứng (200/409/422), không tự chứa nghiệp vụ.
//
// _Requirements: US-21, US-29, US-40, BR-9, BR-12, BR-27_
router.post('/commands', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await applyFarmCommand(req.user!.sub, req.body);
    res.status(result.httpStatus).json(result.body);
  } catch (err) {
    next(err);
  }
});

// GET /api/ocb-farm/me/ledger
//
// Lịch sử thu chi phân trang (task 5.7). `page`/`page_size` không hợp lệ
// (không phải số nguyên dương) → 422 `INVALID_PAYLOAD` qua `FarmConfigError`,
// theo đúng khuôn mẫu xử lý lỗi nghiệp vụ đã dùng ở `/me/init`.
//
// _Requirements: US-21_
router.get('/me/ledger', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = await getLedgerPage(req.user!.sub, {
      page: typeof req.query.page === 'string' ? req.query.page : undefined,
      page_size: typeof req.query.page_size === 'string' ? req.query.page_size : undefined,
    });
    res.status(200).json(page);
  } catch (err) {
    if (err instanceof FarmConfigError) {
      res.status(422).json({
        error: true,
        code: err.code,
        message: err.message,
        details: err.details,
      });
      return;
    }
    next(err);
  }
});

// GET /api/ocb-farm/me/achievements
//
// Toàn bộ thành tựu kèm trạng thái đã đạt/ngày đạt hoặc tiến trình hiện tại
// (task 5.7). Không có query param nào để xác thực.
//
// _Requirements: US-29_
router.get('/me/achievements', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const achievements = await getAchievementsView(req.user!.sub);
    res.status(200).json(achievements);
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// Nhóm xã hội và xếp hạng (task 7.1–7.4) — `/farms`, `/farms/:userId`,
// `/farms/:userId/help`, `/farms/:userId/greeting`, `/me/inbox`,
// `/me/inbox/read`, `/leaderboard`. Lỗi nghiệp vụ (`FarmConfigError`) → 422.
//
// _Requirements: US-8, US-26, US-27, US-28, US-29, US-48, BR-21, BR-22, BR-23_
// ============================================================================

function sendFarmBusinessError(res: Response, err: FarmConfigError): void {
  res.status(422).json({
    error: true,
    code: err.code,
    message: err.message,
    details: err.details,
  });
}

/** Đọc `:userId` — trả `null` (và đã gửi 422) khi không phải số nguyên dương. */
function parseTargetUserId(req: Request, res: Response): number | null {
  const userId = Number(req.params['userId']);
  if (!Number.isInteger(userId) || userId <= 0) {
    res.status(422).json({ error: true, code: 'INVALID_PAYLOAD', message: 'Mã nhân viên không hợp lệ.' });
    return null;
  }
  return userId;
}

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

// GET /api/ocb-farm/farms
router.get('/farms', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = await listFarms(req.user!.sub, {
      q: queryString(req.query.q),
      department_id: queryString(req.query.department_id),
      page: queryString(req.query.page),
      page_size: queryString(req.query.page_size),
    });
    res.status(200).json(page);
  } catch (err) {
    if (err instanceof FarmConfigError) return sendFarmBusinessError(res, err);
    next(err);
  }
});

// GET /api/ocb-farm/farms/:userId
router.get('/farms/:userId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerUserId = parseTargetUserId(req, res);
    if (ownerUserId === null) return;
    const visit = await getFarmVisit(req.user!.sub, ownerUserId);
    res.status(200).json(visit);
  } catch (err) {
    if (err instanceof FarmConfigError) return sendFarmBusinessError(res, err);
    next(err);
  }
});

// POST /api/ocb-farm/farms/:userId/help
router.post('/farms/:userId/help', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerUserId = parseTargetUserId(req, res);
    if (ownerUserId === null) return;
    const result = await helpFarm(req.user!.sub, ownerUserId, req.body);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof FarmConfigError) return sendFarmBusinessError(res, err);
    next(err);
  }
});

// POST /api/ocb-farm/farms/:userId/greeting
router.post('/farms/:userId/greeting', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerUserId = parseTargetUserId(req, res);
    if (ownerUserId === null) return;
    const result = await sendGreeting(req.user!.sub, ownerUserId, req.body);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof FarmConfigError) return sendFarmBusinessError(res, err);
    next(err);
  }
});

// GET /api/ocb-farm/me/inbox
router.get('/me/inbox', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const inbox = await getInbox(req.user!.sub);
    res.status(200).json(inbox);
  } catch (err) {
    next(err);
  }
});

// POST /api/ocb-farm/me/inbox/read
router.post('/me/inbox/read', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await markInboxRead(req.user!.sub);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/ocb-farm/me/inbox/greetings
//
// Xoá toàn bộ lời chúc trong hộp thư của chính mình ("xoá toàn bộ", US-48).
// Đặt TRƯỚC route `/me/inbox/greetings/:id` để không bị Express khớp nhầm
// `greetings` thành giá trị của `:id`.
router.delete('/me/inbox/greetings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await clearGreetings(req.user!.sub);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/ocb-farm/me/inbox/greetings/:id
//
// Xoá một lời chúc trong hộp thư của chính mình (US-48). Chỉ xoá được lời
// chúc của chính mình — không rò rỉ việc id thuộc về người khác hay không
// hợp lệ, cả hai trường hợp đều trả cùng mã lỗi nghiệp vụ.
router.delete('/me/inbox/greetings/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const greetingId = Number(req.params['id']);
    if (!Number.isInteger(greetingId) || greetingId <= 0) {
      res.status(422).json({ error: true, code: 'INVALID_PAYLOAD', message: 'Mã lời chúc không hợp lệ.' });
      return;
    }
    const result = await deleteGreeting(req.user!.sub, greetingId);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof FarmInboxGreetingNotFoundError) {
      res.status(422).json({ error: true, code: err.code, message: err.message });
      return;
    }
    next(err);
  }
});

// GET /api/ocb-farm/leaderboard
router.get('/leaderboard', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const board = await getLeaderboard(req.user!.sub, {
      metric: queryString(req.query.metric),
      department_id: queryString(req.query.department_id),
    });
    res.status(200).json(board);
  } catch (err) {
    if (err instanceof FarmConfigError) return sendFarmBusinessError(res, err);
    next(err);
  }
});

// ============================================================================
// Nhóm `/admin/*` — thêm `adminMiddleware` vào chuỗi (BR-26), sau
// `authMiddleware` đã áp dụng ở `router.use` phía trên. Chuỗi hiệu lực cho
// nhóm này là:
//   authMiddleware → adminMiddleware → handler
//
// _Requirements: US-42, BR-26_
// ============================================================================

const adminRouter = Router();
adminRouter.use(adminMiddleware);

// GET /api/ocb-farm/admin/users
//
// Tìm nhân viên theo tên hoặc phòng ban, phân trang (task 8.1, US-42).
adminRouter.get('/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = await searchAdminUsers({
      q: typeof req.query.q === 'string' ? req.query.q : undefined,
      department_id: typeof req.query.department_id === 'string' ? req.query.department_id : undefined,
      page: typeof req.query.page === 'string' ? req.query.page : undefined,
      page_size: typeof req.query.page_size === 'string' ? req.query.page_size : undefined,
    });
    res.status(200).json(page);
  } catch (err) {
    if (err instanceof FarmConfigError) {
      res.status(422).json({
        error: true,
        code: err.code,
        message: err.message,
        details: err.details,
      });
      return;
    }
    next(err);
  }
});

// PATCH /api/ocb-farm/admin/users/:id/join-date
//
// Sửa ngày vào làm của một nhân viên — cùng quy tắc hợp lệ áp dụng cho
// nhân viên (BR-7), trả thâm niên và mốc Cây OCB tính lại ngay, ghi
// `farm_admin_audit`, đặt `join_date_admin_locked = true` (task 8.1, US-42).
adminRouter.patch('/users/:id/join-date', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const targetUserId = Number(req.params['id']);
    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
      res.status(422).json({
        error: true,
        code: 'INVALID_PAYLOAD',
        message: 'Mã nhân viên không hợp lệ.',
      });
      return;
    }

    const result = await updateJoinDateByAdmin(
      req.user!.sub,
      targetUserId,
      req.body as FarmAdminJoinDatePatchRequest,
    );
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof FarmConfigError) {
      res.status(422).json({
        error: true,
        code: err.code,
        message: err.message,
        details: err.details,
      });
      return;
    }
    if (err instanceof FarmAdminTargetNotFoundError) {
      res.status(422).json({
        error: true,
        code: err.code,
        message: err.message,
      });
      return;
    }
    next(err);
  }
});

// POST /api/ocb-farm/admin/users/:id/seeds
//
// Điều chỉnh số dư Hạt OCB của một nhân viên — bắt buộc `reason`, header
// `Idempotency-Key` bảo đảm xác nhận nhiều lần chỉ ghi một bản ghi sổ
// (task 8.2, US-43).
adminRouter.post('/users/:id/seeds', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const targetUserId = Number(req.params['id']);
    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
      res.status(422).json({
        error: true,
        code: 'INVALID_PAYLOAD',
        message: 'Mã nhân viên không hợp lệ.',
      });
      return;
    }

    const idempotencyKeyHeader = req.header('Idempotency-Key');
    const result = await adjustSeedsByAdmin(
      req.user!.sub,
      targetUserId,
      req.body as FarmAdminSeedsAdjustRequest,
      idempotencyKeyHeader || undefined,
    );
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof FarmConfigError) {
      res.status(422).json({
        error: true,
        code: err.code,
        message: err.message,
        details: err.details,
      });
      return;
    }
    if (err instanceof FarmAdminTargetNotFoundError) {
      res.status(422).json({
        error: true,
        code: err.code,
        message: err.message,
      });
      return;
    }
    next(err);
  }
});

// POST /api/ocb-farm/admin/users/:id/reset?preview=true
//
// Đặt lại nông trại về trạng thái khởi tạo, giữ nguyên ngày vào làm, thâm
// niên, mốc Cây OCB, thành tựu và huy hiệu. `?preview=true` chỉ tính và trả
// danh sách phần giữ lại / phần bị mất, KHÔNG ghi gì — UI dùng để dựng hộp
// xác nhận hai bước trước khi gọi lại không kèm `preview` (task 8.2, US-44).
adminRouter.post('/users/:id/reset', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const targetUserId = Number(req.params['id']);
    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
      res.status(422).json({
        error: true,
        code: 'INVALID_PAYLOAD',
        message: 'Mã nhân viên không hợp lệ.',
      });
      return;
    }

    const isPreview = req.query['preview'] === 'true';

    if (isPreview) {
      const preview = await previewResetFarm(targetUserId);
      res.status(200).json(preview);
      return;
    }

    const result = await resetFarmByAdmin(req.user!.sub, targetUserId, req.body as FarmAdminResetRequest);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof FarmConfigError) {
      res.status(422).json({
        error: true,
        code: err.code,
        message: err.message,
        details: err.details,
      });
      return;
    }
    if (err instanceof FarmAdminTargetNotFoundError) {
      res.status(422).json({
        error: true,
        code: err.code,
        message: err.message,
      });
      return;
    }
    next(err);
  }
});

// GET /api/ocb-farm/admin/config
//
// Đọc cấu hình cân bằng game đang áp dụng — admin xem cùng dữ liệu với
// `GET /config` (task 8.3, US-45).
adminRouter.get('/config', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await getFarmConfig();
    res.status(200).json(config);
  } catch (err) {
    next(err);
  }
});

// PUT /api/ocb-farm/admin/config
//
// Ghi một hoặc nhiều thông số cân bằng game. Validate theo min/max của
// từng thông số ở `updateFarmConfig` (`farm-config.service.ts`) — giá trị
// mới chỉ ảnh hưởng tới cache đọc ở các lượt chơi sau thời điểm lưu, không
// tính lại phần thưởng/tiến trình đã phát sinh trước đó (không cần code gì
// thêm cho AC này: `tick()`, các nhóm lệnh ở task 5.x và mọi nơi khác đều
// đọc giá trị cấu hình tại ĐÚNG thời điểm xử lý request, không lưu lại một
// bản sao cấu hình cũ nào trong `state` để phải tính lại). Ghi một dòng
// `farm_admin_audit` cho mỗi khóa thay đổi (task 8.3, US-45, BR-27).
adminRouter.put('/config', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as FarmAdminConfigPutRequest;
    await updateFarmConfig({
      adminUserId: req.user!.sub,
      updates: Array.isArray(body?.updates) ? body.updates : [],
      reason: body?.reason,
    });
    const config = await getFarmConfig();
    res.status(200).json(config);
  } catch (err) {
    if (err instanceof FarmConfigError) {
      res.status(422).json({
        error: true,
        code: err.code,
        message: err.message,
        details: err.details,
      });
      return;
    }
    next(err);
  }
});

// GET /api/ocb-farm/admin/stats
//
// Thống kê sử dụng OCB Farm, lọc được theo phòng ban (task 8.3, US-46).
adminRouter.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await getAdminStats({
      department_id: typeof req.query.department_id === 'string' ? req.query.department_id : undefined,
    });
    res.status(200).json(stats);
  } catch (err) {
    if (err instanceof FarmConfigError) {
      res.status(422).json({
        error: true,
        code: err.code,
        message: err.message,
        details: err.details,
      });
      return;
    }
    next(err);
  }
});

// GET /api/ocb-farm/admin/audit
//
// Xem dòng lưu vết thao tác quản trị, chỉ đọc, phân trang (task 8.3, BR-27).
adminRouter.get('/audit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = await getAdminAuditPage({
      page: typeof req.query.page === 'string' ? req.query.page : undefined,
      page_size: typeof req.query.page_size === 'string' ? req.query.page_size : undefined,
      target_user_id: typeof req.query.target_user_id === 'string' ? req.query.target_user_id : undefined,
      action: typeof req.query.action === 'string' ? req.query.action : undefined,
    });
    res.status(200).json(page);
  } catch (err) {
    if (err instanceof FarmConfigError) {
      res.status(422).json({
        error: true,
        code: err.code,
        message: err.message,
        details: err.details,
      });
      return;
    }
    next(err);
  }
});

router.use('/admin', adminRouter);

export default router;
