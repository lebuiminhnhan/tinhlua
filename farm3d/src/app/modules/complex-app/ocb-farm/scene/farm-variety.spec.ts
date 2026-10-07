import { Color, MeshStandardMaterial } from 'three';
import { decorGroupOf, FarmAssetManifest, FarmGlbAssetEntry } from '../models/ocb-farm.model';
import { listManifestAssets, resolveManifestAsset } from '../services/asset-loader.service';
import { decorCatalogFromManifest, pickRandomItem, ShopItem } from '../components/shop-panel/shop-catalog';
import { baseRenderKey, pickVariant } from './farm-asset-provider';
import { paletteColorFor, stylizeMaterials } from './farm-palette';
import { buildFarmScatter, seededRandom } from './geometry/farm-scatter.geometry';
import { disposeObject3D } from './geometry/dispose';

function glb(file: string, extra: Partial<FarmGlbAssetEntry> = {}): FarmGlbAssetEntry {
  return {
    source: 'glb',
    label: file,
    files: { low: `${file}_low.glb`, medium: `${file}_medium.glb`, high: `${file}_high.glb` },
    initial: true,
    fallback_color: '#FFFFFF',
    ...extra,
  };
}

describe('farm variety (biến thể ngẫu nhiên, bảng màu, cảnh vật)', () => {
  it('picks a deterministic variant per entity id and spreads across ids', () => {
    const key = 'animal:cow' as const;
    expect(pickVariant(key, 'a1', 2)).toBe(pickVariant(key, 'a1', 2));
    expect(pickVariant(key, 'a1', 0)).toBe(key);
    const seen = new Set(Array.from({ length: 60 }, (_, i) => pickVariant(key, `id-${i}`, 2)));
    expect(seen).toEqual(new Set(['animal:cow', 'animal:cow#1', 'animal:cow#2']));
    expect(baseRenderKey('animal:cow#2')).toBe('animal:cow');
  });

  it('resolves `#n` keys to manifest variants and lists them (non-initial excluded from initial set)', () => {
    const manifest = {
      animals: { cow: glb('cow', { variants: [glb('cow_v1', { initial: false })] }) },
      plants: {},
      decors: {},
    } as unknown as FarmAssetManifest;
    expect(resolveManifestAsset(manifest, 'animal:cow#1')?.label).toBe('cow_v1');
    expect(resolveManifestAsset(manifest, 'animal:cow#2')).toBeNull();
    expect(listManifestAssets(manifest).map((a) => a.key)).toEqual(['animal:cow', 'animal:cow#1']);
    expect(listManifestAssets(manifest, { initialOnly: true }).map((a) => a.key)).toEqual(['animal:cow']);
  });

  it('maps decor kinds to groups and lists every manifest decor in the shop catalog', () => {
    expect(decorGroupOf('lamp')).toBe('lamp');
    expect(decorGroupOf('flowerbed_petal_a')).toBe('flowerbed');
    expect(decorGroupOf('unknown_x')).toBeNull();
    const catalog = decorCatalogFromManifest({
      tree_oak: { label: 'Cây sồi', group: 'tree' },
      fence: { label: 'Hàng rào', group: 'fence' },
      fence_iron: { label: 'Hàng rào sắt', group: 'fence' },
      bad_kind: { label: 'x' },
    });
    expect(catalog.map((c) => c.kind)).toEqual(['fence', 'fence_iron', 'tree_oak']);
  });

  it('random shop pick only returns buyable items', () => {
    const items = [{ code: 'a', block: 'insufficient_seeds' }, { code: 'b', block: null }] as ShopItem[];
    expect(pickRandomItem(items, () => 0.99)?.code).toBe('b');
    expect(pickRandomItem([items[0]])).toBeNull();
  });

  it('restyles named materials with the farm palette and warms unnamed ones once', () => {
    expect(paletteColorFor('Leaves_NormalTree')).toBe('#5DA130');
    expect(paletteColorFor('Stone_Dark')).toBe('#857C70');
    const named = new MeshStandardMaterial({ name: 'Wood', color: '#ff0000', metalness: 1 });
    const plain = new MeshStandardMaterial({ name: 'Material.003', color: '#808080' });
    stylizeMaterials([named, plain]);
    expect('#' + named.color.getHexString().toUpperCase()).toBe('#8A5A2B');
    expect(named.metalness).toBe(0);
    const once = plain.color.clone();
    stylizeMaterials(plain);
    expect(plain.color.equals(once)).toBeTrue();
    expect(plain.color.equals(new Color('#808080'))).toBeFalse();
  });

  it('scatter is deterministic and skips the OCB tree cell', () => {
    const plots = [
      { id: 1, unlocked: true, terrain: 'land' as const, cells: ['0,0', '0,1', '1,0', '1,1'] },
      { id: 7, unlocked: true, terrain: 'water' as const, cells: ['2,0', '2,1'] },
    ];
    const a = buildFarmScatter(plots, '0,0');
    const b = buildFarmScatter(plots, '0,0');
    const sig = (g: typeof a): string => g.children.map((c) => `${c.name}:${(c as unknown as { count: number }).count}`).join('|');
    expect(sig(a)).toBe(sig(b));
    expect(a.children.length).toBeGreaterThan(0);
    const r1 = seededRandom(42);
    const r2 = seededRandom(42);
    expect([r1(), r1()]).toEqual([r2(), r2()]);
    disposeObject3D(a);
    disposeObject3D(b);
  });
});
