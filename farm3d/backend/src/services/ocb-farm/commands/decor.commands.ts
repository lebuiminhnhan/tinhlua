/**
 * OCB Farm — nhóm lệnh trang trí: `BUY_DECOR`, `MOVE_DECOR`, `ROTATE_DECOR`,
 * `SELL_DECOR`.
 *
 * Mọi handler ở đây THUẦN theo đúng chữ ký `FarmCommandHandler<C>` (xem
 * `types.ts`): không đọc/ghi DB, không gọi `tick()` (state truyền vào đã
 * được `farm-command.service.ts` tick tới `ctx.now` trước khi dispatch) —
 * chỉ nhận `state` đã tick + `payload` + `ctx` rồi trả `success()`/`fail()`.
 *
 * ## Quyết định thiết kế (ghi lại để không lặp lại tranh luận ở các task sau)
 *
 * - **Giá theo NHÓM, không theo từng mã vật phẩm**: `DecorKind` là chuỗi tự
 *   do do manifest tài nguyên 3D (task 10.5) quyết định — không có danh
 *   sách mã cụ thể nào tồn tại ở tầng backend. Vì vậy giá được tra theo
 *   khóa cấu hình `decor_price_<group>` (7 nhóm trong `DECOR_GROUPS`, xem
 *   `20261001_014_seed_farm_config_decor_price.sql`), KHÔNG theo `kind`.
 *   `payload.kind` phải được map sang nhóm qua {@link decorGroupOfKind} —
 *   ở task này, quy ước đơn giản là `kind` CHÍNH LÀ tên nhóm (ví dụ mua
 *   `kind: 'lamp'` nghĩa là một vật phẩm thuộc nhóm đèn); khi manifest thật
 *   (task 10.5/10.6) định nghĩa nhiều mã cụ thể trong cùng một nhóm (ví dụ
 *   `lamp_lantern`, `lamp_post`), hàm này là ĐIỂM DUY NHẤT cần sửa để map
 *   đúng tiền tố mã sang nhóm.
 * - **`is_light`**: vật phẩm thuộc nhóm `lamp` là nguồn sáng (US-30, "vật
 *   phẩm trang trí là nguồn sáng được bật vào buổi đêm"); các nhóm khác thì
 *   không. Chưa có bảng ánh xạ chi tiết hơn theo từng mã cụ thể vì chưa có
 *   manifest — nhóm `lamp` là đủ để minh họa đúng ngữ nghĩa US-30 ở tầng
 *   dữ liệu.
 * - **Gating mua vật phẩm mùa lễ theo season đang hoạt động**: KHÔNG chặn ở
 *   backend. AC của US-33 chỉ nói "vật phẩm mùa lễ đã mua vẫn dùng được sau
 *   khi dịp kết thúc" — không có AC nào yêu cầu backend từ chối mua ngoài
 *   dịp. Việc "cửa hàng chỉ hiển thị vật phẩm mùa lễ trong thời gian diễn ra
 *   dịp" là một mối quan tâm về NIÊM YẾT (shop panel, task 13.x ở frontend)
 *   — backend chỉ gắn đúng `seasonal_tag` tại thời điểm mua nếu `kind`
 *   thuộc nhóm `seasonal` và một dịp đang hoạt động, còn nếu không có dịp
 *   nào hoạt động thì vẫn cho mua (không có AC nào cấm) nhưng `seasonal_tag`
 *   sẽ là `null` (vật phẩm "mùa lễ" mua ngoài dịp coi như vật phẩm thường).
 * - **Hoàn tiền khi bán (`SELL_DECOR`)**: không có AC riêng cho tỷ lệ hoàn
 *   tiền của trang trí trong US-34 (chỉ nói "hoàn một tỷ lệ theo cấu hình so
 *   với giá mua, làm tròn theo quy tắc cấu hình") — dùng lại đúng
 *   `resell_ratio` + `refund()` của `farm-economy.ts`, cùng cấu hình và quy
 *   tắc làm tròn (`Math.floor`) đã áp dụng cho `SELL_ANIMAL` (US-15), để
 *   không có hai khái niệm "tỷ lệ hoàn tiền" khác nhau trong cùng một app.
 *
 * `MOVE_DECOR` tách riêng khỏi `MOVE_ENTITY` nhánh `decor` để có một payload
 * gọn (`MoveDecorPayload` chỉ có `decor_id`/`to_cell`, không có
 * `entity_kind`) cho UI trang trí; `moveDecorEntity` export thêm ở đây để
 * `command-registry.ts` ghép vào dispatcher chung của `MOVE_ENTITY` (xem
 * TODO ở `animal.commands.ts`), tránh trùng lặp logic kiểm tra ô đích.
 *
 * _Requirements: US-30, US-32, US-33, US-34, US-35, US-36, US-37, BR-24, BR-28_
 */

