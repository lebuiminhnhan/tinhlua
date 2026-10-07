/**
 * OCB Farm — hàm hỗ trợ chụp ảnh nông trại (US-41).
 *
 * - `snapshotFileName`: tên tệp chứa tên nông trại (không dấu, an toàn cho hệ điều hành)
 *   và ngày chụp theo giờ Việt Nam (UTC+7).
 * - `snapshotCaption`: các dòng chữ chèn lên ảnh — tên nông trại, tên nhân viên, thâm niên
 *   tại thời điểm chụp; chế độ ghé thăm ghi rõ là nông trại của đồng nghiệp.
 * - `composeSnapshot`: vẽ khung hình + dải chú thích vào canvas 2D ngoài luồng.
 */
import { formatViDate, todayVnIso, type SeniorityYm, formatSeniority } from '../onboarding-wizard/join-date';

const MAX_SLUG_LENGTH = 48;

/** Bỏ dấu tiếng Việt, chỉ giữ a-z0-9 và gạch nối. Rỗng → `nong-trai`. */
export function slugifyFarmName(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
  return slug || 'nong-trai';
}

/** `ocb-farm-{tên-nông-trại}-{YYYY-MM-DD}.png` — ngày theo giờ Việt Nam. */
export function snapshotFileName(farmName: string, nowMs: number = Date.now()): string {
  return `ocb-farm-${slugifyFarmName(farmName)}-${todayVnIso(nowMs)}.png`;
}

export interface SnapshotCaptionInput {
  farmName: string;
  ownerName: string;
  /** `null` khi không biết thâm niên (ví dụ dữ liệu ghé thăm chưa có). */
  seniority: SeniorityYm | null;
  visiting: boolean;
  nowMs?: number;
}

export interface SnapshotCaption {
  /** Dòng nhãn nhỏ phía trên (chỉ có ở chế độ ghé thăm). */
  badge: string | null;
  title: string;
  subtitle: string;
  footer: string;
}

export function snapshotCaption(input: SnapshotCaptionInput): SnapshotCaption {
  const farmName = input.farmName.trim() || 'Nông trại OCB';
  const owner = input.ownerName.trim() || 'Nhân viên OCB';
  const seniority = input.seniority ? `Thâm niên: ${formatSeniority(input.seniority)}` : null;
  const ownerLine = input.visiting ? `Chủ nông trại: ${owner}` : owner;
  return {
    badge: input.visiting ? `Nông trại của đồng nghiệp ${owner}` : null,
    title: farmName,
    subtitle: seniority ? `${ownerLine} · ${seniority}` : ownerLine,
    footer: `OCB Farm · Chụp ngày ${formatViDate(todayVnIso(input.nowMs ?? Date.now()))}`,
  };
}

/** Tháng thâm niên → năm + tháng. */
export function seniorityFromMonths(totalMonths: number): SeniorityYm {
  const total = Math.max(0, Math.floor(totalMonths));
  return { years: Math.floor(total / 12), months: total % 12 };
}

/** Rút gọn chữ cho vừa `maxWidth` (thêm dấu "…"). */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0, -1);
  return s + '…';
}

const FONT_FAMILY = '"Source Sans 3", "Segoe UI", Roboto, Arial, sans-serif';

/** Vẽ khung hình + dải chú thích vào canvas 2D mới. Ném lỗi khi trình duyệt không hỗ trợ. */
export function composeSnapshot(frame: HTMLCanvasElement, caption: SnapshotCaption): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = frame.width;
  out.height = frame.height;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('Trình duyệt không hỗ trợ vẽ ảnh.');
  ctx.drawImage(frame, 0, 0);

  const w = out.width;
  const h = out.height;
  const unit = Math.max(12, Math.round(Math.min(w, h * 1.6) / 48));
  const pad = Math.round(unit * 1.1);
  const titleSize = Math.round(unit * 1.6);
  const subSize = Math.round(unit * 1);
  const footSize = Math.round(unit * 0.8);
  const bandH = pad * 2 + titleSize + subSize + footSize + Math.round(unit * 0.9);

  // Dải tối mờ phía dưới để chữ trắng đủ tương phản trên mọi nền trời.
  const grad = ctx.createLinearGradient(0, h - bandH, 0, h);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  grad.addColorStop(0.35, 'rgba(0, 0, 0, 0.55)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.75)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, h - bandH, w, bandH);

  const maxText = w - pad * 2;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = Math.round(unit / 3);

  let y = h - pad;
  ctx.font = `${footSize}px ${FONT_FAMILY}`;
  ctx.globalAlpha = 0.85;
  ctx.fillText(fitText(ctx, caption.footer, maxText), pad, y);
  ctx.globalAlpha = 1;
  y -= footSize + Math.round(unit * 0.5);
  ctx.font = `${subSize}px ${FONT_FAMILY}`;
  ctx.fillText(fitText(ctx, caption.subtitle, maxText), pad, y);
  y -= subSize + Math.round(unit * 0.4);
  ctx.font = `700 ${titleSize}px ${FONT_FAMILY}`;
  ctx.fillText(fitText(ctx, caption.title, maxText), pad, y);

  if (caption.badge) {
    // Nhãn "nông trại của đồng nghiệp" ở góc trên trái, nền màu thương hiệu.
    ctx.shadowBlur = 0;
    ctx.font = `600 ${subSize}px ${FONT_FAMILY}`;
    const text = fitText(ctx, caption.badge, maxText - pad);
    const bw = ctx.measureText(text).width + pad;
    const bh = subSize + Math.round(unit * 0.8);
    ctx.fillStyle = 'rgba(0, 120, 66, 0.92)';
    ctx.fillRect(pad, pad, bw, bh);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, pad + pad / 2, pad + bh / 2);
  }
  return out;
}

/** `canvas.toBlob` dạng Promise; ném lỗi khi trình duyệt không tạo được ảnh. */
export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Không tạo được tệp ảnh.'))), 'image/png');
    } catch (err: unknown) {
      reject(err instanceof Error ? err : new Error('Không tạo được tệp ảnh.'));
    }
  });
}

/** Tải `blob` xuống với tên `fileName`. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    a.remove();
    // Cho trình duyệt kịp bắt đầu tải rồi mới thu hồi URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
