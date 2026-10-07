/**
 * Cây OCB theo tham số thâm niên (US-5, US-6, US-7, US-9, BR-1..BR-4).
 *
 * Lắp ghép từ đúng BA mẫu hình học cho mỗi cây:
 * - một mẫu thân (hình trụ đơn vị, đáy ở y = 0),
 * - một mẫu nhánh (hình trụ thon đơn vị, gốc ở y = 0),
 * - một mẫu tán lá (khối 20 mặt chia nhỏ, bán kính 1).
 * Thân và tán chính là `Mesh` dùng mẫu thân/tán; nhánh và chùm lá đầu nhánh là
 * `InstancedMesh` nhân bản mẫu nhánh/tán theo `branches` → số draw call không tăng theo
 * thâm niên. Geometry/material dùng chung giữa các bản nhân trong cùng một cây;
 * `disposeObject3D` khử trùng lặp nên giải phóng an toàn.
 *
 * Quy tắc hình dạng (tất cả tất định — cùng tham số → cùng hình):
 * - `milestone` (số kỳ 6 tháng, BR-2): chiều cao thân và bán kính tán nhân thêm
 *   `growthRatio` cho mỗi mốc (mặc định {@link TREE_GROWTH_RATIO}), nên mốc sau luôn lớn
 *   hơn mốc liền trước tối thiểu theo tỷ lệ đó (US-5).
 * - `branches` (đầu vào là kết quả `branchCount()` của module thâm niên = số năm tròn − 2,
 *   tối thiểu 0, có trần `tree_max_branches`, BR-3): nhánh thứ `i` (0-based) tượng trưng
 *   năm gắn bó thứ `i + 3`. Vị trí nhánh `i` không phụ thuộc tổng số nhánh — thêm năm mới
 *   chỉ mọc thêm nhánh, các nhánh cũ giữ nguyên chỗ (góc xoắn ốc theo góc vàng).
 * - `blooming` (US-7): hoa + quả trên tán. Module chỉ vẽ; điều kiện ngày kỷ niệm và
 *   thâm niên ≥ 3 năm (BR-4) do lớp gọi quyết định.
 *
 * Hàm thuần, không phụ thuộc Angular.
 *
 * _Requirements: US-5, US-6, US-7, US-9, BR-1, BR-2, BR-3, BR-4_
 */
