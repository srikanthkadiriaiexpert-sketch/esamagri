import 'reflect-metadata';
import { AnnouncementsService } from './announcements.service';
import type {
  ActiveAnnouncementRecord,
  AnnouncementAudience,
  AnnouncementsRepository,
} from '../shared/repositories/announcements.repository';

/**
 * Audience scoping and app-contract mapping, without a database.
 *
 * These are the two things this service actually decides. Whether an
 * announcement is published, in-date or soft-deleted is decided by
 * `shared.v_active_announcements` before a row reaches it, and is proved
 * against real PostgreSQL in announcements.integration.spec.ts — a fake
 * repository here could be made to "prove" an expiry rule that the
 * service does not implement, which would be worse than no test.
 *
 * What IS worth asserting without a database: that the audience list
 * handed to the repository is the right one. That list is the whole of
 * the isolation between RIK and PIF notices.
 *
 * ================================================================
 * THE AUDIENCE LIST NOW DEPENDS ON TWO THINGS, NOT ONE.
 * ================================================================
 *
 * `listForCustomer` takes the reader's module filter AND whether the
 * server has authorised them for RIK — read from
 * `shared.customers.rik_id`, never from the request. A PIF-only resident
 * is not shown RIK operational notices (issue days, yard closures,
 * entitlement changes) whatever filter they ask for.
 *
 * Every test below passes `rikAuthorised: true`, because every one of
 * them is about the FILTER: what a reader standing in RIK or in PIF is
 * handed, and how a row is mapped. Passing `true` keeps the permitted set
 * at its widest, so the filter is the only thing under test and a failure
 * here means the filter broke rather than the authorisation.
 *
 * THE PIF-ONLY MATRIX IS NOT REPEATED HERE. It lives in
 * `announcement-audience.spec.ts`, including the rule that matters most —
 * that a PIF-only resident asking for `RIK` gets `['ALL']` rather than
 * their request. Asserting it in two files would mean two places to
 * update and one of them going stale.
 */
describe('AnnouncementsService — audience scoping and mapping', () => {
  const row = (over: Partial<ActiveAnnouncementRecord> = {}): ActiveAnnouncementRecord => ({
    id: '0192f000-0000-7000-8000-000000000001',
    title: 'Yard closed Monday',
    body: 'The yard is closed for the public holiday.',
    announcement_type: 'HOLIDAY_CLOSURE',
    target_audience: 'ALL',
    priority: 'NORMAL',
    start_date: '2026-10-01',
    end_date: null,
    published_at: '2026-10-01T04:00:00.000Z',
    created_at: '2026-09-30T10:00:00.000Z',
    updated_at: '2026-09-30T10:00:00.000Z',
    ...over,
  });

  function make(rows: ActiveAnnouncementRecord[] = []) {
    const asked: AnnouncementAudience[][] = [];
    const repo = {
      listActiveForAudiences: jest.fn(async (audiences: readonly AnnouncementAudience[]) => {
        asked.push([...audiences]);
        return rows.filter((r) => audiences.includes(r.target_audience));
      }),
    } as unknown as AnnouncementsRepository;
    return { service: new AnnouncementsService(repo), asked };
  }

  it('asks for ALL and RIK — never PIF — when the reader is in RIK', async () => {
    const { service, asked } = make();
    await service.listForCustomer('RIK', true);
    expect(asked).toHaveLength(1);
    expect([...asked[0]!].sort()).toEqual(['ALL', 'RIK']);
    expect(asked[0]).not.toContain('PIF');
  });

  it('asks for ALL and PIF — never RIK — when the reader is in PIF', async () => {
    const { service, asked } = make();
    await service.listForCustomer('PIF', true);
    expect([...asked[0]!].sort()).toEqual(['ALL', 'PIF']);
    expect(asked[0]).not.toContain('RIK');
  });

  it('asks for every audience when no filter is given AND the reader has RIK', async () => {
    // The title names the RIK condition on purpose. Without it this reads
    // as a universal rule, and it is not one any more: the same call for a
    // PIF-only resident asks for ALL and PIF only.
    const { service, asked } = make();
    await service.listForCustomer(undefined, true);
    expect([...asked[0]!].sort()).toEqual(['ALL', 'PIF', 'RIK']);
  });

  it('includes an all-customer notice in BOTH modules', async () => {
    const closure = row({ target_audience: 'ALL', title: 'Yard closed Monday' });
    const rik = row({ id: 'r1', target_audience: 'RIK', title: 'RIK issue day moved' });
    const pif = row({ id: 'p1', target_audience: 'PIF', title: 'PIF counter timing' });

    const inRik = await make([closure, rik, pif]).service.listForCustomer('RIK', true);
    expect(inRik.map((a) => a.title)).toEqual(['Yard closed Monday', 'RIK issue day moved']);

    const inPif = await make([closure, rik, pif]).service.listForCustomer('PIF', true);
    expect(inPif.map((a) => a.title)).toEqual(['Yard closed Monday', 'PIF counter timing']);
  });

  it('maps the database row onto the field names the app expects', async () => {
    const { service } = make([row()]);
    const [a] = await service.listForCustomer(undefined, true);
    expect(a).toEqual({
      id: '0192f000-0000-7000-8000-000000000001',
      title: 'Yard closed Monday',
      message: 'The yard is closed for the public holiday.', // body -> message
      priority: 'NORMAL',
      audience: 'ALL', // target_audience -> audience
      publishedAt: '2026-10-01T04:00:00.000Z',
      dismissible: true,
    });
  });

  it('falls back to created_at when published_at is null, never to a null date', async () => {
    // `new Date(null)` is 1 January 1970, which the card would print.
    const { service } = make([row({ published_at: null })]);
    const [a] = await service.listForCustomer(undefined, true);
    expect(a!.publishedAt).toBe('2026-09-30T10:00:00.000Z');
  });

  it('returns dismissible: true for every priority, as approved', async () => {
    const rows = (['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const).map((p, i) =>
      row({ id: `p${i}`, priority: p })
    );
    const { service } = make(rows);
    const out = await service.listForCustomer(undefined, true);
    expect(out).toHaveLength(4);
    expect(out.every((a) => a.dismissible === true)).toBe(true);
  });

  it('preserves the order the view returned — it does not re-sort', async () => {
    // The view orders URGENT first; re-sorting here would silently
    // override a rule that lives in the database.
    const rows = [
      row({ id: 'u', priority: 'URGENT', title: 'Urgent' }),
      row({ id: 'n', priority: 'NORMAL', title: 'Normal' }),
      row({ id: 'l', priority: 'LOW', title: 'Low' }),
    ];
    const { service } = make(rows);
    const out = await service.listForCustomer(undefined, true);
    expect(out.map((a) => a.title)).toEqual(['Urgent', 'Normal', 'Low']);
  });

  it('returns an empty list, not an error, when nothing is live', async () => {
    const { service } = make([]);
    await expect(service.listForCustomer('PIF', true)).resolves.toEqual([]);
  });
});
