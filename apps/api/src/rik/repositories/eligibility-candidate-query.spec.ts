import { EligibilityImportRepository } from './eligibility-import.repository';
import type { DatabaseService } from '../../database/database.service';

/**
 * Who an eligibility sheet is allowed to match, without a database.
 *
 * WHY THIS EXISTS. `findCandidatesByMobile` is the only query that decides
 * which people a facility spreadsheet can reach. Until migration 0065,
 * `shared.customers.rik_id` was NOT NULL, so every customer row was an officer
 * row and a query over customers WAS a query over officers. Migration 0065
 * made the column nullable so a PIF-only resident could exist — and silently
 * widened this query to include residents who hold no RIK ID.
 *
 * The consequence is not cosmetic. A matched row with a NULL `matched_rik_id`
 * violates `rik_elig_rows_matched_chk`, so the ENTIRE upload would fail with a
 * raw database check violation rather than reporting one clean exception row.
 * And without that constraint, a spreadsheet would have been able to grant RIK
 * eligibility to somebody the facility never approved for rations, by nothing
 * more than their mobile number appearing in a file.
 *
 * WHY IT TESTS THE SQL TEXT. There is no test database available, so the only
 * way to pin a predicate is to capture the statement the repository builds. A
 * string assertion is a blunt instrument, but the thing being guarded here is
 * exactly one clause in exactly one query, and its removal is precisely the
 * regression that would go unnoticed: the code would still compile, every
 * existing test would still pass, and the fault would surface only as a failed
 * upload in front of a staff member.
 *
 * These tests do not and cannot prove the query returns the right rows. They
 * prove the predicate is present, that it sits alongside the soft-delete
 * predicate rather than replacing it, and that the three stored mobile forms
 * are still matched explicitly.
 */

/** Captures the SQL and parameters the repository would send. */
function capturingRepository() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db = {
    query: (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return Promise.resolve([]);
    },
  } as unknown as DatabaseService;
  return { repo: new EligibilityImportRepository(db), calls };
}

/** Whitespace collapsed, so a reformat of the SQL does not fail these tests. */
function flat(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('findCandidatesByMobile — only RIK officers are candidates', () => {
  it('excludes customers who hold no RIK ID', async () => {
    const { repo, calls } = capturingRepository();
    await repo.findCandidatesByMobile(['9876543210']);

    // THE REGRESSION GUARD. Delete this predicate from the query and this
    // single assertion is what fails.
    expect(flat(calls[0]!.sql)).toContain('c.rik_id IS NOT NULL');
  });

  it('still excludes soft-deleted rows — the new predicate is additional, not a replacement', async () => {
    const { repo, calls } = capturingRepository();
    await repo.findCandidatesByMobile(['9876543210']);

    const sql = flat(calls[0]!.sql);
    expect(sql).toContain('c.deleted_at IS NULL');
    expect(sql).toContain('c.rik_id IS NOT NULL');
    // Both are AND-ed. An OR here would let either kind of row through.
    expect(sql).toContain('c.deleted_at IS NULL AND c.rik_id IS NOT NULL');
  });

  it('reads from shared.customers and nothing else', async () => {
    const { repo, calls } = capturingRepository();
    await repo.findCandidatesByMobile(['9876543210']);

    const sql = flat(calls[0]!.sql);
    expect(sql).toContain('FROM shared.customers c');
    // An import must never reach the eligibility ledger or the officer
    // registration path through this query.
    expect(sql).not.toContain('rik.customer_period_eligibility');
    expect(sql).not.toContain('INSERT');
    expect(sql).not.toContain('UPDATE');
  });
});

describe('findCandidatesByMobile — the three stored mobile forms', () => {
  it('matches the plain, +91 and 91 forms as three explicit arrays', async () => {
    const { repo, calls } = capturingRepository();
    await repo.findCandidatesByMobile(['9876543210', '9811122233']);

    const { sql, params } = calls[0]!;
    expect(flat(sql)).toContain('c.mobile_number = ANY($1::text[])');
    expect(flat(sql)).toContain('c.mobile_number = ANY($2::text[])');
    expect(flat(sql)).toContain('c.mobile_number = ANY($3::text[])');

    expect(params[0]).toEqual(['9876543210', '9811122233']);
    expect(params[1]).toEqual(['+919876543210', '+919811122233']);
    expect(params[2]).toEqual(['919876543210', '919811122233']);
  });

  it('does not strip a prefix in SQL — 9150150010 must stay whole', async () => {
    const { repo, calls } = capturingRepository();
    // A perfectly ordinary number that BEGINS 91. An earlier draft of this
    // query used regexp_replace to strip '^\+?91', which turned this into
    // 50150010 and matched nobody.
    await repo.findCandidatesByMobile(['9150150010']);

    const { sql, params } = calls[0]!;
    expect(sql).not.toContain('regexp_replace');
    expect(params[0]).toEqual(['9150150010']);
  });

  it('issues no query at all for an empty sheet', async () => {
    const { repo, calls } = capturingRepository();
    const result = await repo.findCandidatesByMobile([]);

    expect(result).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
