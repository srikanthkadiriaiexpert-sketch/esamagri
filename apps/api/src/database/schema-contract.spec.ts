import { EXPECTED_SCHEMA_CONTRACT, verifySchemaContract } from './schema-contract';
import type { Pool } from 'pg';

/**
 * Pure unit test — no live database. A minimal fake `Pool` stands in
 * for pg, so this only exercises verifySchemaContract's own comparison
 * logic (matches / mismatch classification), not real connectivity.
 * The real, live-Postgres version of this check runs in
 * database.integration.spec.ts.
 */
function fakePool(tableRows: Array<{ table_schema: string; count: string }>, viewNames: string[]): Pool {
  let call = 0;
  return {
    query: async () => {
      call += 1;
      if (call === 1) {
        return { rows: tableRows };
      }
      return { rows: viewNames.map((v) => ({ view_name: v })) };
    },
  } as unknown as Pool;
}

describe('verifySchemaContract', () => {
  it('reports a match when table counts per schema and view count are exactly right', async () => {
    const pool = fakePool(
      [
        { table_schema: 'shared', count: '14' },
        { table_schema: 'rik', count: '34' },
        { table_schema: 'pif', count: '23' },
      ],
      ['rik.v_entitlement_balance', 'rik.v_entitlement_consumption_by_product', 'rik.v_issue_schedule', 'shared.v_active_announcements', 'shared.v_customer_profile']
    );
    const result = await verifySchemaContract(pool);
    expect(result.matches).toBe(true);
    expect(result.actual.totalTables).toBe(EXPECTED_SCHEMA_CONTRACT.totalTables);
    expect(result.actual.totalViews).toBe(EXPECTED_SCHEMA_CONTRACT.totalViews);
  });

  it('reports a mismatch (DATABASE_CONTRACT_MISMATCH condition) when a table is missing', async () => {
    const pool = fakePool(
      [
        { table_schema: 'shared', count: '14' },
        { table_schema: 'rik', count: '27' }, // one short
        { table_schema: 'pif', count: '23' },
      ],
      ['rik.v_entitlement_balance', 'rik.v_entitlement_consumption_by_product', 'rik.v_issue_schedule', 'shared.v_active_announcements', 'shared.v_customer_profile']
    );
    const result = await verifySchemaContract(pool);
    expect(result.matches).toBe(false);
    expect(result.actual.tablesBySchema.rik).toBe(27);
  });

  it('reports a mismatch when a view is missing', async () => {
    const pool = fakePool(
      [
        { table_schema: 'shared', count: '14' },
        { table_schema: 'rik', count: '34' },
        { table_schema: 'pif', count: '23' },
      ],
      ['rik.v_entitlement_balance'] // only 1 of 5
    );
    const result = await verifySchemaContract(pool);
    expect(result.matches).toBe(false);
    expect(result.actual.totalViews).toBe(1);
  });

  it('reports a mismatch when there are MORE tables than expected (drift, not just deficit)', async () => {
    const pool = fakePool(
      [
        { table_schema: 'shared', count: '14' },
        { table_schema: 'rik', count: '34' },
        { table_schema: 'pif', count: '22' }, // one extra
      ],
      ['rik.v_entitlement_balance', 'rik.v_entitlement_consumption_by_product', 'rik.v_issue_schedule', 'shared.v_active_announcements', 'shared.v_customer_profile']
    );
    const result = await verifySchemaContract(pool);
    expect(result.matches).toBe(false);
  });
});
