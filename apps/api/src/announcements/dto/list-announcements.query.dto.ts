import { IsIn, IsOptional } from 'class-validator';

/**
 * The query string of `GET /announcements`.
 *
 * `audience` is the module the reader is currently in, and it is
 * OPTIONAL: the app's own home screen asks without one, because at that
 * point the reader has not chosen RIK or PIF yet.
 *
 * The accepted values are deliberately NOT the table's full audience
 * list. `ALL` is a property of an announcement, not a place a reader can
 * be standing — nobody is "in the ALL module" — and accepting it here
 * would create a second way to ask for the unfiltered list that reads
 * like a narrower one. So the filter is RIK or PIF, and `ALL`
 * announcements are added by the service for either.
 *
 * Anything else — a different module name, a lower-case 'rik', an empty
 * string — is rejected by the ValidationPipe as 400 before the handler
 * runs. That matters more than it looks: without it, an unrecognised
 * value would fall through to "no filter" and quietly show a PIF
 * customer the RIK notices.
 */
export const CUSTOMER_AUDIENCE_FILTERS = ['RIK', 'PIF'] as const;
export type CustomerAudienceFilter = (typeof CUSTOMER_AUDIENCE_FILTERS)[number];

export class ListAnnouncementsQueryDto {
  @IsOptional()
  @IsIn(CUSTOMER_AUDIENCE_FILTERS as readonly string[], {
    message: 'audience must be RIK or PIF.',
  })
  audience?: CustomerAudienceFilter;
}
