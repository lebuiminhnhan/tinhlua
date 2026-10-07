import { AnimationClip, Group, Object3D, VectorKeyframeTrack } from 'three';
import type { FarmAnimalSpawn } from './farm-animal-layer';
import { FarmAnimalLayer } from './farm-animal-layer';

/** Clip hợp lệ tối giản — một track vị trí 1 khung hình, đủ để `AnimationMixer` chạy. */
function fakeClip(name: string): AnimationClip {
  return new AnimationClip(name, 1, [new VectorKeyframeTrack('.position', [0], [0, 0, 0])]);
}

/** Mẫu khung xương tối giản (không có `SkinnedMesh`) — đủ để `SkeletonUtils.clone` hoạt động. */
function fakeTemplate(clipNames: readonly string[]): Object3D {
  const group = new Group();
  group.animations = clipNames.map(fakeClip);
  return group;
}

function spawn(overrides: Partial<FarmAnimalSpawn> = {}): FarmAnimalSpawn {
  return {
    id: 'pet:dog:0',
    cell: '0,0',
    species: 'dog',
    key: 'animal:dog',
    x: 0,
    z: 0,
    ...overrides,
  };
}

describe('FarmAnimalLayer — chuyển động thủ tục dự phòng + phân biệt instancing/skeletal', () => {
  let layer: FarmAnimalLayer;

  beforeEach(() => {
    layer = new FarmAnimalLayer();
  });

  afterEach(() => {
    layer.dispose();
  });

  it('nhận diện clip theo tên (regex) không phân biệt loài — dog/cat dùng đúng cơ chế của 6 loài hiện có', () => {
    // Model dog có đủ clip đặt tên theo quy ước Quaternius (Walk/Run/Idle/Eating/Jump) →
    // layer phải nhận ra qua regex, không cần biết trước loài là "dog".
    const template = fakeTemplate(['Idle', 'Walk', 'Run', 'Eating', 'Jump']);
    const taken = layer.sync([spawn({ species: 'dog', key: 'animal:dog' })], () => template, { plots: [] });
    expect(taken.has('pet:dog:0')).toBeTrue();
  });

  it('model mới (dog/cat) thiếu TẤT CẢ clip xương phù hợp → vẫn được dựng (fallback thủ tục), không crash', () => {
    // GLB không có clip nào khớp walk/run/idle/eat/jump (ví dụ model cat chưa rig animation,
    // hoặc đặt tên clip lạ) — layer phải vẫn dựng actor và chạy được update() nhiều khung hình
    // bằng chuyển động thủ tục (hop/bob/nod) thay vì bỏ qua hoặc throw.
    const template = fakeTemplate(['UnrecognizedClipName']);
    const taken = layer.sync([spawn({ id: 'pet:cat:0', species: 'cat', key: 'animal:cat' })], () => template, {
      plots: [],
    });
    expect(taken.has('pet:cat:0')).toBeTrue();
    expect(layer.has('pet:cat:0')).toBeTrue();

    // Chạy nhiều khung hình — không có clip nào để phát, cơ chế dự phòng (nhún/gật/bật nảy)
    // phải tự chạy qua `update()` mà không throw.
    expect(() => {
      for (let i = 0; i < 240; i++) layer.update(1 / 60, i / 60);
    }).not.toThrow();
  });

  it('model không có bất kỳ clip hoạt ảnh nào (mảng animations rỗng) vẫn được dựng và chạy dự phòng', () => {
    const template = fakeTemplate([]);
    const taken = layer.sync([spawn({ id: 'pet:dog:1', species: 'dog', key: 'animal:dog' })], () => template, {
      plots: [],
    });
    expect(taken.has('pet:dog:1')).toBeTrue();
    expect(() => {
      for (let i = 0; i < 120; i++) layer.update(1 / 60, i / 60);
    }).not.toThrow();
  });

  it('cơ chế dự phòng áp dụng đồng nhất cho loài hiện có (chicken) và loài mới (dog) khi cùng thiếu clip', () => {
    const template = fakeTemplate(['SomethingElse']);
    layer.sync(
      [
        spawn({ id: 'pet:dog:2', species: 'dog', key: 'animal:dog' }),
        spawn({ id: 'animal:chicken:0', species: 'chicken', key: 'animal:chicken', cell: '1,1', x: 20, z: 20 }),
      ],
      () => template,
      { plots: [] },
    );
    expect(layer.has('pet:dog:2')).toBeTrue();
    expect(layer.has('animal:chicken:0')).toBeTrue();
    expect(() => {
      for (let i = 0; i < 120; i++) layer.update(1 / 60, i / 60);
    }).not.toThrow();
  });
});
