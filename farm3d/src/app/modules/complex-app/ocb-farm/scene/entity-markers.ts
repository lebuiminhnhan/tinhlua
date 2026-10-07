import {
  CanvasTexture,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Texture,
} from 'three';
import type { FarmCellRef } from '../models/ocb-farm.model';
import { CELL_SIZE, cellToWorld, parseCell } from './farm-scene-math';

/**
 * OCB Farm — lớp dấu hiệu trạng thái trên vật thể (task 13.6).
 *
 * - Dấu hiệu nổi trên đầu vật thể: sẵn sàng thu hoạch (sao vàng), thiếu nước + tạm dừng
 *   sinh trưởng (giọt nước xanh có ký hiệu tạm dừng), vật nuôi buồn (mặt buồn xám)
 *   — US-12, US-13, US-17, US-18. Dấu hiệu nhấp nhô nhẹ (dao động sin) để dễ thấy.
 * - Vòng chọn dưới vật thể đang mở menu, ô đích hợp lệ khi đang di chuyển (US-15, US-34).
 * - Hiệu ứng ngắn khi cho ăn / tưới / thu hoạch: vài hạt sprite bay lên rồi mờ dần (US-11,
 *   US-13, US-18, US-20).
 *
 * Thuần hiển thị: không nằm trong nhóm raycast của `FarmSceneService.pickAt`, không đổi
 * state trò chơi. Texture/material dùng chung theo loại, tạo một lần.
 */

export type FarmMarkerKind = 'ready' | 'thirsty' | 'sad';

export interface FarmEntityMarker {
  id: string;
  cell: FarmCellRef;
  kind: FarmMarkerKind;
}

export type FarmEffectKind = 'happy' | 'water' | 'harvest';

interface ActiveEffect {
  sprites: Sprite[];
  start: number | null;
  baseX: number;
  baseZ: number;
}

// Kích thước theo "đơn vị ô" × CELL_SIZE.
const S = CELL_SIZE;
const MARKER_Y = 1.35 * S;
const MARKER_SCALE = 0.5 * S;
const BOB_AMPLITUDE = 0.08 * S;
const EFFECT_BASE_Y = 0.6 * S;
const EFFECT_RISE = 1.1 * S;
const EFFECT_SPREAD = 0.35 * S;
const EFFECT_SCALE = 0.3 * S;
const BOB_SPEED = 0.004;
const EFFECT_MS = 900;
const EFFECT_PARTICLES = 4;
const RENDER_ORDER = 10;

const MARKER_STYLE: Record<FarmMarkerKind, { bg: string; glyph: string }> = {
  ready: { bg: '#f5b301', glyph: '★' },
  thirsty: { bg: '#1e88e5', glyph: '❚❚' },
  sad: { bg: '#6c757d', glyph: '☹' },
};

const EFFECT_STYLE: Record<FarmEffectKind, { bg: string; glyph: string }> = {
  happy: { bg: '#e83e8c', glyph: '♥' },
  water: { bg: '#29b6f6', glyph: '💧' },
  harvest: { bg: '#009e56', glyph: '+' },
};

