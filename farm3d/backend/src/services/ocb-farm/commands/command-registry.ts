/**
 * OCB Farm — bảng tra mã lệnh → handler, dùng bởi `farm-command.service.ts`.
 *
 * Đây là ĐIỂM MỞ RỘNG DUY NHẤT cho các task 5.2-5.6: mỗi module lệnh
 * (`animal.commands.ts`, `plant.commands.ts`, `economy.commands.ts`,
 * `decor.commands.ts`, `settings.commands.ts`, `daily.commands.ts`) export
 * một object con khớp một phần của `FarmCommandHandlerMap`, rồi được gộp
 * vào `COMMAND_REGISTRY` ở đây bằng spread — KHÔNG module nào khác cần sửa
 * `farm-command.service.ts` để thêm một lệnh mới.
 *
 * `RENAME_FARM`/`UPDATE_SETTINGS` được triển khai thật trong
 * `settings.commands.ts` (task 5.5); `BUY_DECOR`/`MOVE_DECOR`/
 * `ROTATE_DECOR`/`SELL_DECOR` trong `decor.commands.ts` (task 5.5);
 * `CLAIM_CHECKIN`/`PICK_ANNIVERSARY_FRUIT`/`SELECT_BADGES` trong
 * `daily.commands.ts` (task 5.6).
 * `MOVE_ENTITY` là dispatcher tổng hợp theo `payload.entity_kind` ngay dưới
 * đây — nhánh `'animal'` gọi lại `moveAnimalEntity` (animal.commands.ts),
 * nhánh `'decor'` gọi lại `moveDecorEntity` (decor.commands.ts), nhánh
 * `'plant'` tiếp tục trả `INVALID_COMMAND` (không có AC nào cho phép di
 * chuyển một cây đã trồng — xem ghi chú ở đầu `plant.commands.ts`). Chỉ
 * `command-registry.ts` (ở đây) cần biết cả hai module để ghép dispatcher
 * này — tránh import vòng giữa `animal.commands.ts` và `decor.commands.ts`.
 *
 * _Requirements: US-21, US-29, US-40, BR-9, BR-12, BR-27_
 */

import { FarmCommandCode, FarmCommandPayloadMap } from '../../../types/ocb-farm.types';
import { FarmCommandContext, FarmCommandHandler, FarmCommandHandlerResult, fail } from './types';
import { ANIMAL_COMMAND_HANDLERS, moveAnimalEntity } from './animal.commands';
import { PLANT_COMMAND_HANDLERS } from './plant.commands';
import { ECONOMY_COMMAND_HANDLERS } from './economy.commands';
import { DECOR_COMMAND_HANDLERS, moveDecorEntity } from './decor.commands';
import { SETTINGS_COMMAND_HANDLERS } from './settings.commands';
import { DAILY_COMMAND_HANDLERS } from './daily.commands';
import { BOOST_COMMAND_HANDLERS } from './boost.commands';

/** Map đầy đủ — mỗi mã lệnh trong `FarmCommandCode` PHẢI có đúng một handler. */
export type FarmCommandHandlerMap = {
  [C in FarmCommandCode]: FarmCommandHandler<C>;
};

// ============================================================================
// MOVE_ENTITY — dispatcher tổng hợp theo `entity_kind` (US-15, US-34)
// ============================================================================

const moveEntity: FarmCommandHandler<'MOVE_ENTITY'> = (state, payload, ctx) => {
  switch (payload.entity_kind) {
    case 'animal':
      return moveAnimalEntity(state, payload.entity_id, payload.to_cell);
    case 'decor':
      return moveDecorEntity(state, payload.entity_id, payload.to_cell);
    default:
      return fail('INVALID_COMMAND', 'Di chuyển loại thực thể này chưa được hỗ trợ.', {
        entity_kind: payload.entity_kind,
      });
  }
};

// ============================================================================
// Đăng ký — mọi mã lệnh khác là stub cho tới khi 5.6 thay thế
// ============================================================================

export const COMMAND_REGISTRY: FarmCommandHandlerMap = {
  // Vật nuôi (US-10..US-15) — task 5.2
  ...ANIMAL_COMMAND_HANDLERS,

  // Cây trồng (US-16..US-20) — task 5.3
  ...PLANT_COMMAND_HANDLERS,

  // Kho, bán, mở rộng đất (US-21, US-22, US-24) — task 5.4
  ...ECONOMY_COMMAND_HANDLERS,

  // Trang trí (US-33, US-34, US-37) — task 5.5
  ...DECOR_COMMAND_HANDLERS,

  // Đổi tên, cài đặt (US-30, US-32, US-35, US-36) — task 5.5
  ...SETTINGS_COMMAND_HANDLERS,

  // Check-in, kỷ niệm, huy hiệu (US-7, US-25, US-29) — task 5.6
  ...DAILY_COMMAND_HANDLERS,

  // Thuốc tăng trưởng, phân bón siêu cấp
  ...BOOST_COMMAND_HANDLERS,

  // `MOVE_ENTITY` ghi đè bản vật nuôi-only của `ANIMAL_COMMAND_HANDLERS`
  // bằng dispatcher tổng hợp ở trên — PHẢI đứng SAU spread
  // `ANIMAL_COMMAND_HANDLERS` để thắng giá trị cũ.
  MOVE_ENTITY: moveEntity,
};

/**
 * Áp lệnh `command` lên `state` bằng handler đã đăng ký — điểm gọi duy nhất
 * mà `farm-command.service.ts` dùng, để không bao giờ cần một `switch` liệt
 * kê toàn bộ `FarmCommandCode` ở tầng transaction.
 */
export function dispatchCommand<C extends FarmCommandCode>(
  command: C,
  state: Parameters<FarmCommandHandler<C>>[0],
  payload: FarmCommandPayloadMap[C],
  ctx: FarmCommandContext,
): FarmCommandHandlerResult {
  const handler = COMMAND_REGISTRY[command] as FarmCommandHandler<C>;
  return handler(state, payload, ctx);
}
