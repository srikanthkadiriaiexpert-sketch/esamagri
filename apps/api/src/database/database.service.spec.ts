import { ConfigService } from '@nestjs/config';
import type { ApiEnv } from '@esamagri/config';
import { DatabaseService } from './database.service';
import { SafeDatabaseError } from './database.errors';

/**
 * Unit tests — the `pg` module is fully mocked, so nothing here talks
 * to a real database. This exercises DatabaseService's own logic:
 * error sanitization, the transaction begin/commit/rollback/release
 * sequence, and readiness's safe failure shape. The real-Postgres
 * version of "does this actually work" lives in
 * database.integration.spec.ts.
 */

const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};

const mockPool = {
  query: jest.fn(),
  connect: jest.fn(async () => mockClient),
  on: jest.fn(),
  end: jest.fn(async () => undefined),
};

jest.mock('pg', () => ({
  Pool: jest.fn(() => mockPool),
}));

function fakeConfig(overrides: Record<string, unknown> = {}): ConfigService<ApiEnv, true> {
  const values: Record<string, unknown> = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    DATABASE_SSL: false,
    DATABASE_POOL_MAX: 10,
    DATABASE_POOL_MIN: 0,
    DATABASE_IDLE_TIMEOUT_MS: 30_000,
    DATABASE_CONNECTION_TIMEOUT_MS: 5_000,
    DATABASE_STATEMENT_TIMEOUT_MS: 30_000,
    ...overrides,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService<ApiEnv, true>;
}

describe('DatabaseService (unit, mocked pg)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPool.query.mockResolvedValue({ rows: [] });
  });

  async function initServiceForSchemaMatch(): Promise<DatabaseService> {
    const service = new DatabaseService(fakeConfig());
    // onModuleInit: SELECT 1 succeeds, then verifySchemaContract's two
    // queries (tables, then views) — return exactly the approved shape.
    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // SELECT 1
      .mockResolvedValueOnce({
        rows: [
          { table_schema: 'shared', count: '14' },
          { table_schema: 'rik', count: '33' },
          { table_schema: 'pif', count: '23' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { view_name: 'rik.v_entitlement_balance' },
          { view_name: 'rik.v_entitlement_consumption_by_product' },
          { view_name: 'rik.v_issue_schedule' },
          { view_name: 'shared.v_active_announcements' },
          { view_name: 'shared.v_customer_profile' },
        ],
      });
    await service.onModuleInit();
    return service;
  }

  it('never throws the connection string on a startup connection failure', async () => {
    const service = new DatabaseService(fakeConfig());
    mockPool.query.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:5432'));

    await expect(service.onModuleInit()).rejects.toThrow(SafeDatabaseError);
    try {
      await service.onModuleInit();
    } catch (err) {
      const safe = err as SafeDatabaseError;
      expect(safe.safeMessage).not.toMatch(/user:pass/);
      expect(safe.safeMessage).not.toMatch(/postgresql:\/\//);
    }
  });

  it('fails startup with a SafeDatabaseError when the schema contract does not match (DATABASE_CONTRACT_MISMATCH)', async () => {
    const service = new DatabaseService(fakeConfig());
    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // SELECT 1 OK
      .mockResolvedValueOnce({ rows: [{ table_schema: 'shared', count: '14' }] }) // missing rik/pif
      .mockResolvedValueOnce({ rows: [] });

    await expect(service.onModuleInit()).rejects.toThrow(/DATABASE_CONTRACT_MISMATCH/);
  });

  it('completes startup and caches a matching contract check', async () => {
    const service = await initServiceForSchemaMatch();
    expect(service.getLastContractCheck()?.matches).toBe(true);
  });

  it('query() wraps a driver error into a SafeDatabaseError with a fixed, generic message', async () => {
    const service = await initServiceForSchemaMatch();
    mockPool.query.mockRejectedValueOnce(
      Object.assign(new Error('relation "shared.nonexistent" does not exist'), { code: '42P01' })
    );

    await expect(service.query('SELECT * FROM shared.nonexistent')).rejects.toThrow(SafeDatabaseError);
    try {
      await service.query('SELECT * FROM shared.nonexistent');
    } catch (err) {
      const safe = err as SafeDatabaseError;
      expect(safe.safeMessage).not.toContain('nonexistent');
      expect(safe.safeMessage).not.toContain('SELECT');
    }
  });

  it('withTransaction: BEGINs, runs fn, COMMITs, and releases the client on success', async () => {
    const service = await initServiceForSchemaMatch();
    mockClient.query.mockResolvedValue({ rows: [] });

    const result = await service.withTransaction(async (client) => {
      await client.query('INSERT INTO x VALUES (1)');
      return 'ok';
    });

    expect(result).toBe('ok');
    const calls = mockClient.query.mock.calls.map((c) => String(c[0]));
    expect(calls[0]).toMatch(/^BEGIN ISOLATION LEVEL READ COMMITTED/);
    expect(calls[calls.length - 1]).toBe('COMMIT');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('withTransaction: ROLLBACKs and still releases the client when fn throws', async () => {
    const service = await initServiceForSchemaMatch();
    mockClient.query.mockResolvedValue({ rows: [] });

    await expect(
      service.withTransaction(async () => {
        throw new Error('business rule violated');
      })
    ).rejects.toThrow(SafeDatabaseError);

    const calls = mockClient.query.mock.calls.map((c) => String(c[0]));
    expect(calls).toContain('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('withTransaction: releases the client even if ROLLBACK itself fails', async () => {
    const service = await initServiceForSchemaMatch();
    mockClient.query.mockImplementation(async (sql: string) => {
      if (sql === 'ROLLBACK') throw new Error('rollback failed');
      if (sql.startsWith('BEGIN')) return { rows: [] };
      throw new Error('original failure');
    });

    await expect(service.withTransaction(async (client) => client.query('INSERT'))).rejects.toThrow(
      SafeDatabaseError
    );
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('withTransaction: honors a requested isolation level', async () => {
    const service = await initServiceForSchemaMatch();
    mockClient.query.mockResolvedValue({ rows: [] });

    await service.withTransaction(async () => 'ok', 'SERIALIZABLE');

    const calls = mockClient.query.mock.calls.map((c) => String(c[0]));
    expect(calls[0]).toBe('BEGIN ISOLATION LEVEL SERIALIZABLE');
  });

  it('checkReadiness() returns {ready:false, reason:"database unreachable"} on failure — no driver detail leaked', async () => {
    const service = await initServiceForSchemaMatch();
    mockPool.query.mockRejectedValueOnce(new Error('connect ETIMEDOUT 10.0.0.5:5432'));

    const readiness = await service.checkReadiness();
    expect(readiness.ready).toBe(false);
    expect(readiness.reason).toBe('database unreachable');
    expect(JSON.stringify(readiness)).not.toContain('10.0.0.5');
  });

  it('checkReadiness() returns {ready:true, latencyMs} on success', async () => {
    const service = await initServiceForSchemaMatch();
    mockPool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

    const readiness = await service.checkReadiness();
    expect(readiness.ready).toBe(true);
    expect(typeof readiness.latencyMs).toBe('number');
  });

  it('onModuleDestroy() closes the pool', async () => {
    const service = await initServiceForSchemaMatch();
    await service.onModuleDestroy();
    expect(mockPool.end).toHaveBeenCalledTimes(1);
  });
});
