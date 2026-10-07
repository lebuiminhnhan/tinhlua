/**
 * OCB Farm — hàm thuần mô phỏng tiến trình thời gian của một nông trại
 * (D2: "Mô phỏng thời gian là hàm thuần"): `tick(state, fromTs, toTs, config)`.
 *
 * Đây là module trung tâm cho phép server tính lại đúng một trạng thái nông
 * trại bất kể nhân viên online hay offline bao lâu — `farm-command.service`
 * (task 5.x) gọi `tick()` từ `last_tick_at` đến thời điểm hiện tại TRƯỚC khi
 * áp bất kỳ lệnh nào, và `GET /me` (task 4.2) gọi lại đúng hàm này để tính
 * bảng tổng kết offline (US-23). Không đọc/ghi DB, không có side effect nào
 * khác, không dùng `Date.now()` hay số ngẫu nhiên (ngoại trừ qua các hàm
 * thuần `weatherAt`/`rainWindowsBetween` của `farm-environment.ts`) — cùng
 * đầu vào (`state`, `fromTs`, `toTs`, `config`) luôn cho cùng đầu ra.
 *
 * Ba hệ quả nghiệp vụ mà `tick()` mô phỏng, đều tính theo mili-giây trôi
 * qua trong `[fromTs, toTs)`:
 *
 * 1. Độ no vật nuôi giảm dần về sàn 0 theo `fullness_decay_hours` (BR-15) —
 *    không bao giờ khiến vật nuôi biến mất, chỉ chuyển sang trạng thái buồn.
 * 2. Sinh trưởng cây bị đóng băng khi thiếu nước (BR-16) — trừ các khoảng
 *    thời gian có mưa trong `[fromTs, toTs)`, tự động coi là đủ nước.
 * 3. Sản phẩm vật nuôi/cây tích lũy vào `pending`, có trần riêng cho từng
 *    đối tượng theo `offline_cap_per_entity` (BR-17); vật nuôi dừng tích
 *    lũy kể từ thời điểm độ no về 0.
 *
 * _Requirements: US-12, US-17, US-18, US-23, US-31, BR-15, BR-16, BR-17_
 */

import {
  FarmAnimal,
  FarmPlant,
  FarmStateJson,
  PLANT_STAGES,
  PlantStage,
  StorageKey,
} from '../../types/ocb-farm.types';
import { rainWindowsBetween, RainWindow } from './farm-environment';

const MS_PER_HOUR = 60 * 60 * 1000;

/** Thông số cân bằng game — tra theo khóa, khớp `FarmConfigResponse.values`. */
export type FarmSimulationConfig = Record<string, number>;

/** Sản phẩm thu hoạch của mỗi loài vật nuôi — ngựa không có sản phẩm (US-13). */
const ANIMAL_PRODUCT_BY_SPECIES: Partial<Record<FarmAnimal['species'], StorageKey>> = {
  chicken: 'egg',
  cow: 'milk',
  sheep: 'wool',
  fish: 'fish',
  pig: 'manure',
};

/** Khóa kho tương ứng với một cây (quả hoặc hoa) — tiền tố theo `StorageKey`. */
function plantStorageKey(kind: FarmPlant['kind']): StorageKey {
  const isFlower = kind === 'sunflower' || kind === 'daisy' || kind === 'rose';
  return (isFlower ? `flower_${kind}` : `fruit_${kind}`) as StorageKey;
}

/**
 * Một đối tượng (vật nuôi hoặc cây) đã đạt trần tích lũy `offline_cap_per_entity`
 * trong khoảng `[fromTs, toTs)` — dùng để dựng bảng tổng kết offline (US-23).
 */
export interface FarmSimulationCappedEntity {
  entity_kind: 'animal' | 'plant';
  entity_id: string;
  storage_key: StorageKey;
}

/** Số lượng tích lũy được của một loại sản phẩm trong lượt `tick` hiện tại. */
export interface FarmSimulationAccrualItem {
  key: StorageKey;
  quantity: number;
}

/**
 * Bảng tổng kết những gì đã tích lũy trong `[fromTs, toTs)` — dùng bởi
 * `GET /me` để hiển thị hộp thoại tổng kết vắng mặt (US-23) và bởi
 * `farm-command.service` để biết có cần phát `OFFLINE_SUMMARY_READY` hay
 * không. Không mang thông tin trạng thái ngoài phạm vi lượt tick này —
 * caller tự quyết định ngưỡng "đủ dài để hiển thị" (ví dụ so `away_ms` với
 * chu kỳ sản phẩm ngắn nhất) vì đó là quyết định hiển thị, không phải mô
 * phỏng nghiệp vụ.
 */
