import type { FarmAnimal, FarmPlant, FarmStateJson } from '../../models/ocb-farm.model';
import {
  FarmStatusContext,
  animalStatus,
  bulkSummary,
  describeEntity,
  entityMarkers,
  feedCost,
  formatCountdown,
  harvestResultRows,
  moveBlockReason,
  moveTargets,
  plantStatus,
} from './entity-actions';

const HOUR = 3_600_000;
const NOW = Date.parse('2025-06-15T05:00:00Z');

const VALUES: Record<string, number> = {
  animal_price_chicken: 100,
  animal_price_cow: 400,
  animal_price_horse: 600,
  feed_cost_ratio: 10,
  resell_ratio: 50,
  fullness_decay_hours: 10,
  produce_cycle_chicken: 2,
  produce_cycle_cow: 4,
  offline_cap_per_entity: 5,
  grow_total_banana: 8,
  grow_total_rose: 4,
  water_interval: 8,
  storage_cap: 100,
  harvest_qty_rose: 2,
};

function ctx(partial: Partial<FarmStatusContext> = {}): FarmStatusContext {
  return { values: VALUES, balance: 1000, nowMs: NOW, syncedAtMs: NOW, raining: false, ...partial };
}

function animal(p: Partial<FarmAnimal> = {}): FarmAnimal {
  return {
    id: 'a1',
    species: 'chicken',
    cell: '1,1',
    fed_at: new Date(NOW).toISOString(),
    fullness: 100,
    cycle_started_at: new Date(NOW).toISOString(),
    pending: 0,
    ...p,
  };
}

function plant(p: Partial<FarmPlant> = {}): FarmPlant {
  return {
    id: 'p1',
    kind: 'banana',
    cell: '1,2',
    stage: 'seed',
    stage_elapsed_ms: 0,
    watered_at: new Date(NOW).toISOString(),
    fertilized_stage: null,
    ready_at: null,
    ...p,
  };
}

function farm(p: Partial<FarmStateJson> = {}): FarmStateJson {
  return {
    schema: 1,
    plots: [
      { id: 1, unlocked: true, terrain: 'land', cells: ['0,0', '1,1', '1,2', '1,3'] },
      { id: 2, unlocked: true, terrain: 'water', cells: ['2,0'] },
      { id: 3, unlocked: false, terrain: 'land', cells: ['3,0'] },
    ],
    animals: [],
    plants: [],
    decors: [],
    storage: {},
    tree: { milestone: 0, branches: 0, last_evaluated_at: new Date(NOW).toISOString() },
    badges_shown: [],
    counters: { harvest_count: 0, water_count: 0, help_given: 0, species_owned: [] },
    ...p,
  };
}

