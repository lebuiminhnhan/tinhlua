/**
 * OCB Farm — các hàm thuần kiểm tra quy tắc đặt vật thể trên lưới ô đất.
 *
 * Module này chỉ quyết định "có đặt được không" (và mở rộng vùng đất có hợp
 * lệ không) dựa trên `FarmStateJson` hiện có — không đọc/ghi DB, không có
 * side effect nào khác. `farm-command.service` (task 5.x) gọi các hàm này
 * trước khi áp lệnh `BUY_ANIMAL` / `PLANT_SEED` / `BUY_DECOR` / `MOVE_ENTITY`
 * / `EXPAND_PLOT` để quyết định chấp nhận hay từ chối kèm mã lỗi nghiệp vụ.
 *
 * _Requirements: US-9, US-10, US-14, US-15, US-22, US-24, US-28, US-34, BR-9, BR-10, BR-18, BR-19_
 */

import {
  FarmCellRef,
  FarmEntityKind,
  FarmErrorCode,
  FarmPlot,
  FarmSpecies,
  FarmStateJson,
} from '../../types/ocb-farm.types';

/** Loại thực thể mà `canPlace` biết kiểm tra — bao gồm cả vật nuôi cụ thể theo loài. */
export type PlaceableKind = FarmEntityKind;

/**
 * Kết quả discriminated của mọi hàm kiểm tra trong module này — cho phép
 * caller thu hẹp kiểu bằng `if (result.ok)` và luôn có mã lỗi ổn định để
 * hiển thị/HTTP 422 khi bị từ chối.
 */
export type FarmGridCheckResult = { ok: true } | { ok: false; reason: FarmErrorCode };

const OK: FarmGridCheckResult = { ok: true };

function fail(reason: FarmErrorCode): FarmGridCheckResult {
  return { ok: false, reason };
}

/**
 * Ô trung tâm của nông trại — nơi Cây OCB cố định, bất khả xâm phạm (BR-1, US-9).
 *
 * Quy ước: ô trung tâm luôn là ô đầu tiên (`cells[0]`) của vùng đất số 1
 * (vùng khởi đầu), khớp với cách `farm-state.repository` khởi tạo nông trại
 * mới (task 4.2). Tách thành hàm riêng để không lặp lại giả định này ở nhiều
 * nơi và dễ thay đổi nếu cách khởi tạo đổi khác.
 */
export function centerCell(state: FarmStateJson): FarmCellRef | null {
  const startingPlot = state.plots.find((plot) => plot.id === 1);
  return startingPlot?.cells[0] ?? null;
}

/** Tìm vùng đất (nếu có) chứa `cell`, bất kể đã mở khóa hay chưa. */
function findPlotByCell(state: FarmStateJson, cell: FarmCellRef): FarmPlot | undefined {
  return state.plots.find((plot) => plot.cells.includes(cell));
}

/** `true` khi `cell` đang bị một vật nuôi, cây trồng hoặc vật phẩm trang trí khác chiếm. */
function isCellOccupied(state: FarmStateJson, cell: FarmCellRef, ignoreEntityId?: string): boolean {
  const occupiedByAnimal = state.animals.some(
    (animal) => animal.cell === cell && animal.id !== ignoreEntityId
  );
  const occupiedByPlant = state.plants.some(
    (plant) => plant.cell === cell && plant.id !== ignoreEntityId
  );
  const occupiedByDecor = state.decors.some(
    (decor) => decor.cell === cell && decor.id !== ignoreEntityId
  );
  return occupiedByAnimal || occupiedByPlant || occupiedByDecor;
}