export interface FarmOfflineSimulationSummary {
  /** = `toTs.getTime() - fromTs.getTime()`, kẹp về 0 khi `toTs <= fromTs`. */
  away_ms: number;
  /** Tổng tích lũy trong lượt tick, gộp theo loại sản phẩm (US-23). */
  items: FarmSimulationAccrualItem[];
  /** Từng đối tượng đã đạt trần `offline_cap_per_entity` trong lượt tick này. */
  capped_entities: FarmSimulationCappedEntity[];
  /** Số chu kỳ mưa đã tự động tưới cây trong `[fromTs, toTs)` (US-31). */
  rain_cycles: number;
}

/** Kết quả của `tick()`: state đã mô phỏng tiếp + bảng tổng kết của riêng lượt này. */
export interface FarmTickResult {
  state: FarmStateJson;
  summary: FarmOfflineSimulationSummary;
}

/**
 * Mô phỏng tiến trình của `state` từ `fromTs` đến `toTs`, là hàm thuần
 * (D2). Trả về state đã cập nhật (độ no, sinh trưởng, tích lũy sản phẩm)
 * cùng bảng tổng kết những gì tích lũy được trong đúng khoảng này.
 *
 * Nếu `toTs <= fromTs` (lệch đồng hồ hoặc gọi lại không có thời gian trôi
 * qua), trả về `state` KHÔNG ĐỔI (tham chiếu mới nhưng nội dung giống hệt)
 * và bảng tổng kết rỗng — không trừ hay làm mất bất kỳ tiến trình đã tích
 * lũy trước đó (US-23, AC "khoảng thời gian âm hoặc bằng 0").
 *
 * `weatherSeed` truyền qua cho `rainWindowsBetween` để xác định các chu kỳ
 * mưa trong khoảng — mặc định 0, khớp seed mặc định dùng ở nơi khác khi
 * không cấu hình riêng theo môi trường.
 *
 * _Requirements: US-12, US-17, US-18, US-23, US-31, BR-15, BR-16, BR-17_
 */
export function tick(
  state: FarmStateJson,
  fromTs: Date,
  toTs: Date,
  config: FarmSimulationConfig,
  weatherSeed = 0
): FarmTickResult {
  if (toTs.getTime() <= fromTs.getTime()) {
    return { state, summary: emptySummary() };
  }

  const rainWindows = rainWindowsBetween(fromTs, toTs, weatherSeed);

  const accrual = new Map<StorageKey, number>();
  const cappedEntities: FarmSimulationCappedEntity[] = [];

  const animals = state.animals.map((animal) =>
    tickAnimal(animal, fromTs, toTs, config, accrual, cappedEntities)
  );

  const plants = state.plants.map((plant) =>
    tickPlant(plant, fromTs, toTs, config, rainWindows, accrual, cappedEntities)
  );

  const nextState: FarmStateJson = { ...state, animals, plants };

  const summary: FarmOfflineSimulationSummary = {
    away_ms: toTs.getTime() - fromTs.getTime(),
    items: Array.from(accrual.entries()).map(([key, quantity]) => ({ key, quantity })),
    capped_entities: cappedEntities,
    rain_cycles: rainWindows.length,
  };

  return { state: nextState, summary };
}

function emptySummary(): FarmOfflineSimulationSummary {
  return { away_ms: 0, items: [], capped_entities: [], rain_cycles: 0 };
}

function addAccrual(accrual: Map<StorageKey, number>, key: StorageKey, quantity: number): void {
  if (quantity <= 0) return;
  accrual.set(key, (accrual.get(key) ?? 0) + quantity);
}

// ============================================================================
// 1. Vật nuôi — độ no và tích lũy sản phẩm (US-12, US-13, BR-15, BR-17)
// ============================================================================

/**
 * Mô phỏng một vật nuôi từ `fromTs` đến `toTs`: giảm độ no về sàn 0 theo
 * `fullness_decay_hours`, và tích lũy sản phẩm vào `pending` (có trần
 * `offline_cap_per_entity`) chỉ trong phần thời gian mà độ no > 0.
 *
 * Độ no tại `fromTs` được coi là `animal.fullness` hiện có (đã phản ánh
 * đúng thời điểm `fed_at`/tick trước) — hàm này chỉ áp dụng phần suy giảm
 * thêm trong khoảng `[fromTs, toTs)`, không tính lại từ `fed_at` để tránh
 * nhân đôi phần suy giảm đã áp ở lượt tick trước.
 */
