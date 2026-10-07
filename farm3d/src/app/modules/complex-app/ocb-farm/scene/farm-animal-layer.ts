/**
 * OCB Farm — vật nuôi có hoạt ảnh.
 *
 * `InstancedMesh` không chạy được xương (skinning), nên mỗi vật nuôi được dựng riêng:
 * bản sao `SkeletonUtils.clone` của cảnh gốc (geometry/material dùng chung với loader),
 * chuẩn hoá kích thước theo ô (`model-fit`), một `AnimationMixer` mỗi con.
 *
 * Máy trạng thái hành vi (clip Quaternius khi có, thiếu clip thì chuyển động thủ tục):
 * - `idle`    — đứng thở (co giãn nhẹ thân), thỉnh thoảng ngoái nhìn quanh;
 * - `walk`    — đi tới một điểm ngẫu nhiên trong ô, quay đầu mượt;
 * - `run`     — chạy nhanh một quãng ngắn (Run / Gallop), vui hơn khi vừa được cho ăn;
 * - `eat`     — cúi gặm cỏ (Eating / Idle_Eating / Idle_Peck; thiếu clip thì gật đầu thủ tục);
 * - `react`   — nhảy cẫng lên khi được cho ăn / thu hoạch / được chọn (Jump; thiếu clip thì
 *               bật nảy có co giãn kiểu hoạt hình).
 * Vật nuôi đói (độ no = 0) đi chậm, ít chạy, hay đứng ủ rũ.
 * Cá: bơi vòng trong ô ao, lượn sâu/nông, thỉnh thoảng nhảy vọt khỏi mặt nước.
 * `prefers-reduced-motion`: chỉ chạy clip đứng yên tại tâm ô.
 *
 * Thuần hiển thị: không đổi state trò chơi. Chọn vật nuôi bằng raycast vào hộp chạm vô
 * hình đi theo từng con (`userData.animalId`).
 */
import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  BoxGeometry,
  Group,
  LoopOnce,
  LoopRepeat,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Raycaster,
  SkinnedMesh,
} from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { FarmCellRef, FarmFreeRoamSpecies, FarmPlot, FarmSpecies } from '../models/ocb-farm.model';
import { clampRoamTarget } from './anchored-roam';
import { nextFreeRoamTarget } from './free-roam-pet';
import { CELL_SIZE, cellToWorld, formatCell, parseCell, worldToCell } from './farm-scene-math';
import { fitMatrix, fitSpecFor, fittedSize, modelBounds } from './model-fit';
import { TILE_HEIGHT } from './geometry/plot-grid.geometry';

export interface FarmAnimalSpawn {
  id: string;
  /**
   * Anchor_Cell — ô chiếm chỗ ở server (6 loài hiện có) hoặc ô hiện tại (Free_Roam_Pet).
   * Luôn giữ nguyên giá trị này cho logic nghiệp vụ/raycast mapping (`pickAt`), KHÔNG bao
   * giờ bị ghi đè bởi vị trí roam hiển thị (AC 5.6).
   */
  cell: FarmCellRef;
  species: FarmSpecies | FarmFreeRoamSpecies;
  /** Mã hiển thị (`animal:<loài>`) — đổi mã hoặc đổi mô hình gốc thì dựng lại con vật. */
  key: string;
  /** Tâm ô (đơn vị thế giới). */
  x: number;
  z: number;
  /** Độ no = 0 → ủ rũ, đi chậm. */
  hungry?: boolean;
}

/** Thông tin lưới cần cho `enterMove()` gọi `clampRoamTarget` (Anchored_Animal — 6 loài hiện có). */
export interface FarmAnimalRoamContext {
  plots: readonly FarmPlot[];
}

/** Loại phản ứng ngắn — khớp hiệu ứng thao tác của khung 3D. */
export type FarmAnimalReaction = 'happy' | 'harvest' | 'poke';

