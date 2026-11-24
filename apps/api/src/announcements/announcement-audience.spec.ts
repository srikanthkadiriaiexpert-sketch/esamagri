import { AnnouncementsService } from './announcements.service';
import type { AnnouncementAudience } from '../shared/repositories/announcements.repository';

/**
 * WHO SEES WHICH NOTICES.
 *
 * RIK announcements are operational — issue days, yard closures, entitlement
 * changes. A resident with no ration entitlement cannot act on any of them,
 * and showing them facility traffic that does not concern them is the thing
 * the approved decision rules out.
 *
 * The rule under test is the audience set, so the repository is a recorder:
 * it captures what it was asked for and returns nothing. That keeps the
 * assertions about the DECISION rather than about rows.
 */

function serviceRecording(): {
  service: AnnouncementsService;
  asked: () => AnnouncementAudience[];
} {
  let captured: AnnouncementAudience[] = [];
  const repo = {
    listActiveForAudiences: async (audiences: AnnouncementAudience[]) => {
      captured = audiences;
      return [];
    },
  };
  return {
    service: new AnnouncementsService(repo as never),
    asked: () => captured,
  };
}

async function audiencesAsked(
  filter: 'RIK' | 'PIF' | undefined,
  rikAuthorised: boolean
): Promise<AnnouncementAudience[]> {
  const { service, asked } = serviceRecording();
  await service.listForCustomer(filter, rikAuthorised);
  return asked();
}

describe('with no filter, the audience set follows RIK authorisation', () => {
  it('gives a RIK customer all three audiences', async () => {
    expect(await audiencesAsked(undefined, true)).toEqual(['ALL', 'RIK', 'PIF']);
  });

  it('gives a PIF-only resident the all-customer and PIF notices', async () => {
    expect(await audiencesAsked(undefined, false)).toEqual(['ALL', 'PIF']);
  });

  it('never asks for RIK notices on behalf of a PIF-only resident', async () => {
    expect(await audiencesAsked(undefined, false)).not.toContain('RIK');
  });
});

describe('ALL is included for everyone, always', () => {
  it('is present for both kinds of customer and every filter', async () => {
    for (const rik of [true, false]) {
      for (const filter of [undefined, 'RIK', 'PIF'] as const) {
        expect(await audiencesAsked(filter, rik)).toContain('ALL');
      }
    }
  });
});

describe('the filter can only narrow, never widen', () => {
  it('lets a RIK customer standing in the shop see PIF notices', async () => {
    expect(await audiencesAsked('PIF', true)).toEqual(['ALL', 'PIF']);
  });

  it('lets a RIK customer standing in RIK see RIK notices', async () => {
    expect(await audiencesAsked('RIK', true)).toEqual(['ALL', 'RIK']);
  });

  it('REFUSES to widen when a PIF-only resident asks for RIK notices', async () => {
    // The intersection, not the request. This is the one that matters: the
    // query parameter must not become a way to read the other module's
    // operational traffic.
    expect(await audiencesAsked('RIK', false)).toEqual(['ALL']);
  });

  it('lets a PIF-only resident ask for PIF notices', async () => {
    expect(await audiencesAsked('PIF', false)).toEqual(['ALL', 'PIF']);
  });
});