import {
  Color,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from 'three';

export interface OcbTreeParams {
  /** Số kỳ 6 tháng đã hoàn thành (`state.tree.milestone`). */
  milestone: number;
  /** Số nhánh lớn do module thâm niên trả về (`state.tree.branches`). */
  branches: number;
  /** Trạng thái ra hoa kết quả ngày kỷ niệm (US-7). Mặc định `false`. */
  blooming?: boolean;
  /** Số quả khi `blooming` (khớp `anniversary_fruit_count`, mặc định 5). */
  fruitCount?: number;
  /** Năm vào làm — để mỗi nhánh biết năm dương lịch nó tượng trưng (US-6). */
  joinYear?: number | null;
  /** Tỷ lệ lớn tối thiểu giữa hai mốc liền kề (> 1). Mặc định {@link TREE_GROWTH_RATIO}. */
  growthRatio?: number;
  trunkColor?: string;
  leafColor?: string;
}

/** Thông tin nhánh gắn vào từng instance — UI hiển thị "năm gắn bó thứ mấy" khi bấm (US-6). */
export interface OcbTreeBranchInfo {
  /** Chỉ số nhánh, 0 = nhánh đầu tiên (năm thứ 3). */
  index: number;
  /** Năm gắn bó thứ mấy mà nhánh tượng trưng (= index + 3). */
  tenureYear: number;
  /** Năm dương lịch của ngày kỷ niệm tương ứng; `null` khi không biết năm vào làm. */
  calendarYear: number | null;
}

export interface OcbTreeDimensions {
  trunkHeight: number;
  trunkRadius: number;
  canopyRadius: number;
  branchLength: number;
}

export interface OcbTreeBranchPlacement {
  /** Góc phương vị quanh thân (radian). */
  azimuth: number;
  /** Độ cao gốc nhánh theo tỉ lệ chiều cao thân (0..1). */
  heightRatio: number;
  /** Góc nghiêng khỏi phương thẳng đứng (radian). */
  tilt: number;
  /** Tỉ lệ độ dài so với `branchLength`. */
  lengthScale: number;
}

export const OCB_TREE_NAME = 'farm-ocb-tree';
export const OCB_TREE_TRUNK_NAME = 'farm-ocb-tree-trunk';
export const OCB_TREE_CANOPY_NAME = 'farm-ocb-tree-canopy';
export const OCB_TREE_BRANCH_NAME = 'farm-ocb-tree-branches';
export const OCB_TREE_TUFT_NAME = 'farm-ocb-tree-tufts';
export const OCB_TREE_BLOOM_NAME = 'farm-ocb-tree-bloom';

/**
 * Tỷ lệ lớn mặc định giữa hai mốc liền kề (US-5). `farm_config` chưa có khóa riêng cho
 * tỷ lệ này nên dùng hằng số; truyền `growthRatio` để ghi đè khi có khóa cấu hình.
 * 1.025^40 ≈ 2.7 → ở mốc tối đa mặc định (`tree_max_milestone` = 40) cây vẫn vừa khung.
 */
export const TREE_GROWTH_RATIO = 1.025;
/** Năm thâm niên của nhánh đầu tiên (BR-3: 3 năm → 1 nhánh). */
export const FIRST_BRANCH_TENURE_YEAR = 3;
/** Trần an toàn khi dựng — khớp `max_value` của `tree_max_milestone` / `tree_max_branches`. */
export const TREE_RENDER_MAX_MILESTONE = 200;
export const TREE_RENDER_MAX_BRANCHES = 200;
export const DEFAULT_FRUIT_COUNT = 5;

const BASE_TRUNK_HEIGHT = 0.55;
const BASE_TRUNK_RADIUS = 0.05;
const BASE_CANOPY_RADIUS = 0.22;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const BLOSSOMS_PER_TREE = 10;

// Bảng màu pixel-farm (ấm, tươi) — tán xanh lá OCB phối nhiều sắc độ.
const DEFAULT_TRUNK_COLOR = '#7A4B2A';
const DEFAULT_LEAF_COLOR = '#3FA34D';
const LEAF_SHADES = ['#2F7D3A', '#3FA34D', '#5DB84A', '#7CC75A', '#B5DE5C'] as const;
const MOUND_COLOR = '#4F8A2A';
const FRUIT_COLOR = '#E8503A';
const BLOSSOM_COLOR = '#F7B6CF';
/** Số "chùm lá" phồng quanh tán chính — tán tròn đầy, nhiều sắc độ. */
const CANOPY_PUFFS = 16;
const ROOT_COUNT = 5;

export const OCB_TREE_PUFF_NAME = 'farm-ocb-tree-puffs';
export const OCB_TREE_ROOT_NAME = 'farm-ocb-tree-roots';
export const OCB_TREE_MOUND_NAME = 'farm-ocb-tree-mound';

function clampInt(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(max, Math.floor(value)));
}

function validRatio(ratio: number | undefined): number {
  return typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 1 ? ratio : TREE_GROWTH_RATIO;
}

/** Kích thước cây theo mốc — mỗi mốc nhân thêm `growthRatio` (US-5). */
export function ocbTreeDimensions(milestone: number, growthRatio = TREE_GROWTH_RATIO): OcbTreeDimensions {
  const m = clampInt(milestone, TREE_RENDER_MAX_MILESTONE);
  const scale = Math.pow(validRatio(growthRatio), m);
  const canopyRadius = BASE_CANOPY_RADIUS * scale;
  return {
    trunkHeight: BASE_TRUNK_HEIGHT * scale,
    trunkRadius: BASE_TRUNK_RADIUS * scale,
    canopyRadius,
    branchLength: canopyRadius * 1.1,
  };
}