function tickAnimal(
  animal: FarmAnimal,
  fromTs: Date,
  toTs: Date,
  config: FarmSimulationConfig,
  accrual: Map<StorageKey, number>,
  cappedEntities: FarmSimulationCappedEntity[]
): FarmAnimal {
  const decayHours = Math.max(config['fullness_decay_hours'] ?? 24, 0.0001);
  const decayPerMs = 100 / (decayHours * MS_PER_HOUR);

  const elapsedMs = toTs.getTime() - fromTs.getTime();

  // Thời điểm (tương đối trong khoảng) mà độ no chạm 0 — sau đó dừng tạo
  // sản phẩm mới (US-12), nhưng độ no vẫn hiển thị đúng là 0, không âm.
  const msUntilZero = animal.fullness > 0 ? animal.fullness / decayPerMs : 0;
  const productiveMs = animal.fullness > 0 ? Math.min(msUntilZero, elapsedMs) : 0;

  const nextFullness = Math.max(0, animal.fullness - decayPerMs * elapsedMs);

  const productKey = ANIMAL_PRODUCT_BY_SPECIES[animal.species];
  let nextPending = animal.pending;
  let nextCycleStartedAt = animal.cycle_started_at;

  if (productKey) {
    const cap = Math.max(config['offline_cap_per_entity'] ?? 0, 0);
    const cycleHours = config[`produce_cycle_${animal.species}`] ?? 0;
    const cycleMs = cycleHours * MS_PER_HOUR;

    if (cycleMs > 0) {
      // Tiến độ chu kỳ hiện tại được MANG SANG giữa các lượt tick qua
      // `cycle_started_at` (mốc neo: tiến độ = thời điểm − mốc neo). Trước đây
      // mỗi lượt tick chỉ tính `floor(productiveMs / cycleMs)` trong khoảng của
      // riêng lượt đó → mở `/me` thường xuyên (mỗi lượt < 1 chu kỳ) làm mất
      // phần dư, vật nuôi gần như không bao giờ cho sản phẩm.
      const anchor = Date.parse(animal.cycle_started_at);
      const carried = Number.isFinite(anchor)
        ? Math.min(Math.max(fromTs.getTime() - anchor, 0), cycleMs - 1)
        : 0;
      const total = carried + productiveMs;
      const cyclesCompleted = Math.floor(total / cycleMs);
      const roomLeft = cap > 0 ? Math.max(cap - animal.pending, 0) : 0;
      const produced = Math.min(cyclesCompleted, roomLeft);

      if (produced > 0) {
        addAccrual(accrual, productKey, produced);
        nextPending = animal.pending + produced;
      }
      // Đầy trần thì giữ tiến độ ở mức "vừa xong một chu kỳ" — thu hoạch là có ngay sản phẩm kế tiếp.
      const progress = cyclesCompleted > produced ? cycleMs - 1 : total - cyclesCompleted * cycleMs;
      nextCycleStartedAt = new Date(toTs.getTime() - progress).toISOString();
    }

    // Đạt trần nghĩa là: đã có đủ thời gian sản xuất (kể cả trước lượt tick
    // này) để lấp đầy `cap`, bất kể có sinh ra sản phẩm mới trong lượt này
    // hay không — dùng `nextPending >= cap` (sau khi cộng phần vừa tích
    // lũy) để bảng tổng kết luôn phản ánh đúng trạng thái hiện tại (BR-17).
    if (cap > 0 && nextPending >= cap) {
      cappedEntities.push({
        entity_kind: 'animal',
        entity_id: animal.id,
        storage_key: productKey,
      });
    }
  }

  return { ...animal, fullness: nextFullness, pending: nextPending, cycle_started_at: nextCycleStartedAt };
}

// ============================================================================
// 2. Cây trồng — sinh trưởng, tưới nước tự động khi mưa, thu hoạch chờ (US-17, US-18, US-31, BR-16)
// ============================================================================

/** Số lượt chuyển giai đoạn (seed→sprout→...→ready) — tổng thời gian sinh trưởng chia đều cho mỗi lượt. */
const PLANT_STAGE_TRANSITIONS = PLANT_STAGES.length - 1;

