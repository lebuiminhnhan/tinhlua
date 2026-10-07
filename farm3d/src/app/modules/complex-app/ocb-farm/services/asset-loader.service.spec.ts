import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Group, Mesh, MeshStandardMaterial, Object3D } from 'three';
import { FarmAssetManifest, FarmGlbAssetEntry } from '../models/ocb-farm.model';
import { FarmLoadTracker } from '../components/loading-overlay/load-progress';
import {
  AssetLoaderService,
  FARM_GLTF_LOADER,
  FarmGltfLoader,
  animalAssetKey,
  assetLoadItemId,
  decorAssetKey,
  listManifestAssets,
  plantAssetKey,
  resolveManifestAsset,
} from './asset-loader.service';

function glb(name: string, color: string, initial = true): FarmGlbAssetEntry {
  return {
    source: 'glb',
    label: name,
    files: { low: `m/${name}_low.glb`, medium: `m/${name}_medium.glb`, high: `m/${name}_high.glb` },
    initial,
    fallback_color: color,
  };
}

const SEED: FarmGlbAssetEntry = { ...glb('seed', '#111111'), label: 'Chuối — hạt' };

// Manifest rút gọn — chỉ khai báo vài mã để kiểm "mã ngoài manifest không nạp".
const MANIFEST = {
  schema: 1,
  initial_budget_bytes: 1,
  default_fallback_color: '#B0B0B0',
  animals: { chicken: glb('chicken', '#F2E2B6'), cow: glb('cow', '#8B5A3C', false) },
  plants: {
    banana: { label: 'Chuối', category: 'fruit', stages: { seed: SEED } },
    mango: { label: 'Xoài', category: 'fruit', stages: { seed: { ...SEED, label: 'Xoài — hạt' } } },
  },
  decors: { lamp: glb('lamp', '#FFD54F') },
  procedural: {},
} as unknown as FarmAssetManifest;

/** Bộ nạp thật-giả: trả cảnh 1 mesh, URL trong `failing` thì lỗi; ghi lại mọi URL đã tải. */
class FakeLoader implements FarmGltfLoader {
  readonly calls: string[] = [];
  failing = new Set<string>();
  progressSteps: number[] = [];

  async load(url: string, onProgress: (f: number) => void): Promise<Object3D> {
    this.calls.push(url);
    this.progressSteps.forEach((f) => onProgress(f));
    await Promise.resolve();
    if (this.failing.has(url)) throw new Error(`404 ${url}`);
    const root = new Group();
    root.name = url;
    root.add(new Mesh(undefined, new MeshStandardMaterial()));
    return root;
  }

  dispose(): void {
    /* không có tài nguyên */
  }
}

describe('asset manifest helpers', () => {
  it('chỉ tra được mã có khai báo', () => {
    expect(resolveManifestAsset(MANIFEST, 'animal:chicken')?.label).toBe('chicken');
    expect(resolveManifestAsset(MANIFEST, 'plant:banana:seed')?.label).toBe('Chuối — hạt');
    expect(resolveManifestAsset(MANIFEST, 'animal:horse')).toBeNull();
    expect(resolveManifestAsset(MANIFEST, 'plant:banana:ready')).toBeNull();
    expect(resolveManifestAsset(MANIFEST, 'decor:toString')).toBeNull();
    expect(resolveManifestAsset(null, 'animal:chicken')).toBeNull();
  });

  it('liệt kê đủ mục GLB, lọc được tập tải lần đầu', () => {
    expect(listManifestAssets(MANIFEST).map((a) => a.key)).toEqual([
      'animal:chicken',
      'animal:cow',
      'plant:banana:seed',
      'plant:mango:seed',
      'decor:lamp',
    ]);
    expect(listManifestAssets(MANIFEST, { initialOnly: true }).map((a) => a.key)).not.toContain('animal:cow');
  });
});

describe('AssetLoaderService', () => {
  let service: AssetLoaderService;
  let loader: FakeLoader;

  beforeEach(() => {
    loader = new FakeLoader();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: FARM_GLTF_LOADER, useValue: loader }],
    });
    service = TestBed.inject(AssetLoaderService);
    service.setManifest(MANIFEST);
  });

  it('nạp đúng file theo mức chất lượng, file dùng chung chỉ tải một lần', async () => {
    const result = await service.loadAll('medium');

    expect(loader.calls.every((u) => u.endsWith('_medium.glb'))).toBeTrue();
    expect(loader.calls.filter((u) => u === 'm/seed_medium.glb').length).toBe(1);
    expect(result.loaded.length).toBe(5);
    expect(service.phase()).toBe('ready');
    expect(service.progress()).toBe(100);
    expect(service.getTemplate('plant:mango:seed', 'medium')).not.toBeNull();
    expect(service.getTemplate('animal:chicken', 'low')).toBeNull();
  });

  it('mã ngoài manifest không nạp và không render', async () => {
    const result = await service.loadAll('low', { keys: ['animal:chicken', 'animal:horse', 'decor:unknown'] });

    expect(result.skipped).toEqual(['animal:horse', 'decor:unknown']);
    expect(loader.calls).toEqual(['m/chicken_low.glb']);
    expect(service.createInstance('animal:horse')).toBeNull();
    expect(service.createInstance(animalAssetKey('chicken'))).toBeInstanceOf(Group);
  });

  it('mô hình lỗi → khối hộp màu theo loại, ghi vào danh sách lỗi; thử lại chỉ tải hạng mục lỗi', async () => {
    loader.failing.add('m/lamp_low.glb');
    const first = await service.loadAll('low');

    expect(first.failed).toEqual([decorAssetKey('lamp')]);
    expect(service.failedItems().map((f) => f.key)).toEqual(['decor:lamp']);
    expect(service.failedLoadItems().map((i) => i.id)).toEqual([assetLoadItemId('decor:lamp', 'low')]);
    const box = service.createInstance('decor:lamp');
    expect(box?.userData['fallback']).toBeTrue();
    expect(box?.userData['fallbackColor']).toBe('#FFD54F');

    loader.failing.clear();
    loader.calls.length = 0;
    const retry = await service.retryFailed();

    expect(loader.calls).toEqual(['m/lamp_low.glb']);
    expect(retry.loaded).toEqual(['decor:lamp']);
    expect(service.failedItems()).toEqual([]);
    expect(service.createInstance('decor:lamp')?.userData['fallback']).toBeUndefined();
    expect(service.getTemplate(plantAssetKey('banana', 'seed'))).not.toBeNull();
  });

  it('phần trăm tiến trình không giảm trong một lần tải', async () => {
    loader.progressSteps = [0.6, 0.2, 0.9];
    const tracker = new FarmLoadTracker();
    tracker.begin([{ id: 'farm-data', label: 'Dữ liệu' }]);
    const seen: number[] = [];
    const origProgress = tracker.progress.bind(tracker);
    spyOn(tracker, 'progress').and.callFake((id: string, f: number) => {
      origProgress(id, f);
      seen.push(tracker.percent());
    });

    const pending = service.loadAll('high', { tracker });
    tracker.complete('farm-data');
    seen.push(tracker.percent());
    await pending;
    seen.push(tracker.percent());

    expect(seen.length).toBeGreaterThan(3);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    expect(service.progress()).toBe(100);
    expect(tracker.phase()).toBe('ready');
    tracker.dispose();
  });
});