/**
 * Vị trí nhánh thứ `index` — chỉ phụ thuộc `index` (không phụ thuộc tổng số nhánh) nên
 * nhánh cũ giữ nguyên chỗ khi mọc nhánh mới. Nhánh cũ thấp, dài, nghiêng nhiều; nhánh mới
 * cao dần về phía ngọn.
 */
export function ocbTreeBranchPlacement(index: number): OcbTreeBranchPlacement {
  const i = Math.max(0, Math.floor(index));
  const t = i / (i + 4); // 0 → 1, tăng dần và bão hoà
  return {
    azimuth: (i * GOLDEN_ANGLE) % (Math.PI * 2),
    heightRatio: 0.35 + 0.5 * t,
    tilt: 1.0 - 0.3 * t,
    lengthScale: 1 - 0.3 * t,
  };
}

export function ocbTreeBranchInfo(index: number, joinYear: number | null = null): OcbTreeBranchInfo {
  const tenureYear = index + FIRST_BRANCH_TENURE_YEAR;
  const year = typeof joinYear === 'number' && Number.isFinite(joinYear) ? Math.floor(joinYear) + tenureYear : null;
  return { index, tenureYear, calendarYear: year };
}

/**
 * Thông tin nhánh từ kết quả raycast (`hit.object`, `hit.instanceId`) — trả `null` nếu
 * vật thể không phải nhánh/chùm lá đầu nhánh của Cây OCB.
 */
export function ocbTreeBranchAt(object: Object3D, instanceId: number | undefined): OcbTreeBranchInfo | null {
  if (instanceId === undefined) return null;
  if (object.name !== OCB_TREE_BRANCH_NAME && object.name !== OCB_TREE_TUFT_NAME) return null;
  const list = object.userData['branches'] as OcbTreeBranchInfo[] | undefined;
  return list?.[instanceId] ?? null;
}

/**
 * Ba mẫu hình học của một cây (thân, nhánh, tán) — đơn vị, scale bằng ma trận.
 *
 * Độ chi tiết tăng so với bản gốc (thân/nhánh 8/6 cạnh → 12/8 cạnh; tán mức chia nhỏ
 * 1 → 2, tức ~4× số tam giác) để bớt cảm giác "khối tròn trơn" khi nhìn gần, vẫn giữ
 * `flatShading` (phong cách khối vẽ tay) và vẫn CHỈ 3 geometry cho toàn cây — mọi phần
 * khác (chùm lá, rễ, hoa quả) tiếp tục tái dùng đúng 3 mẫu này qua `InstancedMesh`/`Mesh`
 * khác ma trận, không tăng số geometry riêng biệt (xem test "exactly one trunk, one
 * branch and one canopy template").
 */
function createTemplates(trunkColor: string): { trunk: CylinderGeometry; branch: CylinderGeometry; canopy: IcosahedronGeometry } {
  const trunk = new CylinderGeometry(0.7, 1, 1, 12);
  trunk.translate(0, 0.5, 0);
  applyBarkVariation(trunk, trunkColor);
  const branch = new CylinderGeometry(0.35, 0.55, 1, 8);
  branch.translate(0, 0.5, 0);
  applyBarkVariation(branch, trunkColor);
  const canopy = new IcosahedronGeometry(1, 2);
  return { trunk, branch, canopy };
}

function material(color: string, roughness: number): MeshStandardMaterial {
  // Mặt phẳng (flat shading) cho cảm giác khối vẽ tay.
  return new MeshStandardMaterial({ color: new Color(color), roughness, metalness: 0, flatShading: true });
}

