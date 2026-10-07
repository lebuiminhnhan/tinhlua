import type { FarmRenderKey } from '../scene/farm-asset-provider';
import { swayAmplitude } from './farm-scene.service';

describe('swayAmplitude — phân biệt instancing tĩnh (decor/plant) với vật nuôi có xương (animal)', () => {
  it('trả về 0 cho mọi mã animal:* (6 loài hiện có + dog/cat mới) — không áp sway vào vật thể có xương', () => {
    const keys: FarmRenderKey[] = [
      'animal:chicken',
      'animal:fish',
      'animal:sheep',
      'animal:pig',
      'animal:cow',
      'animal:horse',
      // dog/cat chưa có trong union FarmSpecies của FarmRenderKey (chỉ dùng ở
      // FarmAnimalLayer qua FarmFreeRoamSpecies) — ép kiểu để xác nhận hành vi runtime
      // (renderCategoryOf lấy phần trước ':' bằng string, không phụ thuộc union kiểu).
      'animal:dog' as FarmRenderKey,
      'animal:cat' as FarmRenderKey,
    ];
    for (const key of keys) {
      expect(swayAmplitude(key)).toBe(0);
    }
  });

  it('trả về biên độ > 0 cho nhóm decor đung đưa (tree_*, bush_*, flowerbed_* không chứa petal)', () => {
    expect(swayAmplitude('decor:tree_pine' as FarmRenderKey)).toBeGreaterThan(0);
    expect(swayAmplitude('decor:tree_oak' as FarmRenderKey)).toBeGreaterThan(0);
    expect(swayAmplitude('decor:bush_round' as FarmRenderKey)).toBeGreaterThan(0);
    expect(swayAmplitude('decor:bush_berry' as FarmRenderKey)).toBeGreaterThan(0);
    expect(swayAmplitude('decor:flowerbed_tulip' as FarmRenderKey)).toBeGreaterThan(0);
  });

  it('trả về 0 cho decor không thuộc nhóm đung đưa (lamp, fence) và cho flowerbed có "petal"', () => {
    expect(swayAmplitude('decor:lamp_garden' as FarmRenderKey)).toBe(0);
    expect(swayAmplitude('decor:fence' as FarmRenderKey)).toBe(0);
    expect(swayAmplitude('decor:flowerbed_petal_a' as FarmRenderKey)).toBe(0);
  });

  it('biến thể `#n` (variant suffix) của mã animal vẫn trả 0 sau khi gỡ hậu tố', () => {
    expect(swayAmplitude('animal:cow#1' as FarmRenderKey)).toBe(0);
  });
});
