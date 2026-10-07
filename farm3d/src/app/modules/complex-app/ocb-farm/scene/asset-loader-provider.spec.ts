import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Group, Mesh, MeshStandardMaterial, Object3D } from 'three';
import { FarmAssetManifest, FarmGlbAssetEntry } from '../models/ocb-farm.model';
import { AssetLoaderService, FARM_GLTF_LOADER, FarmGltfLoader } from '../services/asset-loader.service';
import { AssetLoaderFarmProvider, meshPartsOf } from './asset-loader-provider';

function glb(name: string, color: string): FarmGlbAssetEntry {
  return {
    source: 'glb',
    label: name,
    files: { low: `m/${name}_low.glb`, medium: `m/${name}_medium.glb`, high: `m/${name}_high.glb` },
    initial: true,
    fallback_color: color,
  };
}

const MANIFEST = {
  schema: 1,
  initial_budget_bytes: 1,
  default_fallback_color: '#B0B0B0',
  animals: { chicken: glb('chicken', '#F2E2B6'), cow: glb('cow', '#8B5A3C') },
  plants: {},
  decors: {},
  procedural: {},
} as unknown as FarmAssetManifest;

class FakeLoader implements FarmGltfLoader {
  failing = new Set<string>();
  async load(url: string): Promise<Object3D> {
    await Promise.resolve();
    if (this.failing.has(url)) throw new Error(`404 ${url}`);
    const root = new Group();
    const body = new Mesh(undefined, new MeshStandardMaterial());
    body.position.set(0, 0.5, 0);
    const head = new Mesh(undefined, new MeshStandardMaterial());
    head.position.set(0.2, 0.2, 0);
    body.add(head);
    root.add(body);
    return root;
  }
  dispose(): void {
    /* không có tài nguyên */
  }
}

describe('AssetLoaderFarmProvider', () => {
  let loader: AssetLoaderService;
  let fake: FakeLoader;
  let provider: AssetLoaderFarmProvider;

  beforeEach(() => {
    fake = new FakeLoader();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: FARM_GLTF_LOADER, useValue: fake }],
    });
    loader = TestBed.inject(AssetLoaderService);
    loader.setManifest(MANIFEST);
    provider = new AssetLoaderFarmProvider(loader);
  });

  it('tách mesh với ma trận cục bộ theo gốc mô hình (gồm mesh lồng nhau)', () => {
    const root = new Group();
    const body = new Mesh(undefined, new MeshStandardMaterial());
    body.position.set(0, 0.5, 0);
    const head = new Mesh(undefined, new MeshStandardMaterial());
    head.position.set(0.2, 0.2, 0);
    body.add(head);
    root.add(body);

    const parts = meshPartsOf(root);
    expect(parts.length).toBe(2);
    expect(parts[1].matrix?.elements[12]).toBeCloseTo(0.2);
    expect(parts[1].matrix?.elements[13]).toBeCloseTo(0.7);
  });

  it('mã ngoài manifest → null (không render)', () => {
    expect(provider.resolve('animal:horse' as never, 'low')).toBeNull();
  });

  it('mô hình đã nạp → mảnh mesh thật, cache theo (mức, mã)', async () => {
    await loader.loadAll('low');
    const a = provider.resolve('animal:chicken', 'low');
    expect(a?.fallback).toBeFalse();
    expect(a?.parts.length).toBe(2);
    expect(provider.resolve('animal:chicken', 'low')).toBe(a);
    expect(provider.revision()).toBe(loader.version());
  });

  it('mô hình lỗi → khối hộp màu theo loại', async () => {
    fake.failing.add('m/cow_low.glb');
    await loader.loadAll('low');
    const cow = provider.resolve('animal:cow', 'low');
    expect(cow?.fallback).toBeTrue();
    expect(cow?.parts.length).toBe(1);
    const mat = cow?.parts[0].material as MeshStandardMaterial;
    expect(`#${mat.color.getHexString().toUpperCase()}`).toBe('#8B5A3C');
  });

  it('mức mới chưa nạp xong → mượn mô hình mức khác thay vì khối hộp', async () => {
    await loader.loadAll('low');
    const high = provider.resolve('animal:chicken', 'high');
    expect(high?.fallback).toBeFalse();
  });
});
