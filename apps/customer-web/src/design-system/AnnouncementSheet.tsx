import { Sheet } from './Sheet';
import { PRIORITY_STYLES, announcementDateLabel } from './AnnouncementCard';
import type { Announcement } from '../lib/api/types';

export interface AnnouncementSheetProps {
  /** The announcement being read, or null when nothing is open. */
  announcement: Announcement | null;
  onClose: () => void;
}

/**
 * ONE ANNOUNCEMENT, IN FULL.
 *
 * WHY THIS EXISTS. The notifications feed shows a one-line preview of each
 * notice — the message span carries Tailwind's `truncate`, so anything past
 * the first line is clipped with an ellipsis. That is the right thing for a
 * list. What was missing was anywhere to read the rest: the card has always
 * been a full-width <button>, but every screen rendered it without the
 * optional `onClick`, so the tap resolved to a no-op and the notice could
 * not be opened at all.
 *
 * NO NEW REQUEST, AND THAT IS THE POINT. `GET /announcements` already
 * returns each notice's COMPLETE body — the API maps the database's `body`
 * column straight onto `message`, and there is no separate detail endpoint
 * to call. So the full text the reader wants is already in memory when they
 * tap; this component renders the object the list was given and asks the
 * server for nothing.
 *
 * That is also what keeps the audience rules intact. Who may see which
 * notice is decided server-side, by migration 0022's active-announcements
 * view and the audience filter in AnnouncementsService. Because this view
 * can only display an announcement the list already received, it cannot
 * widen that decision: there is no id to look up and no second route to
 * reach past it.
 *
 * A SHEET RATHER THAN A DIALOG, and rather than a new route. Dialog's own
 * documentation says it is for short yes/no decisions and that "anything
 * longer or scrollable should use <Sheet> instead to stay mobile-first" — an
 * announcement is exactly that. Sheet brings the behaviour this needs
 * already built and already used elsewhere in the app: role="dialog" with
 * aria-modal, a labelled Close button, Escape to dismiss, the page behind it
 * locked against scrolling, and a body capped at 75dvh that scrolls inside
 * itself, so a long notice can be read to the end on a phone without the
 * panel running off under the browser toolbar.
 *
 * A dedicated route was the alternative. It was rejected because there is no
 * endpoint to fetch one announcement by id: a detail page would have to
 * re-request the whole list on every open and search it, or carry the object
 * in router state and break on refresh. Neither buys the reader anything a
 * sheet does not already give them.
 *
 * THE TEXT IS PRINTED AS THE WRITER TYPED IT. `whitespace-pre-line` keeps
 * the line and paragraph breaks an administrator put in the body, which a
 * plain <p> would collapse into one wall of text. There is no rich-text
 * support anywhere in the announcement pipeline — the column is plain text —
 * so honouring newlines is the whole of "existing formatting", and nothing
 * here interprets markup it was never given. `break-words` keeps a long
 * unbroken string (a URL, an order number) inside the panel instead of
 * pushing it sideways.
 */
export function AnnouncementSheet({ announcement, onClose }: AnnouncementSheetProps) {
  // Nothing selected means nothing rendered. Sheet would also return null on
  // `open={false}`, but returning early here keeps everything below free of
  // null checks and keeps the panel's mount tied to having something to show.
  if (announcement === null) return null;

  const style = PRIORITY_STYLES[announcement.priority];
  const dateLabel = announcementDateLabel(announcement.publishedAt);

  return (
    <Sheet open onClose={onClose} title={announcement.title}>
      <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
        <span
          className={['flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm', style.badgeClass].join(' ')}
          aria-hidden="true"
        >
          {style.icon}
        </span>
        {dateLabel ? <span className="text-xs text-slate-500">Published {dateLabel}</span> : null}
        {announcement.priority === 'URGENT' ? (
          <span className="ml-auto shrink-0 rounded-full bg-semantic-danger px-2 py-0.5 text-[10px] font-bold text-white">
            URGENT
          </span>
        ) : null}
      </div>

      {/*
        The complete body. No line clamp, no truncation, no "read more" — the
        reader opened this panel precisely to see all of it.
      */}
      <p className="whitespace-pre-line break-words pt-3 text-sm leading-relaxed text-slate-700">
        {announcement.message}
      </p>
    </Sheet>
  );
}