describe('entity-actions', () => {
  it('formatCountdown', () => {
    expect(formatCountdown(9_000)).toBe('9 giây');
    expect(formatCountdown(4 * 60_000 + 9_000)).toBe('4 phút 09 giây');
    expect(formatCountdown(HOUR + 5 * 60_000)).toBe('1 giờ 05 phút');
    expect(formatCountdown(2 * 24 * HOUR + 3 * HOUR)).toBe('2 ngày 3 giờ');
  });

  it('feedCost = tỷ lệ % giá mua, làm tròn xuống', () => {
    expect(feedCost('chicken', VALUES)).toBe(10);
    expect(feedCost('cow', VALUES)).toBe(40);
  });

  describe('animalStatus', () => {
    it('độ no giảm theo thời gian, không âm; về 0 thì buồn', () => {
      const s = animalStatus(animal({ fullness: 50 }), ctx({ nowMs: NOW + 2 * HOUR }));
      expect(s.fullness).toBeCloseTo(30);
      expect(s.sad).toBeFalse();
      const sad = animalStatus(animal({ fullness: 10 }), ctx({ nowMs: NOW + 20 * HOUR }));
      expect(sad.fullness).toBe(0);
      expect(sad.sad).toBeTrue();
      expect(sad.msToNextProduct).toBeNull();
    });

    it('tích lũy sản phẩm có trần, đếm ngược tới sản phẩm kế tiếp', () => {
      const s = animalStatus(animal(), ctx({ nowMs: NOW + 3 * HOUR }));
      expect(s.pending).toBe(1);
      expect(s.msToNextProduct).toBe(HOUR);
      const capped = animalStatus(animal({ pending: 5 }), ctx({ nowMs: NOW + HOUR }));
      expect(capped.capped).toBeTrue();
      expect(capped.msToNextProduct).toBeNull();
    });

    it('ngựa không có sản phẩm', () => {
      expect(animalStatus(animal({ species: 'horse' }), ctx()).productKey).toBeNull();
    });
  });

  describe('plantStatus', () => {
    it('sinh trưởng qua giai đoạn khi đủ nước', () => {
      // banana: 8 giờ / 4 lượt = 2 giờ mỗi giai đoạn.
      const s = plantStatus(plant(), ctx({ nowMs: NOW + 3 * HOUR }));
      expect(s.stage).toBe('sprout');
      expect(s.remainingMs).toBe(HOUR);
      expect(s.thirsty).toBeFalse();
    });

    it('thiếu nước → tạm dừng, thời gian còn lại không giảm', () => {
      const watered = new Date(NOW - 9 * HOUR).toISOString();
      const a = plantStatus(plant({ watered_at: watered, stage_elapsed_ms: HOUR }), ctx());
      const b = plantStatus(plant({ watered_at: watered, stage_elapsed_ms: HOUR }), ctx({ nowMs: NOW + HOUR }));
      expect(a.thirsty).toBeTrue();
      expect(b.remainingMs).toBe(a.remainingMs);
    });

    it('trời mưa → đủ nước; sẵn sàng thì không đếm ngược', () => {
      const watered = new Date(NOW - 9 * HOUR).toISOString();
      expect(plantStatus(plant({ watered_at: watered }), ctx({ raining: true })).thirsty).toBeFalse();
      const ready = plantStatus(plant({ stage: 'ready' }), ctx());
      expect(ready.ready).toBeTrue();
      expect(ready.remainingMs).toBeNull();
      expect(plantStatus(plant({ stage: 'flowering' }), ctx()).stageLabel).toBe('Ra quả');
    });
  });

  describe('describeEntity — lý do vô hiệu hoá', () => {
    it('vật nuôi đang no / thiếu Hạt OCB / chưa có sản phẩm', () => {
      const state = farm({ animals: [animal()] });
      const full = describeEntity(state, { entityKind: 'animal', id: 'a1' }, ctx());
      expect(full?.actions.find((a) => a.id === 'feed')?.disabledReason).toContain('đang no');
      expect(full?.actions.find((a) => a.id === 'harvest')?.disabledReason).toContain('sản phẩm kế tiếp sau 2 giờ');

      const hungry = farm({ animals: [animal({ fullness: 20 })] });
      const poor = describeEntity(hungry, { entityKind: 'animal', id: 'a1' }, ctx({ balance: 3 }));
      expect(poor?.actions.find((a) => a.id === 'feed')?.disabledReason).toContain('còn thiếu 7');
    });

    it('ngựa không có nút thu hoạch', () => {
      const d = describeEntity(farm({ animals: [animal({ species: 'horse' })] }), { entityKind: 'animal', id: 'a1' }, ctx());
      expect(d?.actions.some((a) => a.id === 'harvest')).toBeFalse();
      expect(d?.note).toContain('Ngựa');
    });

    it('cây: đã tưới, hết phân, đã bón trong giai đoạn, chưa sẵn sàng', () => {
      const state = farm({ plants: [plant({ fertilized_stage: 'seed' })] });
      const d = describeEntity(state, { entityKind: 'plant', id: 'p1' }, ctx());
      const reason = (id: string) => d?.actions.find((a) => a.id === id)?.disabledReason;
      expect(reason('water')).toContain('đã đủ nước');
      expect(reason('fertilize')).toContain('đã được bón');
      expect(reason('harvest')).toContain('chưa tới lúc');
      expect(reason('move')).not.toBeNull();

      const noManure = describeEntity(farm({ plants: [plant()] }), { entityKind: 'plant', id: 'p1' }, ctx());
      expect(noManure?.actions.find((a) => a.id === 'fertilize')?.disabledReason).toContain('Hết phân');
    });

    it('vật thể không còn → null', () => {
      expect(describeEntity(farm(), { entityKind: 'animal', id: 'x' }, ctx())).toBeNull();
    });
  });

  describe('bulkSummary', () => {
    it('cho ăn tất cả: đếm vật nuôi đói, tổng chi phí, số đủ tiền theo độ no thấp nhất trước', () => {
      const state = farm({
        animals: [
          animal({ id: 'a1', fullness: 40 }),
          animal({ id: 'a2', species: 'cow', fullness: 10 }),
          animal({ id: 'a3', fullness: 100 }),
        ],
      });
      const s = bulkSummary('feed_all', state, ctx({ balance: 45 }));
      expect(s.count).toBe(2);
      expect(s.totalCost).toBe(50);
      expect(s.affordableCount).toBe(1);
      expect(s.disabledReason).toBeNull();
      expect(bulkSummary('feed_all', farm({ animals: [animal()] }), ctx()).disabledReason).toContain('Không có vật nuôi nào đang đói');
      expect(bulkSummary('feed_all', farm(), ctx()).disabledReason).toContain('Chưa có vật nuôi');
    });

    it('tưới tất cả: chỉ cây thiếu nước', () => {
      const thirsty = plant({ id: 'p2', watered_at: new Date(NOW - 9 * HOUR).toISOString() });
      expect(bulkSummary('water_all', farm({ plants: [plant(), thirsty] }), ctx()).count).toBe(1);
      expect(bulkSummary('water_all', farm({ plants: [plant()] }), ctx()).disabledReason).toContain('Không có cây nào cần tưới');
    });

    it('thu hoạch tất cả: gồm vật nuôi có sản phẩm và cây sẵn sàng; không có thì nêu thời gian gần nhất', () => {
      const state = farm({ animals: [animal({ pending: 2 })], plants: [plant({ kind: 'rose', stage: 'ready' })] });
      const s = bulkSummary('harvest_all', state, ctx());
      expect(s.count).toBe(2);
      expect(s.units).toBe(4);
      expect(s.readyPlantIds).toEqual(['p1']);
      const none = bulkSummary('harvest_all', farm({ animals: [animal()] }), ctx());
      expect(none.disabledReason).toContain('sản phẩm gần nhất sau 2 giờ');
      const full = bulkSummary('harvest_all', { ...state, storage: { egg: 100 } }, ctx());
      expect(full.disabledReason).toContain('Kho đã đầy');
    });
  });

  it('entityMarkers: sẵn sàng, thiếu nước, buồn', () => {
    const state = farm({
      animals: [animal({ id: 'a1', pending: 1 }), animal({ id: 'a2', fullness: 0, cell: '1,3' })],
      plants: [plant({ watered_at: new Date(NOW - 9 * HOUR).toISOString() })],
    });
    expect(entityMarkers(state, ctx()).map((m) => `${m.id}:${m.kind}`)).toEqual(['a1:ready', 'a2:sad', 'p1:thirsty']);
  });

  it('moveBlockReason / moveTargets theo địa hình, vùng khoá, ô bị chiếm, ô Cây OCB', () => {
    const state = farm({ animals: [animal()], plants: [plant()] });
    const ref = { entityKind: 'animal' as const, id: 'a1' };
    expect(moveBlockReason(state, ref, '0,0')).toContain('Cây OCB');
    expect(moveBlockReason(state, ref, '3,0')).toContain('chưa mở');
    expect(moveBlockReason(state, ref, '2,0')).toContain('chỉ dành cho cá');
    expect(moveBlockReason(state, ref, '1,2')).toContain('đã có');
    expect(moveBlockReason(state, ref, '1,3')).toBeNull();
    expect(moveTargets(state, ref, '1,1')).toEqual(['1,3']);

    const fish = farm({ animals: [animal({ species: 'fish', cell: '2,0' })] });
    expect(moveBlockReason(fish, ref, '1,3')).toContain('ao nước');
  });

  it('harvestResultRows từ chênh lệch kho', () => {
    expect(harvestResultRows({ egg: 1 }, { egg: 4, flower_rose: 2 })).toEqual([
      { key: 'egg', label: 'Trứng', quantity: 3 },
      { key: 'flower_rose', label: 'Hoa hồng', quantity: 2 },
    ]);
  });
});
