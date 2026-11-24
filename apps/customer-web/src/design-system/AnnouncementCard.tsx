import type { Announcement, AnnouncementPriority } from '../lib/api/types';

export const PRIORITY_STYLES: Record<AnnouncementPriority, { badgeClass: string; barClass: string; icon: string }> = {
  URGENT: { badgeClass: 'bg-semantic-dangerLight text-semantic-danger', barClass: 'bg-semantic-danger', icon: '📣' },
  HIGH: { badgeClass: 'bg-brand-amberLight text-brand-amberDark', barClass: 'bg-brand-amber', icon: '📣' },
  NORMAL: { badgeClass: 'bg-brand-greenLight text-brand-greenDark', barClass: 'bg-brand-green', icon: '🗓' },
  LOW: { badgeClass: 'bg-brand-blueLight text-brand-blueDark', barClass: 'bg-brand-blue', icon: 'ℹ' },
};

export interface AnnouncementCardProps {
  announcement: Announcement;
  onDismiss?: (id: string) => void;
  onClick?: (announcement: Announcement) => void;
}

/**
 * The one place an announcement's publication date becomes words.
 *
 * Exported so the detail view prints the SAME date as the row the reader
 * tapped. Two formatters would eventually disagree, and a notice whose date
 * changes when you open it is a notice nobody trusts. Returns '' for a
 * missing or unparseable timestamp rather than the words "Invalid Date".
 */
export function announcementDateLabel(publishedAt: string): string {
  const date = new Date(publishedAt);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Reusable announcement row (STEP 8 Section 16) — title/message/priority/audience/date, optional dismissal. */
export function AnnouncementCard({ announcement, onDismiss, onClick }: AnnouncementCardProps) {
  const style = PRIORITY_STYLES[announcement.priority];
  const dateLabel = announcementDateLabel(announcement.publishedAt);

  return (
    <button
      type="button"
      onClick={() => onClick?.(announcement)}
      className="flex w-full items-start gap-3 border-b border-slate-100 py-3 text-left last:border-b-0"
    >
      <span className={['mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm', style.badgeClass].join(' ')} aria-hidden="true">
        {style.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-slate-900">{announcement.title}</span>
          {announcement.priority === 'URGENT' ? (
            <span className="shrink-0 rounded-full bg-semantic-danger px-2 py-0.5 text-[10px] font-bold text-white">URGENT</span>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-xs text-slate-500">{announcement.message}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-[11px] text-slate-400">{dateLabel}</span>
        {announcement.dismissible && onDismiss ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onDismiss(announcement.id);
            }}
            className="text-[11px] font-medium text-slate-400 hover:text-slate-600"
          >
            Dismiss
          </span>
        ) : (
          <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 text-slate-300" fill="none">
            <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
    </button>
  );
}