/**
 * Kiểm tra một thực thể loại `kind` (và loài `species` nếu là vật nuôi) có
 * đặt được vào `cell` không, theo đúng thứ tự quy tắc của US-9, US-10, US-15:
 *
 * 1. Ô trung tâm (Cây OCB) bất khả xâm phạm — không nhận bất kỳ thực thể nào khác.
 * 2. Ô phải thuộc một vùng đất đã mở khóa.
 * 3. Cá (`species === 'fish'`) chỉ đặt được trên địa hình `water`; mọi loài
 *    vật nuôi khác, cây trồng và vật phẩm trang trí chỉ đặt được trên `land`.
 * 4. Ô không được đã bị vật nuôi/cây trồng/vật phẩm trang trí khác chiếm.
 *
 * `ignoreEntityId` dùng khi kiểm tra di chuyển (`MOVE_ENTITY`, US-15): thực
 * thể đang được di chuyển không tự chặn chính ô mà nó rời đi nếu đích trùng
 * ô cũ (trường hợp không đổi ô).
 *
 * _Requirements: US-9, US-10, US-15, BR-18_
 */
export function canPlace(
  state: FarmStateJson,
  cell: FarmCellRef,
  kind: PlaceableKind,
  options?: { species?: FarmSpecies; ignoreEntityId?: string }
): FarmGridCheckResult {
  if (cell === centerCell(state)) {
    return fail('CENTER_CELL_RESERVED');
  }

  const plot = findPlotByCell(state, cell);
  if (!plot) {
    return fail('INVALID_CELL');
  }
  if (!plot.unlocked) {
    return fail('PLOT_LOCKED');
  }

  const requiresWater = kind === 'animal' && options?.species === 'fish';
  const requiredTerrain = requiresWater ? 'water' : 'land';
  if (plot.terrain !== requiredTerrain) {
    return fail('WRONG_TERRAIN');
  }

  if (isCellOccupied(state, cell, options?.ignoreEntityId)) {
    return fail('CELL_OCCUPIED');
  }

  return OK;
}

/**
 * Kiểm tra vùng đất `plotId` có mở rộng được không (`EXPAND_PLOT`, US-24):
 * phải tồn tại, chưa mở khóa, và kề với ít nhất một vùng đất đã mở khóa.
 *
 * Kề nhau nghĩa là có ít nhất một ô của vùng đích liền cạnh (trên/dưới/
 * trái/phải — không tính đường chéo) một ô thuộc vùng đã mở khóa. Ô đất
 * dùng tham chiếu dạng `"hàng,cột"` (`FarmCellRef`), xem `parseCellRef`.
 *
 * _Requirements: US-24, BR-10_
 */
export function canExpandPlot(state: FarmStateJson, plotId: number): FarmGridCheckResult {
  const targetPlot = state.plots.find((plot) => plot.id === plotId);
  if (!targetPlot) {
    return fail('INVALID_CELL');
  }
  if (targetPlot.unlocked) {
    return fail('PLOT_ALREADY_UNLOCKED');
  }

  const unlockedPlots = state.plots.filter((plot) => plot.unlocked);
  if (unlockedPlots.length === 0) {
    return fail('PLOT_NOT_ADJACENT');
  }

  const unlockedCells = new Set<FarmCellRef>();
  for (const plot of unlockedPlots) {
    for (const cell of plot.cells) {
      unlockedCells.add(cell);
    }
  }

  const isAdjacent = targetPlot.cells.some((cell) =>
    adjacentCellRefs(cell).some((neighbor) => unlockedCells.has(neighbor))
  );

  if (!isAdjacent) {
    return fail('PLOT_NOT_ADJACENT');
  }

  return OK;
}

/** Phân tích `"hàng,cột"` thành cặp số nguyên — trả `null` nếu sai định dạng. */
function parseCellRef(cell: FarmCellRef): { row: number; col: number } | null {
  const match = /^(-?\d+),(-?\d+)$/.exec(cell);
  if (!match) {
    return null;
  }
  return { row: Number(match[1]), col: Number(match[2]) };
}

/** 4 ô liền cạnh (trên/dưới/trái/phải) của `cell` — bỏ qua nếu `cell` sai định dạng. */
function adjacentCellRefs(cell: FarmCellRef): FarmCellRef[] {
  const parsed = parseCellRef(cell);
  if (!parsed) {
    return [];
  }
  const { row, col } = parsed;
  return [
    `${row - 1},${col}`,
    `${row + 1},${col}`,
    `${row},${col - 1}`,
    `${row},${col + 1}`,
  ];
}