/** Huy hiệu tròn có ký hiệu — vẽ bằng canvas 2D; môi trường không có DOM → `null`. */
function badgeTexture(bg: string, glyph: string): Texture | null {
  if (typeof document === 'undefined') return null;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${glyph.length > 1 ? 52 : 70}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, size / 2, size / 2 + 4);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function spriteMaterial(bg: string, glyph: string): SpriteMaterial {
  const map = badgeTexture(bg, glyph);
  return new SpriteMaterial({
    ...(map ? { map } : { color: bg }),
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
}

function worldOf(cell: FarmCellRef): { x: number; z: number } | null {
  const coord = parseCell(cell);
  return coord ? cellToWorld(coord) : null;
}

/** Chữ ký danh sách dấu hiệu — chỉ dựng lại sprite khi danh sách thật sự đổi. */
export function markerSignature(markers: readonly FarmEntityMarker[]): string {
  return markers.map((m) => `${m.id}@${m.cell}:${m.kind}`).join('|');
}

export class FarmEntityMarkerLayer {
  readonly root = new Group();

  private readonly markerMaterials = new Map<FarmMarkerKind, SpriteMaterial>();
  private readonly effectMaterials = new Map<FarmEffectKind, SpriteMaterial>();
  private markerSprites: Sprite[] = [];
  private markerSig = '';
  private effects: ActiveEffect[] = [];

  private readonly ring: Mesh<RingGeometry, MeshBasicMaterial>;
  private readonly targetGeometry = new PlaneGeometry(0.9 * S, 0.9 * S);
  private readonly targetMaterial = new MeshBasicMaterial({
    color: '#2ecc71',
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    side: DoubleSide,
  });
  private targets: InstancedMesh | null = null;
  private targetSig = '';

  constructor() {
    this.root.name = 'farm-markers';
    this.ring = new Mesh(
      new RingGeometry(0.36 * S, 0.48 * S, 40),
      new MeshBasicMaterial({ color: '#ffd400', transparent: true, opacity: 0.9, depthWrite: false, side: DoubleSide }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.ring.renderOrder = RENDER_ORDER;
    this.root.add(this.ring);
  }

  setMarkers(markers: readonly FarmEntityMarker[]): void {
    const sig = markerSignature(markers);
    if (sig === this.markerSig) return;
    this.markerSig = sig;
    for (const s of this.markerSprites) s.removeFromParent();
    this.markerSprites = [];
    for (const m of markers) {
      const pos = worldOf(m.cell);
      if (!pos) continue;
      const sprite = new Sprite(this.markerMaterial(m.kind));
      sprite.position.set(pos.x, MARKER_Y, pos.z);
      sprite.scale.setScalar(MARKER_SCALE);
      sprite.renderOrder = RENDER_ORDER;
      // Lệch pha theo vị trí để các dấu hiệu không nhấp nhô đồng loạt.
      sprite.userData['phase'] = (pos.x * 13 + pos.z * 7) % (Math.PI * 2);
      this.markerSprites.push(sprite);
      this.root.add(sprite);
    }
  }

  setSelection(cell: FarmCellRef | null): void {
    const pos = cell ? worldOf(cell) : null;
    this.ring.visible = pos !== null;
    if (pos) this.ring.position.set(pos.x, 0.06 * S, pos.z);
  }

  /** Tô các ô đích hợp lệ khi đang di chuyển vật thể; mảng rỗng → tắt. */
  setMoveTargets(cells: readonly FarmCellRef[]): void {
    const sig = cells.join('|');
    if (sig === this.targetSig) return;
    this.targetSig = sig;
    if (this.targets) {
      this.targets.removeFromParent();
      this.targets.dispose();
      this.targets = null;
    }
    const points = cells.map(worldOf).filter((p): p is { x: number; z: number } => p !== null);
    if (points.length === 0) return;
    const mesh = new InstancedMesh(this.targetGeometry, this.targetMaterial, points.length);
    const m = new Matrix4();
    const flat = new Matrix4().makeRotationX(-Math.PI / 2);
    points.forEach((p, i) => {
      m.makeTranslation(p.x, 0.05 * S, p.z).multiply(flat);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.renderOrder = RENDER_ORDER - 1;
    this.targets = mesh;
    this.root.add(mesh);
  }

  /** Hiệu ứng ngắn tại một ô — vài hạt bay lên và mờ dần. */
  playEffect(cell: FarmCellRef, kind: FarmEffectKind): void {
    const pos = worldOf(cell);
    if (!pos) return;
    const sprites: Sprite[] = [];
    for (let i = 0; i < EFFECT_PARTICLES; i++) {
      // Material riêng mỗi hạt để mờ dần độc lập (texture vẫn dùng chung).
      const material = this.effectMaterial(kind).clone();
      const sprite = new Sprite(material);
      sprite.scale.setScalar(EFFECT_SCALE);
      sprite.renderOrder = RENDER_ORDER + 1;
      sprite.userData['angle'] = (i / EFFECT_PARTICLES) * Math.PI * 2;
      sprite.position.set(pos.x, EFFECT_BASE_Y, pos.z);
      sprites.push(sprite);
      this.root.add(sprite);
    }
    this.effects.push({ sprites, start: null, baseX: pos.x, baseZ: pos.z });
  }

  /** Gọi mỗi khung hình (`time` theo ms của vòng lặp render). */
  update(time: number): void {
    for (const s of this.markerSprites) {
      const phase = (s.userData['phase'] as number | undefined) ?? 0;
      s.position.y = MARKER_Y + Math.sin(time * BOB_SPEED + phase) * BOB_AMPLITUDE;
    }
    if (this.ring.visible) {
      this.ring.scale.setScalar(1 + Math.sin(time * 0.006) * 0.06);
    }
    if (this.effects.length === 0) return;
    const alive: ActiveEffect[] = [];
    for (const fx of this.effects) {
      if (fx.start === null) fx.start = time;
      const t = Math.min(1, (time - fx.start) / EFFECT_MS);
      fx.sprites.forEach((s) => {
        const angle = s.userData['angle'] as number;
        const spread = EFFECT_SPREAD * t;
        s.position.set(
          fx.baseX + Math.cos(angle) * spread,
          EFFECT_BASE_Y + t * EFFECT_RISE,
          fx.baseZ + Math.sin(angle) * spread,
        );
        (s.material as SpriteMaterial).opacity = 1 - t;
      });
      if (t >= 1) {
        for (const s of fx.sprites) {
          s.removeFromParent();
          (s.material as SpriteMaterial).dispose();
        }
      } else {
        alive.push(fx);
      }
    }
    this.effects = alive;
  }

  /** `true` khi còn hiệu ứng đang chạy (để vẽ lại liên tục). */
  hasActiveEffects(): boolean {
    return this.effects.length > 0;
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const fx of this.effects) {
      for (const s of fx.sprites) (s.material as SpriteMaterial).dispose();
    }
    this.effects = [];
    for (const s of this.markerSprites) s.removeFromParent();
    this.markerSprites = [];
    this.markerSig = '';
    for (const mat of [...this.markerMaterials.values(), ...this.effectMaterials.values()]) {
      mat.map?.dispose();
      mat.dispose();
    }
    this.markerMaterials.clear();
    this.effectMaterials.clear();
    this.targets?.dispose();
    this.targets = null;
    this.targetSig = '';
    this.targetGeometry.dispose();
    this.targetMaterial.dispose();
    this.ring.geometry.dispose();
    this.ring.material.dispose();
  }

  private markerMaterial(kind: FarmMarkerKind): SpriteMaterial {
    let mat = this.markerMaterials.get(kind);
    if (!mat) {
      mat = spriteMaterial(MARKER_STYLE[kind].bg, MARKER_STYLE[kind].glyph);
      this.markerMaterials.set(kind, mat);
    }
    return mat;
  }

  private effectMaterial(kind: FarmEffectKind): SpriteMaterial {
    let mat = this.effectMaterials.get(kind);
    if (!mat) {
      mat = spriteMaterial(EFFECT_STYLE[kind].bg, EFFECT_STYLE[kind].glyph);
      this.effectMaterials.set(kind, mat);
    }
    return mat;
  }
}
