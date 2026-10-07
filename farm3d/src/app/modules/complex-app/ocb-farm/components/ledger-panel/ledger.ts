import type { FarmLedgerEntry, FarmLedgerKind } from '../../models/ocb-farm.model';

/**
 * OCB Farm — hàm thuần cho bảng lịch sử thu chi (task 13.3, US-21).
 * Tách khỏi component để kiểm thử độc lập, không phụ thuộc Angular.
 */

/** Khoá `farm_config` (tuỳ chọn) cho số dòng mỗi trang; chưa có thì dùng mặc định. */
export const LEDGER_PAGE_SIZE_CONFIG_KEY = 'ledger_page_size';
/** Mặc định trùng `LEDGER_DEFAULT_PAGE_SIZE` ở backend. */
export const LEDGER_DEFAULT_PAGE_SIZE = 20;
/** Trùng `LEDGER_MAX_PAGE_SIZE` ở backend — server chặn trên ở giá trị này. */
export const LEDGER_MAX_PAGE_SIZE = 100;
/** Số giao dịch gần nhất tối thiểu phải xem được (US-21). */
export const LEDGER_MIN_RECENT = 50;

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export const LEDGER_KIND_LABELS: Record<FarmLedgerKind, string> = {
  buy_animal: 'Mua vật nuôi',
  sell_animal: 'Bán vật nuôi',
  feed_animal: 'Cho vật nuôi ăn',
  buy_seed: 'Mua hạt giống',
  sell_product: 'Bán sản phẩm',
  buy_decor: 'Mua vật phẩm trang trí',
  buy_boost: 'Mua vật phẩm hỗ trợ',
  sell_decor: 'Bán vật phẩm trang trí',
  expand_plot: 'Mở rộng nông trại',
  checkin: 'Thưởng check-in',
  streak_bonus: 'Thưởng chuỗi check-in',
  anniversary: 'Quả kỷ niệm Cây OCB',
  help_reward: 'Thưởng giúp đồng nghiệp',
  help_received: 'Được đồng nghiệp giúp',
  achievement_reward: 'Thưởng thành tựu',
  admin_adjust: 'Quản trị viên điều chỉnh',
  admin_reset: 'Quản trị viên đặt lại',
};

export type LedgerDirection = 'in' | 'out' | 'zero';

/** Một dòng đã chuẩn bị sẵn để hiển thị. */
export interface LedgerRowView {
  id: number;
  timeLabel: string;
  isoTime: string;
  title: string;
  note: string | null;
  direction: LedgerDirection;
  sign: '+' | '−' | '';
  amountAbs: number;
  amountLabel: string;
  balanceAfter: number;
  balanceLabel: string;
}

/** Số nguyên định dạng kiểu Việt Nam (dấu chấm phân cách nghìn). */
export function formatSeeds(value: number): string {
  return Math.round(value).toLocaleString('vi-VN');
}

/** Số dòng mỗi trang theo cấu hình: số nguyên trong [1, 100], sai thì dùng mặc định. */
export function resolveLedgerPageSize(configured: number | undefined | null): number {
  if (configured === undefined || configured === null || !Number.isFinite(configured)) {
    return LEDGER_DEFAULT_PAGE_SIZE;
  }
  const n = Math.floor(configured);
  if (n < 1) return LEDGER_DEFAULT_PAGE_SIZE;
  return Math.min(n, LEDGER_MAX_PAGE_SIZE);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** `dd/MM/yyyy HH:mm` theo giờ Việt Nam (UTC+7); chuỗi không hợp lệ → giữ nguyên. */
export function formatLedgerTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const d = new Date(ms + VN_OFFSET_MS);
  return (
    `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
  );
}

export function ledgerDirection(amount: number): LedgerDirection {
  if (amount > 0) return 'in';
  if (amount < 0) return 'out';
  return 'zero';
}

export function toLedgerRow(entry: FarmLedgerEntry): LedgerRowView {
  const direction = ledgerDirection(entry.amount);
  const title = LEDGER_KIND_LABELS[entry.kind] ?? entry.kind;
  const note = entry.note?.trim() || null;
  const amountAbs = Math.abs(entry.amount);
  const balanceAfter = Math.max(0, entry.balance_after);
  return {
    id: entry.id,
    timeLabel: formatLedgerTime(entry.occurred_at),
    isoTime: entry.occurred_at,
    title,
    note: note && note !== title ? note : null,
    direction,
    sign: direction === 'in' ? '+' : direction === 'out' ? '−' : '',
    amountAbs,
    amountLabel: formatSeeds(amountAbs),
    balanceAfter,
    balanceLabel: formatSeeds(balanceAfter),
  };
}

export function totalLedgerPages(total: number, pageSize: number): number {
  if (total <= 0 || pageSize <= 0) return 1;
  return Math.ceil(total / pageSize);
}

/**
 * Danh sách nút trang rút gọn: luôn có trang đầu/cuối, các trang quanh trang hiện tại,
 * `null` là dấu "…". Ví dụ (5, 10) → [1, null, 4, 5, 6, null, 10].
 */
export function ledgerPageItems(current: number, totalPages: number, radius = 1): (number | null)[] {
  const pages = Math.max(1, totalPages);
  const cur = Math.min(Math.max(1, current), pages);
  const items: (number | null)[] = [];
  let prev = 0;
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - cur) <= radius) {
      if (prev && p - prev > 1) items.push(null);
      items.push(p);
      prev = p;
    }
  }
  return items;
}
