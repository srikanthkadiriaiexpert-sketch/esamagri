import { apiRequest } from './client';

/**
 * The officer's own Fresh and Dry eligible days (STEP 16 / migration 0066).
 *
 * READ ONLY. One function, one GET, no arithmetic — and deliberately a file of
 * its own rather than an addition to `rik-entitlement-api.ts`.
 *
 * WHY SEPARATE. These are the two figures RIK staff publish from the
 * facility's sheets, and SINCE THE FRESH/DRY CALCULATION CHANGE THEY ARE WHAT
 * EVERY QUANTITY IS CALCULATED FROM: a Fresh category is scaled by the Fresh
 * figure and a Dry category by the Dry figure. The route stays separate
 * because it answers a question of its own — what has the facility published
 * for me — and answers it even for an officer with no entitlement to show.
 *
 * (This comment previously said the opposite, and said the two numbers on the
 * screen might not match the quantities beside them. That was true while these
 * figures were stored and displayed only. It is not true now: the figures and
 * the quantities come from the same two numbers, and they agree.)
 *
 * Still no arithmetic in this file. Every quantity comes from the engine.
 *
 * `null` MEANS NOT PUBLISHED. A figure the facility has not uploaded yet
 * arrives as `null`, never as 0. "No sheet has arrived" and "the sheet says
 * nought days" are different statements and the screen must not show one when
 * the other is true.
 *
 * Officers cannot write these values. There is no write path to eligibility
 * anywhere in the customer app and this adds none.
 */

export interface EligibilityDays {
  period: {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
  };
  /** null until the facility has published a fresh eligibility sheet. */
  freshEligibleDays: number | null;
  /** null until the facility has published a dry eligibility sheet. */
  dryEligibleDays: number | null;
}

export function fetchEligibilityDays(signal?: AbortSignal): Promise<EligibilityDays> {
  return apiRequest<EligibilityDays>('/rik/eligibility-days', { signal });
}

/** How a figure reads on screen. Not published is said in words, never as 0. */
export function eligibleDaysLabel(days: number | null): string {
  if (days === null) return 'Not yet published';
  return `${days} day${days === 1 ? '' : 's'}`;
}

/**
 * The ration types the facility has published no figure for.
 *
 * WHY AN OFFICER NEEDS TO BE TOLD. A ration type with no published figure has
 * no entitlement to calculate, so that whole half of the officer's ration
 * simply does not appear on Know Your Ration. Without a word of explanation
 * the screen looks broken, or worse, looks as though the entitlement were
 * nil. This is the list the warning is built from.
 *
 * A PUBLISHED ZERO IS NOT IN THIS LIST. Zero days is a figure the facility
 * published and the officer is shown it as "0 days". This is about figures
 * that do not exist.
 */
export function missingEligibilityRationTypes(
  days: Pick<EligibilityDays, 'freshEligibleDays' | 'dryEligibleDays'>
): Array<'Fresh' | 'Dry'> {
  const missing: Array<'Fresh' | 'Dry'> = [];
  if (days.freshEligibleDays === null) missing.push('Fresh');
  if (days.dryEligibleDays === null) missing.push('Dry');
  return missing;
}