interface SpeciesMotion {
  /** Tốc độ đi (ô/giây). */
  speed: number;
  /**
   * Bán kính đi lại quanh tâm ô (theo cạnh ô — đơn vị "số ô", nhân với `CELL_SIZE` khi dùng).
   * Với 6 loài hiện có (Anchored_Animal), đây là Roam_Radius quanh Anchor_Cell (AC 5.1):
   * tăng từ "trong 1 ô" (giá trị cũ ~0.24–0.32) lên **2.5 ô** — đủ để hiển thị di chuyển qua
   * vài ô lân cận sau khi CELL_SIZE tăng gấp đôi (10 → 20), nhưng không quá xa khỏi Anchor_Cell
   * (giá trị cụ thể để lại cho thiết kế, chọn 2.5 ô làm mật độ hiển thị hợp lý — xem design.md
   * mục 7 "Mở rộng animation cho model mới" / Data Models).
   * `dog`/`cat` (Free_Roam_Pet) không dùng field này cho đĩa bán kính — đặt `999` làm giá trị
   * không dùng vì đích di chuyển của Free_Roam_Pet lấy từ toàn lưới qua `nextFreeRoamTarget()`
   * (có tránh ô đang bị vật nuôi khác chiếm), không qua bán kính quanh `homeX/homeZ`.
   */
  roam: number;
  /** Khoảng nghỉ giữa hai hành vi (giây). */
  idleMin: number;
  idleMax: number;
  /** Trọng số chọn hành vi kế tiếp: đi / chạy / ăn / ngoái nhìn. */
  weights: readonly [walk: number, run: number, eat: number, look: number];
}

/** Roam_Radius (ô) cho 6 loài Anchored_Animal hiện có — xem giải thích ở `SpeciesMotion.roam`. */
const ANCHORED_ROAM_RADIUS_CELLS = 2.5;

const MOTION: Readonly<Record<FarmSpecies | FarmFreeRoamSpecies, SpeciesMotion>> = {
  chicken: { speed: 0.16, roam: ANCHORED_ROAM_RADIUS_CELLS, idleMin: 0.6, idleMax: 2.2, weights: [5, 1, 4, 2] },
  sheep: { speed: 0.07, roam: ANCHORED_ROAM_RADIUS_CELLS, idleMin: 1.6, idleMax: 4, weights: [4, 1, 5, 2] },
  pig: { speed: 0.08, roam: ANCHORED_ROAM_RADIUS_CELLS, idleMin: 1.2, idleMax: 3.5, weights: [4, 1, 4, 2] },
  cow: { speed: 0.06, roam: ANCHORED_ROAM_RADIUS_CELLS, idleMin: 2, idleMax: 5, weights: [3, 0.5, 6, 2] },
  horse: { speed: 0.1, roam: ANCHORED_ROAM_RADIUS_CELLS, idleMin: 1.5, idleMax: 4, weights: [4, 2.5, 3, 2] },
  fish: { speed: 0.12, roam: ANCHORED_ROAM_RADIUS_CELLS, idleMin: 0, idleMax: 0, weights: [1, 0, 0, 0] },
  // Free_Roam_Pet (chó/mèo) — `roam` không dùng, đích lấy từ toàn lưới (xem SpeciesMotion.roam).
  dog: { speed: 0.14, roam: 999, idleMin: 0.8, idleMax: 2.5, weights: [5, 2, 1, 2] },
  cat: { speed: 0.11, roam: 999, idleMin: 1.0, idleMax: 3.0, weights: [4, 1.5, 1, 3] },
};

const RUN_MULTIPLIER = 2.6;
const TURN_SPEED = 4.5; // rad/s
const ARRIVE_EPS = 0.02 * CELL_SIZE;
const CROSSFADE_S = 0.3;
/** Cá lượn dưới mặt nước, trên đáy ao. */
const FISH_BASE_Y = -TILE_HEIGHT * 0.85;
const FISH_DEPTH_SWAY = 0.03 * CELL_SIZE;
const FISH_LEAP_HEIGHT = 0.16 * CELL_SIZE;
const FISH_LEAP_S = 0.9;
const HOP_HEIGHT = 0.018 * CELL_SIZE;
const HOP_RATE = 11;
const REACT_HEIGHT = 0.07 * CELL_SIZE;
const REACT_S = 0.6;
const EAT_MIN_S = 2.5;
const EAT_MAX_S = 5;
const LOOK_S = 1.4;
const MIN_HIT_SIZE = 0.18 * CELL_SIZE;

const hitMaterial = new MeshBasicMaterial({ visible: false });