/**
 * Vật liệu vỏ cây có variation màu nhẹ theo vertex (vân gỗ thô) — vẫn `flatShading`,
 * chỉ thêm `vertexColors` để không phẳng một màu tuyệt đối. `geometry` phải có attribute
 * `color` (gắn bởi {@link applyBarkVariation}) trước khi dùng vật liệu này.
 */
function barkMaterial(color: string, roughness: number): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: new Color(color),
    roughness,
    metalness: 0,
    flatShading: true,
    vertexColors: true,
  });
}

/**
 * Gắn màu vào từng vertex của geometry trụ (thân/nhánh/rễ) để mô phỏng vân gỗ thô: tối
 * nhẹ ở các dải dọc xen kẽ theo góc quanh trụ, tất định theo chính hình học (không phụ
 * thuộc tham số cây) nên MỘT bản geometry dùng chung cho mọi cây vẫn luôits ra đúng vân.
 * Chạy một lần trong {@link createTemplates}, không lặp lại mỗi khi dựng cây.
 */
function applyBarkVariation(geometry: CylinderGeometry, baseColor: string): CylinderGeometry {
  const base = new Color(baseColor);
  const dark = base.clone().multiplyScalar(0.78);
  const pos = geometry.attributes['position'];
  const colors = new Float32Array(pos.count * 3);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const angle = Math.atan2(z, x);
    // 10 dải dọc xen sáng/tối quanh trụ — vân gỗ thô, không cần texture.
    const stripe = Math.sin(angle * 10) > 0.3 ? dark : base;
    c.copy(stripe);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}