/** Giai đoạn kế tiếp theo đúng thứ tự `PLANT_STAGES` — `null` khi đã ở `ready` (không tự thu hoạch). */
function nextPlantStage(stage: PlantStage): PlantStage | null {
  const index = PLANT_STAGES.indexOf(stage);
  if (index === -1 || index >= PLANT_STAGE_TRANSITIONS) return null;
  return PLANT_STAGES[index + 1];
}

/** Thời gian (ms) cần để đi qua một giai đoạn của loại cây `kind`, chia đều từ `grow_total_<kind>`. */
function stageDurationMs(kind: FarmPlant['kind'], config: FarmSimulationConfig): number {
  const totalHours = config[`grow_total_${kind}`] ?? 0;
  if (totalHours <= 0) return 0;
  return (totalHours * MS_PER_HOUR) / PLANT_STAGE_TRANSITIONS;
}

/**
 * `true` khi cây được coi là đủ nước tại thời điểm `at`, tức là `at` chưa
 * vượt quá `watered_at + water_interval`. Đây chỉ là điều kiện tưới tay —
 * các khoảng mưa được xử lý riêng bằng cách "dịch" `watered_at` hiệu dụng
 * tới cuối đoạn mưa (xem nhánh xử lý mưa trong `tickPlant`).
 */
function isWithinWaterInterval(
  wateredAt: Date,
  at: Date,
  waterIntervalHours: number
): boolean {
  const deadline = wateredAt.getTime() + waterIntervalHours * MS_PER_HOUR;
  return at.getTime() < deadline;
}

/**
 * Mô phỏng một cây từ `fromTs` đến `toTs`: cộng thời gian sinh trưởng chỉ
 * trong các khoảng đủ nước (tưới tay còn hiệu lực HOẶC trong một chu kỳ
 * mưa — US-31), đóng băng phần còn lại (BR-16); khi đủ thời gian một giai
 * đoạn, chuyển sang giai đoạn kế tiếp theo đúng thứ tự (US-17).
 *
 * `FarmPlant` không có bộ đếm `pending` như vật nuôi — một cây chỉ giữ
 * được đúng MỘT đơn vị sản phẩm chờ tại một thời điểm: khi đạt `ready`,
 * cây dừng lại ở đó (không tự thu hoạch, không tự chuyển tiếp chu kỳ mới)
 * cho tới khi nhân viên gọi lệnh `HARVEST_PLANT` — kể cả cây ăn quả, việc
 * "quay lại giai đoạn ra quả" (US-20) chỉ xảy ra SAU thao tác thu hoạch,
 * không xảy ra trong lúc mô phỏng offline. Vì vậy trần tích lũy cho cây
 * (BR-17) tương đương với "đã đạt `ready` hay chưa": một cây đạt `ready`
 * trong khoảng vắng mặt được tính là đã tích lũy đúng 1 đơn vị và đạt trần
 * ngay tại đó — thời gian vắng mặt còn lại sau khi đạt `ready` không tạo
 * thêm sản phẩm nào nữa (khớp AC "trần tối thiểu 1" một cách tự nhiên vì
 * cây không có chỗ chứa quả thứ hai khi chưa thu hoạch quả đầu).
 *
 * Xử lý theo từng đoạn nhỏ (segment) giữa các ranh giới đủ-nước/thiếu-nước
 * — ranh giới do hết `water_interval` hoặc do bắt đầu/kết thúc một chu kỳ
 * mưa — để mỗi đoạn có đúng một trạng thái nước không đổi.
 */