import { randomUUID } from 'crypto';
import { canPlace } from '../farm-grid';
import { refund } from '../farm-economy';
import { seasonThemeAt } from '../farm-environment';
import {
  DecorGroup,
  DecorKind,
  DecorRotation,
  FarmDecor,
  FarmStateJson,
  decorGroupOf,
} from '../../../types/ocb-farm.types';
import { FarmCommandHandler, fail, success } from './types';

/** Nhóm vật phẩm trang trí là nguồn sáng, bật vào buổi đêm (US-30). */
const LIGHT_SOURCE_GROUPS: ReadonlySet<DecorGroup> = new Set<DecorGroup>(['lamp']);

/**
 * Map `kind` → nhóm giá/nhóm hành vi (`DecorGroup`). `kind` là tên nhóm (`lamp`)
 * hoặc `<nhóm>_<biến thể>` (`lamp_stand`) do manifest tài nguyên 3D khai báo —
 * mọi mã cùng nhóm dùng chung giá `decor_price_<group>`. Trả `null` khi không
 * khớp nhóm nào (payload không hợp lệ).
 */
function decorGroupOfKind(kind: DecorKind): DecorGroup | null {
  return decorGroupOf(kind);
}

/** Giá mua của nhóm `group`, tra theo khóa cấu hình `decor_price_<group>`. */
function decorPrice(group: DecorGroup, config: Record<string, number>): number {
  return config[`decor_price_${group}`] ?? 0;
}

function findDecorIndex(state: FarmStateJson, decorId: string): number {
  return state.decors.findIndex((decor) => decor.id === decorId);
}

function decorPlacementMessage(reason: string): string {
  switch (reason) {
    case 'CENTER_CELL_RESERVED':
      return 'Ô trung tâm dành riêng cho Cây OCB, không thể đặt vật phẩm trang trí.';
    case 'PLOT_LOCKED':
    case 'INVALID_CELL':
      return 'Ô đã chọn thuộc vùng đất chưa mở khoá.';
    case 'WRONG_TERRAIN':
      return 'Sai loại địa hình cho vật phẩm trang trí này.';
    case 'CELL_OCCUPIED':
      return 'Ô đã chọn đã có vật nuôi, cây hoặc vật phẩm trang trí khác.';
    default:
      return 'Không thể đặt vật phẩm trang trí vào ô đã chọn.';
  }
}

// ============================================================================
// BUY_DECOR (US-33, US-34, US-37, BR-28)
// ============================================================================

const buyDecor: FarmCommandHandler<'BUY_DECOR'> = (state, payload, ctx) => {
  const { kind, cell } = payload;

  const group = decorGroupOfKind(kind);
  if (!group) {
    return fail('INVALID_PAYLOAD', 'Loại vật phẩm trang trí không hợp lệ.', { kind });
  }

  const maxDecors = ctx.config['max_decors'] ?? 60;
  if (state.decors.length >= maxDecors) {
    return fail(
      'DECOR_LIMIT_REACHED',
      `Nông trại đã đạt giới hạn ${maxDecors} vật phẩm trang trí.`,
      { current: state.decors.length, max: maxDecors },
    );
  }

  const price = decorPrice(group, ctx.config);
  if (ctx.seeds < price) {
    return fail(
      'INSUFFICIENT_SEEDS',
      `Không đủ Hạt OCB để mua vật phẩm này. Còn thiếu ${price - ctx.seeds} Hạt OCB.`,
      { required: price, current_balance: ctx.seeds, missing: price - ctx.seeds },
    );
  }

  const placement = canPlace(state, cell, 'decor');
  if (!placement.ok) {
    return fail(placement.reason, decorPlacementMessage(placement.reason));
  }

  // Vật phẩm mùa lễ chỉ mang `seasonal_tag` khi một dịp đang hoạt động tại
  // thời điểm mua (US-33, AC "vật phẩm mùa lễ đã mua vẫn dùng được sau khi
  // dịp kết thúc" — không có AC chặn mua ngoài dịp, nên không từ chối ở đây,
  // chỉ không gắn tag nếu không có dịp nào đang diễn ra).
  const activeSeason = group === 'seasonal' ? seasonThemeAt(ctx.now) : null;

  const newDecor: FarmDecor = {
    id: randomUUID(),
    kind,
    cell,
    rotation: payload.rotation ?? 0,
    is_light: LIGHT_SOURCE_GROUPS.has(group),
    seasonal_tag: activeSeason?.theme ?? null,
  };

  const nextState: FarmStateJson = { ...state, decors: [...state.decors, newDecor] };

  return success(nextState, {
    seedsDelta: -price,
    ledgerLines: [
      {
        kind: 'buy_decor',
        amount: -price,
        refType: 'decor',
        refId: newDecor.id,
        note: `Mua vật phẩm trang trí (${kind})`,
      },
    ],
  });
};

