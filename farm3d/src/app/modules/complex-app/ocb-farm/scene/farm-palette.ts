/**
 * OCB Farm — bảng màu nông trại (cảm hứng pixel-farm kiểu Stardew Valley: xanh cỏ tươi,
 * gỗ nâu ấm, đá xám ngà, nước xanh trong, trắng ngả kem).
 *
 * - `FARM_PALETTE`: màu dùng chung cho địa hình, Cây OCB, cảnh vật ngẫu nhiên.
 * - `stylizeMaterials`: chỉnh vật liệu của mô hình GLB vừa nạp — vật liệu có tên nhận ra
 *   được (Leaves, Wood, Stone_Dark…) đổi sang màu bảng; còn lại tăng độ tươi + ấm nhẹ.
 *   Bỏ ánh kim, tăng độ nhám để mọi mô hình cùng một "chất" vẽ tay.
 *
 * Chạy MỘT lần cho mỗi file (khi nạp), vật liệu dùng chung giữa các bản sao.
 */
import { Color, Material, MeshStandardMaterial } from 'three';

export const FARM_PALETTE = {
  grass: '#6DAA2C',
  grassAlt: '#7DB83A',
  grassDark: '#4F8A2A',
  grassLight: '#9BCB55',
  centerGrass: '#A6D46A',
  soil: '#9C6B3F',
  soilDark: '#6E4527',
  lockedGrass: '#B49A6A',
  water: '#4AB3E0',
  waterDeep: '#2E7FB8',
  pondBed: '#3F6E6A',
  wood: '#8A5A2B',
  woodDark: '#5C3A1E',
  bark: '#7A4B2A',
  leafDark: '#3E7A2B',
  leaf: '#5DA130',
  leafLight: '#8CC63F',
  leafHighlight: '#B5DE5C',
  stoneLight: '#C2B8A6',
  stoneDark: '#857C70',
  white: '#F4EEDF',
  black: '#3A2E2A',
  red: '#C8483A',
  orange: '#E8892F',
  yellow: '#F2C94C',
  pink: '#EE9AB5',
  purple: '#A27BC9',
  cyan: '#6CC4D9',
  berry: '#B03A5B',
} as const;

/** Vật liệu theo tên → màu bảng. Thứ tự quan trọng: mẫu cụ thể đứng trước mẫu chung. */
const NAMED: ReadonlyArray<readonly [RegExp, string]> = [
  [/^light$/i, FARM_PALETTE.yellow],
  [/dark.?green|leaves_dark/i, FARM_PALETTE.leafDark],
  [/pale.?green|green_light|light.?green/i, FARM_PALETTE.leafLight],
  [/leaf|leaves|foliage|lettuce|tree_green|^green$|plant|clover/i, FARM_PALETTE.leaf],
  [/watermelon/i, FARM_PALETTE.leafDark],
  [/dark.?brown|wood_dark|hooves/i, FARM_PALETTE.woodDark],
  [/bark|trunk|tree_wood/i, FARM_PALETTE.bark],
  [/wood|brown|bench|fence/i, FARM_PALETTE.wood],
  [/dirt|soil|mud/i, FARM_PALETTE.soil],
  [/stone_light|rock_light|path.?rocks/i, FARM_PALETTE.stoneLight],
  [/stone|rock|grey|gray|metal/i, FARM_PALETTE.stoneDark],
  [/roof|^red$|chicken_red/i, FARM_PALETTE.red],
  [/berry/i, FARM_PALETTE.berry],
  [/orange|beak|pumpkin/i, FARM_PALETTE.orange],
  [/yellow|gold/i, FARM_PALETTE.yellow],
  [/pink|muzzle/i, FARM_PALETTE.pink],
  [/cyan|blue/i, FARM_PALETTE.cyan],
  [/eye_black|^black$/i, FARM_PALETTE.black],
  [/eye_white|^white$|chicken_main|horns|wool/i, FARM_PALETTE.white],
];

/** Màu bảng theo tên vật liệu, `null` khi không nhận ra. */
export function paletteColorFor(name: string): string | null {
  if (!name) return null;
  for (const [re, color] of NAMED) if (re.test(name)) return color;
  return null;
}

const hsl = { h: 0, s: 0, l: 0 };

/**
 * Tăng độ tươi + ấm nhẹ cho màu không nhận ra tên: bão hoà ×1.25, nâng vùng tối để
 * không bị "đục", đẩy sắc độ một chút về phía vàng ấm.
 */
export function warmUp(color: Color): Color {
  color.getHSL(hsl);
  const warmHue = 0.11; // cam-vàng
  let dh = warmHue - hsl.h;
  if (dh > 0.5) dh -= 1;
  if (dh < -0.5) dh += 1;
  const h = (hsl.h + dh * 0.06 + 1) % 1;
  const s = Math.min(1, hsl.s * 1.25 + 0.04);
  const l = Math.min(0.92, hsl.l * 0.92 + 0.06);
  return color.setHSL(h, s, l);
}

const STYLED = '__farmStyled';

function stylize(material: Material): void {
  if (!(material instanceof MeshStandardMaterial)) return;
  if (material.userData[STYLED]) return;
  material.userData[STYLED] = true;
  material.metalness = 0;
  material.roughness = Math.max(0.85, material.roughness);
  if (material.map) {
    // Texture atlas: giữ ảnh, phủ một lớp ấm rất nhẹ.
    material.color.set('#FFF6E6');
  } else {
    const named = paletteColorFor(material.name);
    if (named) material.color.set(named);
    else warmUp(material.color);
  }
  // Vật liệu phát sáng (đèn) giữ nguyên emissive.
  material.needsUpdate = true;
}

export function stylizeMaterials(material: Material | Material[]): void {
  (Array.isArray(material) ? material : [material]).forEach(stylize);
}