type ActorState = 'idle' | 'walk' | 'run' | 'eat' | 'look' | 'react';

interface AnimalClips {
  idle: AnimationAction | null;
  walk: AnimationAction | null;
  run: AnimationAction | null;
  eat: AnimationAction | null;
  jump: AnimationAction | null;
}

interface AnimalActor {
  id: string;
  key: string;
  species: FarmSpecies | FarmFreeRoamSpecies;
  cell: FarmCellRef;
  source: Object3D;
  root: Group;
  /** Nhún / bật nảy / co giãn — tách khỏi `root` (vị trí + hướng). */
  bob: Group;
  model: Object3D;
  hit: Mesh<BoxGeometry, MeshBasicMaterial>;
  mixer: AnimationMixer;
  clips: AnimalClips;
  current: AnimationAction | null;
  homeX: number;
  homeZ: number;
  state: ActorState;
  /** Thời gian còn lại của hành vi hiện tại (giây). */
  timer: number;
  /** Thời gian đã trôi trong hành vi hiện tại (giây). */
  stateTime: number;
  targetX: number;
  targetZ: number;
  heading: number;
  lookFrom: number;
  lookTo: number;
  hungry: boolean;
  /** Phản ứng hiện tại có xoay một vòng (vui) hay chỉ bật nảy (được chọn). */
  spin: boolean;
  /** Cá: góc trên quỹ đạo bơi, đếm ngược tới lần nhảy kế tiếp, tiến độ nhảy. */
  orbit: number;
  leapIn: number;
  leapT: number;
  phase: number;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Bỏ root motion (dịch chuyển vị trí) khỏi clip trước khi dùng.
 *
 * Một số bộ mô hình (Quaternius: Alpaca/Bull/Donkey/Horse(v2)/Sheep(v1)/Stag…) animate
 * luôn cả `.position` của xương gốc skeleton (`Body`) trong clip Walk/Run/Gallop — nghĩa
 * là animation tự "đẩy" mô hình tới trước/lên xuống theo chu kỳ bước, SONG SONG với vị
 * trí do `stepMove()` tự tính (tốc độ loài × dt). Hai chuyển động chồng lên nhau không
 * cùng pha/tốc độ → chân trông "trượt", nhìn như nhảy cóc thay vì bước đều.
 *
 * Các mô hình khác (6 loài gốc không phải Quaternius) chỉ animate rotation của khớp
 * chân/đầu/đuôi, không có track `.position` trên xương gốc, nên hàm này không ảnh hưởng.
 *
 * Xoá track `.position` của BONE ĐẦU TIÊN xuất hiện trong clip (xương gốc luôn được
 * animate trước các xương con trong thứ tự xuất khẩu của Quaternius) — giữ nguyên mọi
 * track rotation (chuyển động chân/đầu/đuôi tự nhiên vẫn chạy đúng).
 */
function stripRootMotion(clip: AnimationClip): AnimationClip {
  const rootName = clip.tracks.find((t) => t.name.endsWith('.position'))?.name.split('.')[0];
  if (!rootName) return clip;
  const kept = clip.tracks.filter((t) => !(t.name === `${rootName}.position`));
  if (kept.length === clip.tracks.length) return clip;
  const stripped = new AnimationClip(clip.name, clip.duration, kept, clip.blendMode);
  return stripped;
}

function findClip(clips: readonly AnimationClip[], patterns: readonly RegExp[]): AnimationClip | null {
  for (const re of patterns) {
    const clip = clips.find((c) => re.test(c.name));
    if (clip) return clip;
  }
  return null;
}

/** Góc chênh ngắn nhất trong [-π, π]. */
function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function easeOutBack(t: number): number {
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
}

/** Chọn chỉ số theo trọng số. */
function weightedPick(weights: readonly number[]): number {
  const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (total <= 0) return 0;
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= Math.max(0, weights[i]);
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

export class FarmAnimalLayer {
  readonly root = new Group();
  private readonly actors = new Map<string, AnimalActor>();
  private reducedMotion = false;
  /**
   * Lưới hiện tại — dùng bởi `enterMove()` để gọi `clampRoamTarget` (Anchored_Animal) và
   * `nextFreeRoamTarget` (Free_Roam_Pet) mỗi khi chọn điểm đích roam mới.
   */
  private roamContext: FarmAnimalRoamContext = { plots: [] };

  constructor() {
    this.root.name = 'farm-animals';
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  /** Id vật nuôi đang được dựng có hoạt ảnh. */
  has(id: string): boolean {
    return this.actors.has(id);
  }

  /**
   * Đồng bộ danh sách vật nuôi. `templateOf(key)` trả cảnh gốc (hoặc `null` → vật nuôi đó
   * không thuộc lớp này, khung 3D vẽ bằng instancing). `roamContext.plots` được lưu lại để
   * `enterMove()` gọi `clampRoamTarget` (Anchored_Animal, 6 loài hiện có) hoặc
   * `nextFreeRoamTarget` (Free_Roam_Pet) mỗi khi chọn điểm đích mới — cả hai đều tránh ô mà
   * một vật nuôi khác đang đứng hoặc đang di chuyển tới. Trả về id các con lớp này nhận vẽ.
   */
  sync(
    spawns: readonly FarmAnimalSpawn[],
    templateOf: (key: string) => Object3D | null,
    roamContext: FarmAnimalRoamContext,
  ): Set<string> {
    this.roamContext = roamContext;
    const taken = new Set<string>();
    const alive = new Set<string>();
    for (const spawn of spawns) {
      const template = templateOf(spawn.key);
      if (!template) continue;
      alive.add(spawn.id);
      let actor = this.actors.get(spawn.id);
      if (actor && (actor.key !== spawn.key || actor.source !== template)) {
        this.removeActor(actor);
        actor = undefined;
      }
      if (!actor) {
        actor = this.createActor(spawn, template);
        this.actors.set(spawn.id, actor);
      } else {
        const wasHungry = actor.hungry;
        actor.hungry = spawn.hungry === true;
        if (actor.cell !== spawn.cell) {
          // Đổi ô (di chuyển vật nuôi) → về tâm ô mới.
          actor.cell = spawn.cell;
          actor.homeX = spawn.x;
          actor.homeZ = spawn.z;
          actor.root.position.set(spawn.x, actor.root.position.y, spawn.z);
          this.enterIdle(actor);
        } else if (wasHungry && !actor.hungry) {
          // Vừa được cho ăn → vui mừng nhảy cẫng rồi chạy một vòng.
          this.react(actor, 'happy');
        }
      }
      taken.add(spawn.id);
    }
    for (const actor of [...this.actors.values()]) {
      if (!alive.has(actor.id)) this.removeActor(actor);
    }
    return taken;
  }

  /** Phản ứng ngắn của vật nuôi ở ô `cell` (cho ăn / thu hoạch / được chọn). */
  reactAt(cell: FarmCellRef, kind: FarmAnimalReaction): void {
    if (this.reducedMotion) return;
    for (const actor of this.actors.values()) {
      if (actor.cell === cell) this.react(actor, kind);
    }
  }

  /** Gọi mỗi khung hình; `dt` giây, `elapsed` giây kể từ khi bắt đầu. */
  update(dt: number, elapsed: number): void {
    if (dt <= 0) return;
    for (const actor of this.actors.values()) {
      if (!this.reducedMotion) {
        if (actor.species === 'fish') this.stepFish(actor, dt, elapsed);
        else this.stepLand(actor, dt, elapsed);
      }
      actor.mixer.update(dt);
    }
  }

  /** Id con vật trúng tia (gần nhất), không trúng → `null`. */
  pick(raycaster: Raycaster): { id: string; distance: number } | null {
    if (this.actors.size === 0) return null;
    const hits = raycaster.intersectObjects(
      [...this.actors.values()].map((a) => a.hit),
      false,
    );
    const first = hits[0];
    if (!first) return null;
    const id = first.object.userData['animalId'] as string | undefined;
    return id ? { id, distance: first.distance } : null;
  }

  clear(): void {
    for (const actor of [...this.actors.values()]) this.removeActor(actor);
  }

  dispose(): void {
    this.clear();
    this.root.removeFromParent();
  }

  // ---------------------------------------------------------------------------
  // Dựng / huỷ
  // ---------------------------------------------------------------------------

  private createActor(spawn: FarmAnimalSpawn, template: Object3D): AnimalActor {
    const model = cloneSkinned(template);
    const spec = fitSpecFor(spawn.key);
    const box = modelBounds(model);

    // gốc (vị trí + hướng) → nhún/co giãn → chuẩn hoá kích thước → mô hình
    const fit = new Group();
    fit.matrixAutoUpdate = false;
    fit.matrix.copy(fitMatrix(box, spec));
    fit.add(model);
    model.traverse((obj) => {
      // Hộp bao của SkinnedMesh tính theo tư thế gốc → tắt cắt khung để khỏi nhấp nháy khi đi.
      if (obj instanceof SkinnedMesh) obj.frustumCulled = false;
    });

    const bob = new Group();
    bob.add(fit);

    const size = fittedSize(box, spec);
    const hitHeight = Math.max(MIN_HIT_SIZE, size.y * 1.2);
    const hitGeometry = new BoxGeometry(
      Math.max(MIN_HIT_SIZE, size.x * 1.3),
      hitHeight,
      Math.max(MIN_HIT_SIZE, size.z * 1.3),
    );
    hitGeometry.applyMatrix4(new Matrix4().makeTranslation(0, hitHeight / 2, 0));
    const hit = new Mesh(hitGeometry, hitMaterial);
    hit.name = 'farm-animal-hit';
    hit.userData['animalId'] = spawn.id;

    const root = new Group();
    root.name = `farm-animal:${spawn.id}`;
    root.userData['animalId'] = spawn.id;
    root.add(bob, hit);

    const isFish = spawn.species === 'fish';
    root.position.set(spawn.x, isFish ? FISH_BASE_Y : 0, spawn.z);
    const heading = Math.random() * Math.PI * 2;
    root.rotation.y = heading;
    this.root.add(root);

    const mixer = new AnimationMixer(model);
    const clips = this.buildClips(mixer, template.animations, isFish);

    const actor: AnimalActor = {
      id: spawn.id,
      key: spawn.key,
      species: spawn.species,
      cell: spawn.cell,
      source: template,
      root,
      bob,
      model,
      hit,
      mixer,
      clips,
      current: null,
      homeX: spawn.x,
      homeZ: spawn.z,
      state: 'idle',
      timer: rand(0, MOTION[spawn.species].idleMax),
      stateTime: 0,
      targetX: spawn.x,
      targetZ: spawn.z,
      heading,
      lookFrom: heading,
      lookTo: heading,
      hungry: spawn.hungry === true,
      spin: false,
      orbit: Math.random() * Math.PI * 2,
      leapIn: rand(6, 16),
      leapT: -1,
      phase: Math.random() * Math.PI * 2,
    };
    this.play(actor, clips.idle);

    // Clip phát một lần (nhảy) xong → quay lại đứng yên.
    mixer.addEventListener('finished', (e) => {
      if (e.action === actor.clips.jump && actor.state === 'react') this.enterIdle(actor);
    });
    return actor;
  }

  /** Lấy clip theo tên — bộ Quaternius khác nhau đặt tên khác nhau. */
  private buildClips(mixer: AnimationMixer, all: readonly AnimationClip[], isFish: boolean): AnimalClips {
    const usable = all.filter((c) => !/death|attack|hit|headbutt|kick|jump_start/i.test(c.name));
    const action = (clip: AnimationClip | null, loop = true): AnimationAction | null => {
      if (!clip) return null;
      const a = mixer.clipAction(stripRootMotion(clip));
      if (loop) a.setLoop(LoopRepeat, Infinity);
      else {
        a.setLoop(LoopOnce, 1);
        a.clampWhenFinished = false;
      }
      // Lệch pha để cả đàn không cử động đồng loạt.
      a.time = Math.random() * clip.duration;
      return a;
    };
    if (isFish) {
      return { idle: action(findClip(all, [/swim/i]) ?? all[0] ?? null), walk: null, run: null, eat: null, jump: null };
    }
    return {
      idle: action(findClip(usable, [/\|idle$/i, /^idle$/i, /idle(?!_hit|_eat|_peck)/i, /eat/i, /peck/i])),
      walk: action(findClip(usable, [/walkslow/i, /walk/i, /trot/i])),
      run: action(findClip(usable, [/\|run$/i, /^run$/i, /gallop(?!_jump)/i, /run/i])),
      eat: action(findClip(usable, [/idle_eating/i, /eating/i, /eat/i, /peck/i])),
      jump: action(findClip(usable, [/jump_loop/i, /gallop_jump/i, /^jump$/i, /\|jump$/i, /jump/i]), false),
    };
  }

  private removeActor(actor: AnimalActor): void {
    actor.mixer.stopAllAction();
    actor.mixer.uncacheRoot(actor.model);
    actor.root.removeFromParent();
    actor.hit.geometry.dispose();
    // Geometry/material của mô hình thuộc AssetLoaderService; chỉ giải phóng texture xương.
    actor.model.traverse((obj) => {
      if (obj instanceof SkinnedMesh) obj.skeleton.dispose();
    });
    this.actors.delete(actor.id);
  }

  // ---------------------------------------------------------------------------
  // Clip
  // ---------------------------------------------------------------------------

  private play(actor: AnimalActor, action: AnimationAction | null, timeScale = 1): void {
    if (!action) return;
    action.enabled = true;
    action.setEffectiveTimeScale(timeScale);
    action.setEffectiveWeight(1);
    if (actor.current === action) return;
    action.reset().play();
    if (actor.current) actor.current.crossFadeTo(action, CROSSFADE_S, false);
    actor.current = action;
  }

  // ---------------------------------------------------------------------------
  // Hành vi
  // ---------------------------------------------------------------------------

  private setState(actor: AnimalActor, state: ActorState, duration: number): void {
    actor.state = state;
    actor.timer = duration;
    actor.stateTime = 0;
    actor.bob.position.y = 0;
    actor.bob.rotation.set(0, 0, 0);
    actor.bob.scale.set(1, 1, 1);
  }

  private enterIdle(actor: AnimalActor): void {
    const m = MOTION[actor.species];
    // Đói → đứng ủ rũ lâu hơn.
    const slow = actor.hungry ? 2 : 1;
    this.setState(actor, 'idle', rand(m.idleMin, m.idleMax) * slow);
    this.play(actor, actor.clips.idle, actor.hungry ? 0.6 : 1);
  }

  /** Hết thời gian đứng → chọn hành vi kế tiếp theo trọng số của loài. */
  private nextBehaviour(actor: AnimalActor): void {
    const [walk, run, eat, look] = MOTION[actor.species].weights;
    const choice = weightedPick(actor.hungry ? [walk, 0, eat * 0.3, look * 2] : [walk, run, eat, look]);
    if (choice === 0) this.enterMove(actor, false);
    else if (choice === 1) this.enterMove(actor, true);
    else if (choice === 2) this.enterEat(actor);
    else this.enterLook(actor);
  }

  private enterMove(actor: AnimalActor, running: boolean): void {
    const roam = MOTION[actor.species].roam * CELL_SIZE;
    // Điểm ngẫu nhiên phân bố đều trong đĩa bán kính `roam` quanh tâm ô; chạy thì đi xa hơn.
    const r = Math.sqrt(rand(running ? 0.5 : 0, 1)) * roam;
    const a = Math.random() * Math.PI * 2;
    const candidateX = actor.homeX + Math.cos(a) * r;
    const candidateZ = actor.homeZ + Math.sin(a) * r;
    // Ô mà vật nuôi khác đang chiếm — vị trí hiển thị HIỆN TẠI (không chỉ Anchor_Cell), để
    // không con vật nào chọn đích trùng ô với một con khác đang đứng/đang roam tới đó.
    const occupiedByOthers = [...this.actors.values()]
      .filter((other) => other.id !== actor.id)
      .map((other) => formatCell(worldToCell(other.root.position.x, other.root.position.z)));
    // Free_Roam_Pet (chó/mèo) không có Anchor_Cell cố định theo nghĩa server — chỉ Anchored_Animal
    // (6 loài hiện có) cần giới hạn đích roam trong vùng đã mở khoá/đúng địa hình (AC 5.1, 5.2, 5.3).
    if (actor.species === 'dog' || actor.species === 'cat') {
      const target = nextFreeRoamTarget(
        this.roamContext.plots,
        actor.cell,
        () => Math.random(),
        occupiedByOthers,
      );
      const targetCoord = target ? parseCell(target) : null;
      if (targetCoord) {
        const coord = cellToWorld(targetCoord);
        actor.targetX = coord.x;
        actor.targetZ = coord.z;
      } else {
        actor.targetX = candidateX;
        actor.targetZ = candidateZ;
      }
    } else {
      const clamped = clampRoamTarget(
        actor.cell,
        candidateX,
        candidateZ,
        this.roamContext.plots,
        actor.species,
        occupiedByOthers,
      );
      actor.targetX = clamped.x;
      actor.targetZ = clamped.z;
    }
    this.setState(actor, running ? 'run' : 'walk', 0);
    if (running) this.play(actor, actor.clips.run ?? actor.clips.walk ?? actor.clips.idle, actor.clips.run ? 1 : 1.8);
    else this.play(actor, actor.clips.walk ?? actor.clips.idle, actor.hungry ? 0.6 : 1);
  }

  private enterEat(actor: AnimalActor): void {
    this.setState(actor, 'eat', rand(EAT_MIN_S, EAT_MAX_S));
    this.play(actor, actor.clips.eat ?? actor.clips.idle);
  }

  private enterLook(actor: AnimalActor): void {
    this.setState(actor, 'look', LOOK_S);
    actor.lookFrom = actor.heading;
    actor.lookTo = actor.heading + rand(-1.2, 1.2);
    this.play(actor, actor.clips.idle);
  }

  private react(actor: AnimalActor, kind: FarmAnimalReaction): void {
    if (actor.species === 'fish') {
      // Cá phản ứng bằng một cú nhảy khỏi mặt nước.
      if (actor.leapT < 0) actor.leapT = 0;
      return;
    }
    this.setState(actor, 'react', REACT_S * (kind === 'poke' ? 0.8 : 1.2));
    actor.spin = kind !== 'poke';
    if (actor.clips.jump) {
      actor.clips.jump.reset();
      this.play(actor, actor.clips.jump);
    }
  }

  private stepLand(actor: AnimalActor, dt: number, elapsed: number): void {
    actor.stateTime += dt;
    switch (actor.state) {
      case 'idle': {
        // Thở: thân phồng xẹp rất nhẹ.
        const breath = Math.sin(elapsed * (actor.hungry ? 1.6 : 2.4) + actor.phase) * 0.012;
        actor.bob.scale.set(1 - breath * 0.5, 1 + breath, 1 - breath * 0.5);
        // Đói → cúi đầu ủ rũ.
        actor.bob.rotation.x = actor.hungry ? 0.08 : 0;
        actor.timer -= dt;
        if (actor.timer <= 0) this.nextBehaviour(actor);
        return;
      }
      case 'eat': {
        // Không có clip ăn → gật đầu gặm cỏ thủ tục.
        if (!actor.clips.eat) actor.bob.rotation.x = 0.12 + Math.max(0, Math.sin(elapsed * 6 + actor.phase)) * 0.12;
        actor.timer -= dt;
        if (actor.timer <= 0) this.enterIdle(actor);
        return;
      }
      case 'look': {
        const t = Math.min(1, actor.stateTime / LOOK_S);
        // Ngoái sang một bên rồi quay lại (sin 0 → 1 → 0).
        const k = Math.sin(t * Math.PI);
        actor.root.rotation.y = actor.lookFrom + (actor.lookTo - actor.lookFrom) * k;
        if (t >= 1) {
          actor.root.rotation.y = actor.heading;
          this.enterIdle(actor);
        }
        return;
      }
      case 'react': {
        const total = Math.max(actor.timer, 1e-3);
        const t = Math.min(1, actor.stateTime / total);
        if (!actor.clips.jump) {
          // Bật nảy kiểu hoạt hình: nén → bật lên (giãn) → tiếp đất (nén nhẹ).
          const arc = Math.sin(t * Math.PI);
          actor.bob.position.y = arc * REACT_HEIGHT;
          const squash = t < 0.15 ? 1 - (t / 0.15) * 0.18 : t > 0.85 ? 1 - ((1 - t) / 0.15) * 0.12 : 1 + arc * 0.12;
          actor.bob.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
        } else {
          actor.bob.position.y = Math.sin(t * Math.PI) * REACT_HEIGHT * 0.3;
        }
        // Xoay một vòng khi vui (cho ăn / thu hoạch).
        actor.root.rotation.y = actor.heading + (actor.spin ? easeOutBack(t) * Math.PI * 2 : 0);
        if (t >= 1) {
          actor.root.rotation.y = actor.heading;
          if (actor.hungry) this.enterIdle(actor);
          else this.enterMove(actor, Math.random() < 0.6);
        }
        return;
      }
      case 'walk':
      case 'run':
        this.stepMove(actor, dt, elapsed);
        return;
    }
  }

  private stepMove(actor: AnimalActor, dt: number, elapsed: number): void {
    const pos = actor.root.position;
    const dx = actor.targetX - pos.x;
    const dz = actor.targetZ - pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < ARRIVE_EPS) {
      // Tới nơi: hay ăn cỏ luôn tại chỗ.
      if (!actor.hungry && Math.random() < 0.35) this.enterEat(actor);
      else this.enterIdle(actor);
      return;
    }
    const running = actor.state === 'run';
    // Quay đầu trước, đi khi đã gần đúng hướng (tránh trượt ngang).
    const want = Math.atan2(dx, dz);
    const delta = angleDelta(actor.heading, want);
    const turn = Math.sign(delta) * Math.min(Math.abs(delta), TURN_SPEED * (running ? 1.6 : 1) * dt);
    actor.heading += turn;
    actor.root.rotation.y = actor.heading;
    const facing = Math.max(0, Math.cos(delta));
    const speed = MOTION[actor.species].speed * CELL_SIZE * (running ? RUN_MULTIPLIER : 1) * (actor.hungry ? 0.5 : 1);
    const step = Math.min(dist, speed * dt * facing);
    pos.x += (dx / dist) * step;
    pos.z += (dz / dist) * step;
    const clip = running ? actor.clips.run : actor.clips.walk;
    if (!clip) {
      // Thiếu clip đi/chạy → nhún nhảy thủ tục, chạy thì nảy cao + nhanh hơn.
      const rate = HOP_RATE * (running ? 1.5 : 1);
      const height = HOP_HEIGHT * (running ? 1.8 : 1);
      actor.bob.position.y = Math.abs(Math.sin(elapsed * rate + actor.phase)) * height * facing;
      // Lắc lư thân theo nhịp bước.
      actor.bob.rotation.z = Math.sin(elapsed * rate + actor.phase) * 0.06 * facing;
    }
    // Chạy thì chúi người về trước một chút.
    actor.bob.rotation.x = running ? 0.06 : 0;
  }

  private stepFish(actor: AnimalActor, dt: number, elapsed: number): void {
    const m = MOTION.fish;
    const radius = m.roam * CELL_SIZE * (0.75 + 0.25 * Math.sin(elapsed * 0.4 + actor.phase));
    actor.orbit += ((m.speed * CELL_SIZE) / Math.max(radius, 1e-3)) * dt;
    const x = actor.homeX + Math.cos(actor.orbit) * radius;
    const z = actor.homeZ + Math.sin(actor.orbit) * radius;
    const pos = actor.root.position;
    const dx = x - pos.x;
    const dz = z - pos.z;
    if (Math.hypot(dx, dz) > 1e-4) {
      actor.heading = Math.atan2(dx, dz);
      actor.root.rotation.y = actor.heading;
    }
    let y = FISH_BASE_Y + Math.sin(elapsed * 1.3 + actor.phase) * FISH_DEPTH_SWAY;

    // Nhảy vọt khỏi mặt nước: cung parabol + chúc đầu theo hướng bay.
    actor.leapIn -= dt;
    if (actor.leapT < 0 && actor.leapIn <= 0) actor.leapT = 0;
    if (actor.leapT >= 0) {
      actor.leapT += dt / FISH_LEAP_S;
      const t = Math.min(1, actor.leapT);
      y += Math.sin(t * Math.PI) * FISH_LEAP_HEIGHT;
      actor.bob.rotation.x = -Math.cos(t * Math.PI) * 0.9;
      if (t >= 1) {
        actor.leapT = -1;
        actor.leapIn = rand(8, 20);
        actor.bob.rotation.x = 0;
      }
    }
    pos.set(x, y, z);
  }
}
