import type { FarmInboxGreeting, FarmInboxHelp, HelpActionType } from '../../models/ocb-farm.model';

/**
 * OCB Farm — hàm thuần cho hộp thư (người đã giúp + lời chúc) (task 14.2, US-8, US-27, US-48).
 * Tách khỏi component để kiểm thử độc lập, không phụ thuộc Angular.
 */

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export const HELP_ACTION_LABELS: Record<HelpActionType, string> = {
  water: 'Tưới cây giúp bạn',
  feed: 'Cho vật nuôi ăn giúp bạn',
};

export const HELP_ACTION_ICONS: Record<HelpActionType, string> = {
  water: 'bi bi-droplet-fill text-info',
  feed: 'bi bi-egg-fried text-warning',
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** `dd/MM/yyyy HH:mm` theo giờ Việt Nam (UTC+7); chuỗi không hợp lệ → giữ nguyên. */
export function formatInboxTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const d = new Date(ms + VN_OFFSET_MS);
  return (
    `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
  );
}

/** Một dòng "đã giúp tôi" đã dựng sẵn để hiển thị. */
export interface InboxHelpRowView {
  id: number;
  helperName: string;
  actionLabel: string;
  actionIcon: string;
  timeLabel: string;
  isoTime: string;
  isNew: boolean;
}

/** Một dòng lời chúc đã dựng sẵn để hiển thị. */
export interface InboxGreetingRowView {
  id: number;
  senderName: string;
  message: string;
  isEmoji: boolean;
  timeLabel: string;
  isoTime: string;
  isNew: boolean;
}

export function toInboxHelpRow(help: FarmInboxHelp): InboxHelpRowView {
  return {
    id: help.id,
    helperName: help.helper_name || 'Đồng nghiệp',
    actionLabel: HELP_ACTION_LABELS[help.action_type] ?? help.action_type,
    actionIcon: HELP_ACTION_ICONS[help.action_type] ?? 'bi bi-hand-thumbs-up',
    timeLabel: formatInboxTime(help.created_at),
    isoTime: help.created_at,
    isNew: help.is_new,
  };
}

export function toInboxGreetingRow(greeting: FarmInboxGreeting): InboxGreetingRowView {
  return {
    id: greeting.id,
    senderName: greeting.sender_name || 'Đồng nghiệp',
    message: greeting.message,
    isEmoji: greeting.kind === 'emoji',
    timeLabel: formatInboxTime(greeting.created_at),
    isoTime: greeting.created_at,
    isNew: greeting.is_new,
  };
}

/** Tổng số mục chưa xem trong cả hai danh sách — dùng để hiển thị badge "mới". */
export function countNewItems(helps: readonly FarmInboxHelp[], greetings: readonly FarmInboxGreeting[]): number {
  return helps.filter((h) => h.is_new).length + greetings.filter((g) => g.is_new).length;
}