function tickPlant(
  plant: FarmPlant,
  fromTs: Date,
  toTs: Date,
  config: FarmSimulationConfig,
  rainWindows: RainWindow[],
  accrual: Map<StorageKey, number>,
  cappedEntities: FarmSimulationCappedEntity[]
): FarmPlant {
  const waterIntervalHours = config['water_interval'] ?? 8;
  const storageKey = plantStorageKey(plant.kind);

  if (plant.stage === 'ready') {
    // Đã sẵn sàng thu hoạch từ trước lượt tick này — không sinh trưởng
    // thêm gì, và đã ở trạng thái "trần" (đang giữ đúng 1 đơn vị chờ).
    cappedEntities.push({ entity_kind: 'plant', entity_id: plant.id, storage_key: storageKey });
    return plant;
  }

  let stage: PlantStage = plant.stage;
  let stageElapsedMs = plant.stage_elapsed_ms;
  let wateredAt = new Date(plant.watered_at);
  let justReached = false;

  const boundaries = growthSegmentBoundaries(fromTs, toTs, wateredAt, waterIntervalHours, rainWindows);

  for (let i = 0; i < boundaries.length - 1 && stage !== 'ready'; i++) {
    const segmentStart = boundaries[i];
    const segmentEnd = boundaries[i + 1];
    const segmentMs = segmentEnd.getTime() - segmentStart.getTime();
    if (segmentMs <= 0) continue;

    const isWatered =
      isWithinWaterInterval(wateredAt, segmentStart, waterIntervalHours) ||
      isDuringRain(segmentStart, rainWindows);

    if (!isWatered) {
      // Thiếu nước — sinh trưởng đóng băng, không tích luỹ thời gian (BR-16).
      continue;
    }

    if (isDuringRain(segmentStart, rainWindows)) {
      // Mưa tự tưới: "dịch" mốc tưới hiệu dụng tới cuối đoạn mưa này để
      // trạng thái đủ nước còn hiệu lực đúng như vừa được tưới tay, không
      // kéo dài hay rút ngắn chu kỳ khát nước so với tưới tay (US-31).
      wateredAt = segmentEnd;
    }

    let remainingMs = segmentMs;
    while (remainingMs > 0 && stage !== 'ready') {
      const duration = stageDurationMs(plant.kind, config);
      if (duration <= 0) break;

      const remainingInStage = duration - stageElapsedMs;
      const advanceMs = Math.min(remainingMs, remainingInStage);
      stageElapsedMs += advanceMs;
      remainingMs -= advanceMs;

      if (stageElapsedMs >= duration) {
        const next = nextPlantStage(stage);
        stageElapsedMs = 0;
        if (next === null) {
          // Không có giai đoạn kế tiếp — về lý thuyết không xảy ra vì
          // vòng lặp đã dừng ở 'ready', giữ nguyên để an toàn kiểu.
          break;
        }
        stage = next;

        if (stage === 'ready') {
          justReached = true;
        }
      }
    }
  }

  if (justReached) {
    addAccrual(accrual, storageKey, 1);
    cappedEntities.push({ entity_kind: 'plant', entity_id: plant.id, storage_key: storageKey });
  }

  return {
    ...plant,
    stage,
    stage_elapsed_ms: stage === 'ready' ? 0 : stageElapsedMs,
    watered_at: wateredAt.toISOString(),
  };
}

/** `true` khi `at` rơi vào một trong các khoảng mưa `[start, end)`. */
function isDuringRain(at: Date, rainWindows: RainWindow[]): boolean {
  return rainWindows.some((w) => at.getTime() >= w.start.getTime() && at.getTime() < w.end.getTime());
}

/**
 * Danh sách mốc thời gian (bao gồm `fromTs` và `toTs`) chia `[fromTs, toTs)`
 * thành các đoạn mà trạng thái nước (đủ/thiếu) không đổi trong mỗi đoạn:
 * mốc hết hạn tưới tay (`watered_at + water_interval`, nếu rơi trong
 * khoảng) và các mốc bắt đầu/kết thúc chu kỳ mưa.
 *
 * Không cần chính xác tuyệt đối theo giờ — chỉ cần đủ để mỗi đoạn giữa hai
 * mốc liên tiếp có đúng một trạng thái nước, vì `tickPlant` kiểm tra lại
 * trạng thái tại đầu mỗi đoạn.
 */
function growthSegmentBoundaries(
  fromTs: Date,
  toTs: Date,
  wateredAt: Date,
  waterIntervalHours: number,
  rainWindows: RainWindow[]
): Date[] {
  const marks = new Set<number>([fromTs.getTime(), toTs.getTime()]);

  const dryDeadline = wateredAt.getTime() + waterIntervalHours * MS_PER_HOUR;
  if (dryDeadline > fromTs.getTime() && dryDeadline < toTs.getTime()) {
    marks.add(dryDeadline);
  }

  for (const w of rainWindows) {
    const start = w.start.getTime();
    const end = w.end.getTime();
    if (start > fromTs.getTime() && start < toTs.getTime()) marks.add(start);
    if (end > fromTs.getTime() && end < toTs.getTime()) marks.add(end);
  }

  return Array.from(marks)
    .sort((a, b) => a - b)
    .map((ms) => new Date(ms));
}
