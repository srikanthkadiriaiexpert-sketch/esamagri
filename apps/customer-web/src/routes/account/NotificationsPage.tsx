import { useState } from 'react';
import { Header } from '../../design-system/Header';
import { AnnouncementCard } from '../../design-system/AnnouncementCard';
import { AnnouncementSheet } from '../../design-system/AnnouncementSheet';
import { EmptyState, ErrorState, LoadingState } from '../../design-system/StateViews';
import { useResource } from '../../lib/api/resource';
import { apiRequest } from '../../lib/api/client';
import type { Announcement } from '../../lib/api/types';

/**
 * Combined notifications/announcements feed (STEP 8 Section 15/16).
 * Real order-status push notifications (accepted, ready, delivered)
 * have nowhere to come from yet (no order engine — Section 23) so
 * this screen currently only surfaces announcements; the same
 * <AnnouncementCard>/toast surface is reused once order notifications
 * exist, per this component's own doc intent.
 *
 * TAPPING A NOTICE OPENS IT. The card has always been a full-width
 * <button>, but its `onClick` is optional and this screen never passed one,
 * so a tap did nothing and the truncated preview was as much as a customer
 * could ever read. The handler below is that missing wire: it puts the
 * tapped announcement into state, and <AnnouncementSheet> reads it.
 *
 * The announcement held in state is the SAME OBJECT the feed was given by
 * `GET /announcements`, which already carries the complete body. No second
 * request is made and no announcement is fetched by id, so the audience
 * rules the server applied to the list cannot be stepped around here: a
 * notice that was not in the list cannot be opened, because there is
 * nothing to open it with.
 */
export function NotificationsPage() {
  const announcements = useResource<Announcement[]>(() => apiRequest('/announcements'), undefined, []);

  /** The notice being read in full, or null when the feed is just a feed. */
  const [reading, setReading] = useState<Announcement | null>(null);

  return (
    <div className="app-shell min-h-screen bg-slate-50">
      <Header title="Notifications" showBack />
      <main className="p-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-3">
          {announcements.status === 'loading' ? <LoadingState /> : null}
          {announcements.status === 'error' ? <ErrorState /> : null}
          {announcements.status === 'not_implemented' ? <EmptyState title="No notifications yet" /> : null}
          {announcements.status === 'success' && announcements.data.length === 0 ? <EmptyState title="No notifications yet" /> : null}
          {announcements.status === 'success' && announcements.data.length > 0 ? (
            <>
              {announcements.data.map((a) => (
                <AnnouncementCard key={a.id} announcement={a} onClick={setReading} />
              ))}
            </>
          ) : null}
        </div>
      </main>

      {/*
        Rendered outside <main> deliberately: Sheet portals itself to
        document.body, and keeping the call here rather than inside the map
        means ONE panel for the whole feed instead of one per row.
      */}
      <AnnouncementSheet announcement={reading} onClose={() => setReading(null)} />
    </div>
  );
}
