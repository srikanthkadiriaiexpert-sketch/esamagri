import { buildVoucherFilterClause } from './issue-vouchers.repository';

/**
 * The voucher search WHERE builder, without a database.
 *
 * WHY THIS EXISTS. `search()` and `count()` used to build the same predicates
 * separately, so a filter present in one and missing from the other would hand
 * the screen a page of rows beside a total that disagreed with it. They now
 * share one builder, and these tests pin the thing a database cannot check for
 * us while no test database exists: that each filter contributes exactly one
 * predicate, that the positional parameters are numbered in the order the
 * clause references them, and that the date bounds cast BOTH sides to ::date.
 *
 * That last one is not pedantry. `created_at` is timestamptz. Comparing it to a
 * bare '2026-11-10' would silently drop every voucher issued after midnight on
 * the closing day — an export that looks right and is quietly short.
 */

describe('buildVoucherFilterClause — no filters', () => {
  it('produces no WHERE clause at all, rather than a WHERE that matches everything', () => {
    const { clause, params } = buildVoucherFilterClause({});
    expect(clause).toBe('');
    expect(params).toEqual([]);
  });
});

describe('buildVoucherFilterClause — the free-text search', () => {
  it('wraps the term in wildcards and matches it against every searchable column', () => {
    const { clause, params } = buildVoucherFilterClause({ q: 'RIK-O-000123' });
    expect(params).toEqual(['%RIK-O-000123%']);
    expect(clause).toContain('v.voucher_number ILIKE $1');
    expect(clause).toContain('c.rik_id ILIKE $1');
    expect(clause).toContain('c.name ILIKE $1');
    expect(clause).toContain('c.official_name ILIKE $1');
    expect(clause).toContain('c.mobile_number ILIKE $1');
    expect(clause).toContain('s.reference_number ILIKE $1');
  });

  it('trims the term', () => {
    const { params } = buildVoucherFilterClause({ q: '   Kumar  ' });
    expect(params).toEqual(['%Kumar%']);
  });

  it('ignores a blank term instead of matching every row twice', () => {
    expect(buildVoucherFilterClause({ q: '   ' }).clause).toBe('');
  });
});

describe('buildVoucherFilterClause — the equality filters', () => {
  it('adds one predicate per supplied filter, numbered in order', () => {
    const { clause, params } = buildVoucherFilterClause({
      rationType: 'DRY',
      fulfillmentMode: 'PICKUP',
      status: 'COLLECTED',
      periodId: '11111111-1111-7111-8111-111111111111',
    });
    expect(params).toEqual([
      'DRY',
      'PICKUP',
      'COLLECTED',
      '11111111-1111-7111-8111-111111111111',
    ]);
    expect(clause).toContain('v.ration_type = $1');
    expect(clause).toContain('v.fulfillment_mode = $2');
    expect(clause).toContain('v.status = $3');
    expect(clause).toContain('v.period_id = $4');
  });

  it('omits a filter that was not supplied', () => {
    const { clause } = buildVoucherFilterClause({ status: 'DELIVERED' });
    expect(clause).toContain('v.status = $1');
    expect(clause).not.toContain('ration_type');
    expect(clause).not.toContain('fulfillment_mode');
    expect(clause).not.toContain('period_id');
  });
});

describe('buildVoucherFilterClause — the issued-date range', () => {
  it('casts both sides to ::date so the closing day is included whole', () => {
    const { clause, params } = buildVoucherFilterClause({
      issuedFrom: '2026-11-01',
      issuedTo: '2026-11-10',
    });
    expect(params).toEqual(['2026-11-01', '2026-11-10']);
    expect(clause).toContain('v.created_at::date >= $1::date');
    expect(clause).toContain('v.created_at::date <= $2::date');
  });

  it('accepts an open-ended lower bound', () => {
    const { clause, params } = buildVoucherFilterClause({ issuedFrom: '2026-11-01' });
    expect(params).toEqual(['2026-11-01']);
    expect(clause).toContain('>= $1::date');
    expect(clause).not.toContain('<=');
  });

  it('accepts an open-ended upper bound', () => {
    const { clause, params } = buildVoucherFilterClause({ issuedTo: '2026-11-10' });
    expect(params).toEqual(['2026-11-10']);
    expect(clause).toContain('<= $1::date');
    expect(clause).not.toContain('>=');
  });

  it('treats an empty string as no bound, so a cleared form field is not a filter', () => {
    expect(buildVoucherFilterClause({ issuedFrom: '', issuedTo: '' }).clause).toBe('');
  });

  it('passes an inverted range through as given — it simply matches nothing', () => {
    const { clause } = buildVoucherFilterClause({
      issuedFrom: '2026-11-10',
      issuedTo: '2026-11-01',
    });
    expect(clause).toContain('>= $1::date');
    expect(clause).toContain('<= $2::date');
  });
});

describe('buildVoucherFilterClause — everything at once', () => {
  it('numbers all six parameters in the order the clause references them', () => {
    const { clause, params } = buildVoucherFilterClause({
      q: 'Kumar',
      rationType: 'FRESH',
      status: 'READY_FOR_PICKUP',
      issuedFrom: '2026-11-01',
      issuedTo: '2026-11-10',
    });
    expect(params).toEqual([
      '%Kumar%',
      'FRESH',
      'READY_FOR_PICKUP',
      '2026-11-01',
      '2026-11-10',
    ]);
    // Every placeholder the clause mentions must exist in params, and vice
    // versa — an off-by-one here is a runtime "bind message supplies N
    // parameters" error that no typecheck would catch.
    const referenced = new Set(
      [...clause.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]))
    );
    expect([...referenced].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(params).toHaveLength(5);
  });

  it('joins the predicates with AND, never OR', () => {
    const { clause } = buildVoucherFilterClause({ rationType: 'DRY', status: 'COLLECTED' });
    expect(clause).toBe('WHERE v.ration_type = $1 AND v.status = $2');
  });
});

describe('buildVoucherFilterClause — the count-query constraint', () => {
  /**
   * `count()` joins only rik.issue_vouchers, rik.entitlement_selections and
   * shared.customers. `VOUCHER_SELECT` additionally joins the period, the
   * address and the issuing user. A predicate on one of those extra aliases
   * would work in search() and fail in count() with "missing FROM-clause
   * entry" — a 500 that only appears once someone uses that filter.
   */
  it('references only the aliases both queries join', () => {
    const { clause } = buildVoucherFilterClause({
      q: 'anything',
      rationType: 'DRY',
      fulfillmentMode: 'DELIVERY',
      status: 'DELIVERED',
      periodId: '11111111-1111-7111-8111-111111111111',
      issuedFrom: '2026-01-01',
      issuedTo: '2026-12-31',
    });
    const aliases = new Set([...clause.matchAll(/\b([a-z])\./g)].map((m) => m[1]));
    expect([...aliases].sort()).toEqual(['c', 's', 'v']);
  });
});