// ============================================================================
// MOVE_DECOR (US-34 — di chuyển miễn phí)
// ============================================================================

/**
 * Logic di chuyển một vật phẩm trang trí, dùng chung bởi cả `MOVE_DECOR`
 * (payload gọn riêng cho trang trí) và nhánh `decor` của `MOVE_ENTITY`
 * (dispatcher tổng hợp ở `command-registry.ts`) — tránh viết hai lần cùng
 * một quy tắc kiểm tra ô đích.
 */
export function moveDecorEntity(
  state: FarmStateJson,
  decorId: string,
  toCell: string,
): ReturnType<FarmCommandHandler<'MOVE_DECOR'>> {
  const index = findDecorIndex(state, decorId);
  if (index === -1) {
    return fail('DECOR_NOT_FOUND', 'Không tìm thấy vật phẩm trang trí này.');
  }

  const decor = state.decors[index];

  const placement = canPlace(state, toCell, 'decor', { ignoreEntityId: decor.id });
  if (!placement.ok) {
    return fail(placement.reason, decorPlacementMessage(placement.reason));
  }

  const decors = [...state.decors];
  decors[index] = { ...decor, cell: toCell };

  return success({ ...state, decors });
}

const moveDecor: FarmCommandHandler<'MOVE_DECOR'> = (state, payload) =>
  moveDecorEntity(state, payload.decor_id, payload.to_cell);

// ============================================================================
// ROTATE_DECOR (US-34 — xoay miễn phí, hướng lưu bền)
// ============================================================================

const VALID_ROTATIONS: ReadonlySet<DecorRotation> = new Set<DecorRotation>([0, 90, 180, 270]);

const rotateDecor: FarmCommandHandler<'ROTATE_DECOR'> = (state, payload) => {
  const index = findDecorIndex(state, payload.decor_id);
  if (index === -1) {
    return fail('DECOR_NOT_FOUND', 'Không tìm thấy vật phẩm trang trí này.');
  }

  if (!VALID_ROTATIONS.has(payload.rotation)) {
    return fail('INVALID_PAYLOAD', 'Hướng xoay không hợp lệ, chỉ nhận 0/90/180/270 độ.', {
      rotation: payload.rotation,
    });
  }

  const decor = state.decors[index];
  const decors = [...state.decors];
  decors[index] = { ...decor, rotation: payload.rotation };

  return success({ ...state, decors });
};

// ============================================================================
// SELL_DECOR (US-34)
// ============================================================================

const sellDecor: FarmCommandHandler<'SELL_DECOR'> = (state, payload, ctx) => {
  const index = findDecorIndex(state, payload.decor_id);
  if (index === -1) {
    return fail('DECOR_NOT_FOUND', 'Không tìm thấy vật phẩm trang trí này.');
  }

  const decor = state.decors[index];
  const group = decorGroupOfKind(decor.kind);
  const purchasePrice = group ? decorPrice(group, ctx.config) : 0;
  const refundAmount = refund(purchasePrice, ctx.config);

  const decors = state.decors.filter((d) => d.id !== decor.id);

  return success(
    { ...state, decors },
    {
      seedsDelta: refundAmount,
      ledgerLines: [
        {
          kind: 'sell_decor',
          amount: refundAmount,
          refType: 'decor',
          refId: decor.id,
          note: `Bán vật phẩm trang trí (${decor.kind})`,
        },
      ],
    },
  );
};

// ============================================================================
// Đăng ký — export để `command-registry.ts` spread vào `COMMAND_REGISTRY`
// ============================================================================

export const DECOR_COMMAND_HANDLERS = {
  BUY_DECOR: buyDecor,
  MOVE_DECOR: moveDecor,
  ROTATE_DECOR: rotateDecor,
  SELL_DECOR: sellDecor,
};