/** Rễ toả quanh gốc — dùng lại mẫu nhánh + vật liệu thân. */
function buildRoots(template: CylinderGeometry, trunkMaterial: MeshStandardMaterial, dims: OcbTreeDimensions): InstancedMesh {
  const mesh = new InstancedMesh(template, trunkMaterial, ROOT_COUNT);
  mesh.name = OCB_TREE_ROOT_NAME;
  mesh.castShadow = true;
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const euler = new Euler();
  const scale = new Vector3();
  const base = new Vector3(0, dims.trunkHeight * 0.06, 0);
  for (let i = 0; i < ROOT_COUNT; i++) {
    euler.set(0, (i / ROOT_COUNT) * Math.PI * 2 + 0.4, -1.25, 'YZX');
    rotation.setFromEuler(euler);
    scale.set(dims.trunkRadius * 0.55, dims.trunkRadius * (2.6 + (i % 2) * 0.8), dims.trunkRadius * 0.55);
    matrix.compose(base, rotation, scale);
    mesh.setMatrixAt(i, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/**
 * Chùm lá phồng quanh tán chính, rải theo xoắn ốc Fibonacci trên nửa cầu trên (cùng kỹ
 * thuật với {@link buildBloom}) — phân bố đều nhưng không máy móc như vòng tròn cố định,
 * kích thước/độ lệch tâm biến thiên nhẹ tất định (hàm của `i`, không dùng `Math.random`)
 * để tán trông gồ ghề tự nhiên hơn mà vẫn CÙNG hình dạng ở mọi lần dựng cùng tham số.
 * Đáy tán (vài puff lệch xuống dưới) sẫm màu hơn, đỉnh sáng màu hơn — mô phỏng bóng tự
 * đổ của tán lá dày.
 */
function buildCanopyPuffs(template: IcosahedronGeometry, center: Vector3, radius: number): InstancedMesh {
  const mesh = new InstancedMesh(template, material('#FFFFFF', 0.85), CANOPY_PUFFS);
  mesh.name = OCB_TREE_PUFF_NAME;
  mesh.castShadow = true;
  const dummy = new Object3D();
  const color = new Color();
  for (let i = 0; i < CANOPY_PUFFS; i++) {
    // Xoắn ốc Fibonacci trên nửa cầu trên, hơi phủ xuống dưới xích đạo (y ≥ -0.3) để
    // tán có độ dày thấy rõ từ dưới nhìn lên, không chỉ là một chỏm tròn phẳng đáy.
    const t = i / Math.max(1, CANOPY_PUFFS - 1);
    const y = 0.95 - 1.25 * t;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = i * GOLDEN_ANGLE;
    // Lệch tâm nhẹ (0.72..0.88) theo hàm tất định của `i` — bề mặt tán không tròn đều.
    const spread = 0.72 + 0.16 * Math.sin(i * 2.4);
    dummy.position.set(Math.cos(theta) * r * spread, y * 0.82, Math.sin(theta) * r * spread).multiplyScalar(radius).add(center);
    // Kích thước biến thiên 0.5..0.68 lần bán kính tán — tất định theo `i`.
    const puffScale = 0.5 + 0.18 * Math.abs(Math.sin(i * 1.7 + 0.5));
    dummy.scale.setScalar(radius * puffScale);
    dummy.rotation.set(i * 0.7, i * 1.3, i * 0.4);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    // Sẫm hơn ở đáy (y thấp), sáng hơn ở đỉnh (y cao) — bóng tự nhiên của khối lá dày.
    const shadeIndex = Math.round(((y + 0.3) / 1.25) * (LEAF_SHADES.length - 1));
    mesh.setColorAt(i, color.set(LEAF_SHADES[Math.max(0, Math.min(LEAF_SHADES.length - 1, shadeIndex))]));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

export function buildOcbTree(params: OcbTreeParams): Group {
  const milestone = clampInt(params.milestone, TREE_RENDER_MAX_MILESTONE);
  const branches = clampInt(params.branches, TREE_RENDER_MAX_BRANCHES);
  const ratio = validRatio(params.growthRatio);
  const dims = ocbTreeDimensions(milestone, ratio);
  const blooming = params.blooming === true;
  const joinYear = params.joinYear ?? null;

  const group = new Group();
  group.name = OCB_TREE_NAME;

  const trunkColor = params.trunkColor ?? DEFAULT_TRUNK_COLOR;
  const templates = createTemplates(trunkColor);
  const trunkMaterial = barkMaterial(trunkColor, 0.9);
  const leafMaterial = material(params.leafColor ?? DEFAULT_LEAF_COLOR, 0.7);

  // --- Thân ---
  const trunk = new Mesh(templates.trunk, trunkMaterial);
  trunk.name = OCB_TREE_TRUNK_NAME;
  trunk.scale.set(dims.trunkRadius, dims.trunkHeight, dims.trunkRadius);
  trunk.castShadow = true;
  group.add(trunk);

  // --- Tán chính ---
  const canopyCenter = new Vector3(0, dims.trunkHeight + dims.canopyRadius * 0.6, 0);
  const canopy = new Mesh(templates.canopy, leafMaterial);
  canopy.name = OCB_TREE_CANOPY_NAME;
  canopy.scale.setScalar(dims.canopyRadius);
  canopy.position.copy(canopyCenter);
  canopy.castShadow = true;
  group.add(canopy);

  // --- Chùm lá phồng + rễ + gò cỏ dưới gốc (dùng lại 3 mẫu hình học) ---
  group.add(buildCanopyPuffs(templates.canopy, canopyCenter, dims.canopyRadius));
  group.add(buildRoots(templates.branch, trunkMaterial, dims));
  const mound = new Mesh(templates.canopy, material(MOUND_COLOR, 1));
  mound.name = OCB_TREE_MOUND_NAME;
  mound.scale.set(dims.canopyRadius * 0.9, dims.trunkRadius * 0.6, dims.canopyRadius * 0.9);
  mound.receiveShadow = true;
  group.add(mound);

  // --- Nhánh + chùm lá đầu nhánh (nhân bản mẫu nhánh / mẫu tán) ---
  if (branches > 0) {
    const branchMesh = new InstancedMesh(templates.branch, trunkMaterial, branches);
    branchMesh.name = OCB_TREE_BRANCH_NAME;
    branchMesh.castShadow = true;
    const tuftMesh = new InstancedMesh(templates.canopy, leafMaterial, branches);
    tuftMesh.name = OCB_TREE_TUFT_NAME;
    tuftMesh.castShadow = true;

    const infos: OcbTreeBranchInfo[] = [];
    const matrix = new Matrix4();
    const rotation = new Quaternion();
    const identity = new Quaternion();
    const euler = new Euler();
    const base = new Vector3();
    const tip = new Vector3();
    const scale = new Vector3();
    const branchRadius = dims.trunkRadius * 0.6;
    const tuftRadius = dims.canopyRadius * 0.45;

    for (let i = 0; i < branches; i++) {
      const p = ocbTreeBranchPlacement(i);
      const length = dims.branchLength * p.lengthScale;
      // Nghiêng quanh Z (ngả về +X) rồi xoay quanh thân theo phương vị.
      euler.set(0, p.azimuth, -p.tilt, 'YZX');
      rotation.setFromEuler(euler);
      base.set(0, dims.trunkHeight * p.heightRatio, 0);
      scale.set(branchRadius, length, branchRadius);
      matrix.compose(base, rotation, scale);
      branchMesh.setMatrixAt(i, matrix);

      tip.set(0, length, 0).applyQuaternion(rotation).add(base);
      scale.setScalar(tuftRadius);
      matrix.compose(tip, identity, scale);
      tuftMesh.setMatrixAt(i, matrix);

      infos.push(ocbTreeBranchInfo(i, joinYear));
    }
    for (const mesh of [branchMesh, tuftMesh]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.userData['branches'] = infos;
      group.add(mesh);
    }
  }

  // --- Hoa + quả ngày kỷ niệm (US-7) ---
  if (blooming) {
    group.add(buildBloom(templates.canopy, canopyCenter, dims.canopyRadius, params.fruitCount));
  }

  group.userData['milestone'] = milestone;
  group.userData['branches'] = branches;
  group.userData['blooming'] = blooming;
  group.userData['dimensions'] = dims;
  return group;
}

/** Hoa và quả rải trên mặt tán theo xoắn ốc Fibonacci (tất định). */
function buildBloom(
  canopyGeometry: IcosahedronGeometry,
  center: Vector3,
  canopyRadius: number,
  fruitCount = DEFAULT_FRUIT_COUNT,
): InstancedMesh {
  const fruits = clampInt(fruitCount, 50);
  const total = fruits + BLOSSOMS_PER_TREE;
  // Dùng lại mẫu tán (scale nhỏ) — không thêm hình học mới; màu theo từng instance.
  const mesh = new InstancedMesh(canopyGeometry, material('#FFFFFF', 0.5), total);
  mesh.name = OCB_TREE_BLOOM_NAME;
  mesh.castShadow = true;
  const fruitColor = new Color(FRUIT_COLOR);
  const blossomColor = new Color(BLOSSOM_COLOR);
  const dummy = new Object3D();
  const kinds: ('fruit' | 'blossom')[] = [];

  for (let i = 0; i < total; i++) {
    // Chỉ rải trên nửa trên + vành tán (y từ 0.85 xuống -0.35) để luôn nhìn thấy.
    const y = 0.85 - (1.2 * (i + 0.5)) / total;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = i * GOLDEN_ANGLE;
    // Xen đều đúng `fruits` quả giữa các bông hoa.
    const isFruit = Math.floor(((i + 1) * fruits) / total) > Math.floor((i * fruits) / total);
    const size = canopyRadius * (isFruit ? 0.16 : 0.1);
    dummy.position.set(Math.cos(theta) * r, y, Math.sin(theta) * r).multiplyScalar(canopyRadius * 1.02).add(center);
    dummy.scale.setScalar(size);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, isFruit ? fruitColor : blossomColor);
    kinds.push(isFruit ? 'fruit' : 'blossom');
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.userData['kinds'] = kinds;
  return mesh;
}
