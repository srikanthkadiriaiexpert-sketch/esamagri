import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import type { ApiEnv } from '@esamagri/config';
import { SafeDatabaseError } from './database.errors';
import { EXPECTED_SCHEMA_CONTRACT, verifySchemaContract, type SchemaContractResult } from './schema-contract';

export type IsolationLevel = 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';

export interface ReadinessResult {
  ready: boolean;
  latencyMs?: number;
  /** Fixed, generic reason only — never a raw driver error. */
  reason?: string;
}

/**
 * Owns the single `pg.Pool` for the whole application and every piece
 * of DB-access infrastructure built on top of it: safe queries,
 * explicit transactions (with isolation level + row locking left to
 * the caller's SQL — this layer does not hide that), startup/shutdown
 * lifecycle, readiness checking, and the one-time schema-contract
 * verification against the frozen Phase 2 migrations.
 *
 * This is deliberately schema-agnostic and knows nothing about
 * shared/rik/pif tables — that belongs to repositories built on top of
 * this service in SharedModule/RikModule/PifModule (STEP 6+).
 * DatabaseService only ever owns the connection, never the schema:
 * the 24 approved SQL migrations remain the sole source of truth, and
 * nothing here runs DDL, generates a schema, or auto-syncs one.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool!: Pool;
  private lastContractCheck: SchemaContractResult | null = null;

  constructor(@Inject(ConfigService) private readonly config: ConfigService<ApiEnv, true>) {}

  async onModuleInit(): Promise<void> {
    this.pool = new Pool({
      connectionString: this.config.get('DATABASE_URL', { infer: true }),
      ssl: this.config.get('DATABASE_SSL', { infer: true }) ? { rejectUnauthorized: true } : undefined,
      max: this.config.get('DATABASE_POOL_MAX', { infer: true }),
      min: this.config.get('DATABASE_POOL_MIN', { infer: true }),
      idleTimeoutMillis: this.config.get('DATABASE_IDLE_TIMEOUT_MS', { infer: true }),
      connectionTimeoutMillis: this.config.get('DATABASE_CONNECTION_TIMEOUT_MS', { infer: true }),
      // A per-session statement timeout, applied via `options` so it
      // takes effect for every connection the pool opens — a guard
      // against a runaway query holding a connection (and any row
      // locks it took) forever.
      options: `-c statement_timeout=${this.config.get('DATABASE_STATEMENT_TIMEOUT_MS', { infer: true })}`,
    });

    // A pool-level error (e.g. an idle client's connection drops) must
    // never crash the process outright, and must never log the
    // connection string — only pg's own error object, which does not
    // carry credentials (see database.errors.ts).
    this.pool.on('error', (err) => {
      this.logger.error('Unexpected error on idle database client', err.stack ?? String(err));
    });

    // Fail fast: prove the pool can actually reach PostgreSQL before
    // the rest of the app is considered started. This is the same
    // "refuse to start half-configured" discipline as env validation.
    const start = Date.now();
    try {
      await this.pool.query('SELECT 1');
    } catch (err) {
      this.logger.error('Database connection failed during startup', (err as Error).stack ?? String(err));
      throw new SafeDatabaseError('Database connection failed during startup.');
    }
    this.logger.log(`Database connection established (${Date.now() - start}ms)`);

    // Schema-contract gate: the approved Phase 2 database contract
    // (55 tables / 5 views after STEP 11's migration 0025) must match
    // exactly. A mismatch here means
    // the connected database is not the approved schema — the
    // application must refuse to serve traffic against it rather than
    // silently run against something unknown. This is a read-only
    // check (information_schema only); nothing is ever repaired
    // automatically.
    this.lastContractCheck = await verifySchemaContract(this.pool);
    if (!this.lastContractCheck.matches) {
      this.logger.error(
        `DATABASE_CONTRACT_MISMATCH — expected ${EXPECTED_SCHEMA_CONTRACT.totalTables} tables / ${EXPECTED_SCHEMA_CONTRACT.totalViews} views, ` +
          `found ${JSON.stringify(this.lastContractCheck.actual)}`
      );
      throw new SafeDatabaseError('DATABASE_CONTRACT_MISMATCH — connected schema does not match the approved contract.');
    }
    this.logger.log(
      `Schema contract verified: ${EXPECTED_SCHEMA_CONTRACT.totalTables} tables / ${EXPECTED_SCHEMA_CONTRACT.totalViews} views (matches approved Phase 2 contract)`
    );
  }

  async onModuleDestroy(): Promise<void> {
    // Graceful shutdown: let in-flight queries finish, close every
    // pooled connection, then return. Nest calls this on SIGTERM/
    // SIGINT when shutdown hooks are enabled, and always on app.close()
    // in tests — see main.ts / app.e2e.spec.ts.
    await this.pool.end();
    this.logger.log('Database pool closed');
  }

  /** The last schema-contract verification performed (from startup). */
  getLastContractCheck(): SchemaContractResult | null {
    return this.lastContractCheck;
  }

  /**
   * A safe, parameterized query against the pool. Always use
   * parameterized placeholders ($1, $2, ...) — never string-concatenate
   * user input into `text`. Errors are logged in full server-side and
   * re-thrown as a SafeDatabaseError with no SQL, no driver detail, no
   * connection info.
   */
  async query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<T[]> {
    try {
      const result = await this.pool.query<T>(text, params);
      return result.rows;
    } catch (err) {
      this.logQueryError('query', err);
      throw new SafeDatabaseError('A database error occurred while processing the request.');
    }
  }

  /**
   * Runs `fn` inside an explicit transaction on a single dedicated
   * client: BEGIN [ISOLATION LEVEL ...] → fn(client) → COMMIT, or
   * ROLLBACK on any error — the client is always released back to the
   * pool in a `finally`, so a thrown error never leaks a connection.
   *
   * Row-level locking (`SELECT ... FOR UPDATE`), savepoints, and
   * anything else transaction-shaped is the caller's own SQL against
   * the provided `client` — this method only owns the
   * begin/commit/rollback/release lifecycle and the isolation level,
   * deliberately not a query-builder abstraction on top of it. This is
   * foundation infrastructure only: no business logic (RIK entitlement,
   * PIF inventory, etc.) is implemented here or anywhere yet — those
   * later engines will call this method, not reimplement it.
   */
  async withTransaction<T>(
    fn: (client: PoolClient) => Promise<T>,
    isolationLevel: IsolationLevel = 'READ COMMITTED'
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${isolationLevel}`);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        this.logQueryError('rollback', rollbackErr);
      }
      if (err instanceof SafeDatabaseError) {
        throw err;
      }
      this.logQueryError('transaction', err);
      throw new SafeDatabaseError('A database error occurred while processing the request.');
    } finally {
      client.release();
    }
  }

  /**
   * Distinguishes APPLICATION ALIVE (the process is up — always true
   * once you can call this method) from DATABASE READY (a real,
   * bounded-latency round trip to PostgreSQL just succeeded). Never
   * throws; never returns driver detail, SQL, or connection info —
   * only a boolean, a latency, and (on failure) one fixed, generic
   * reason string. Full diagnostic detail goes to the server log only.
   */
  async checkReadiness(): Promise<ReadinessResult> {
    const start = Date.now();
    try {
      await this.pool.query('SELECT 1');
      return { ready: true, latencyMs: Date.now() - start };
    } catch (err) {
      this.logQueryError('readiness check', err);
      return { ready: false, reason: 'database unreachable' };
    }
  }

  private logQueryError(context: string, err: unknown): void {
    // Logs the real error server-side (pg's own error objects do not
    // carry the connection string or password — see database.errors.ts
    // for why this is safe) but never returns it to a caller.
    const error = err as Error & { code?: string };
    this.logger.error(`Database ${context} failed: ${error.message ?? String(err)}`, error.stack);
  }
}
