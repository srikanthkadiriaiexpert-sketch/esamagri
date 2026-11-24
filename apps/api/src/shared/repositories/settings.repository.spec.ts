import { SettingsRepository } from './settings.repository';
import type { DatabaseService } from '../../database/database.service';

/**
 * The SQL this repository sends, with a faked DatabaseService. No database.
 *
 * WHAT IS WORTH ASSERTING WITHOUT POSTGRES, AND WHAT IS NOT. Whether the
 * statement returns the right rows is PostgreSQL's job and cannot be
 * proven here. What CAN be proven, and is worth proving, is the handful of
 * choices that are easy to get wrong and silent when wrong: that the key
 * is always parameterised rather than interpolated, that the upsert is an
 * ON CONFLICT on the primary key rather than a read-then-decide, that
 * `updated_at` is restated in the UPDATE branch, and that a missing row
 * comes back as null instead of undefined.
 *
 * The real round trip against `shared.settings` needs esamagri_test, which
 * is unavailable, and is listed as an outstanding dependency rather than
 * faked here.
 */

interface Harness {
  repo: SettingsRepository;
  query: jest.Mock;
  /** The SQL text of the nth call, whitespace-collapsed for matching. */
  sql: (n?: number) => string;
  params: (n?: number) => unknown[];
}

function harness(rows: unknown[] = []): Harness {
  const query = jest.fn().mockResolvedValue(rows);
  const db = { query } as unknown as DatabaseService;
  return {
    repo: new SettingsRepository(db),
    query,
    sql: (n = 0) => String(query.mock.calls[n]?.[0] ?? '').replace(/\s+/g, ' ').trim(),
    params: (n = 0) => (query.mock.calls[n]?.[1] ?? []) as unknown[],
  };
}

describe('SettingsRepository.findByKey', () => {
  it('parameterises the key — it is never interpolated into the SQL', async () => {
    const h = harness([]);
    await h.repo.findByKey("pif.self_registration_enabled'; DROP TABLE shared.settings; --");

    expect(h.sql()).toContain('WHERE key = $1');
    expect(h.sql()).not.toContain('DROP TABLE');
    expect(h.params()).toEqual(["pif.self_registration_enabled'; DROP TABLE shared.settings; --"]);
  });

  it('reads only the four columns the table has', async () => {
    const h = harness([]);
    await h.repo.findByKey('pif.self_registration_enabled');

    const sql = h.sql();
    expect(sql).toContain('SELECT key, value, updated_at, updated_by');
    expect(sql).toContain('FROM shared.settings');
  });

  it('RETURNS NULL, NOT UNDEFINED, when the key has no row', async () => {
    // This is what makes "absent means OFF" expressible: every caller
    // checks `=== null`, so an undefined would slip past that check.
    const h = harness([]);
    await expect(h.repo.findByKey('pif.self_registration_enabled')).resolves.toBeNull();
  });

  it('returns the row when one exists, with value left as raw jsonb', async () => {
    const row = {
      key: 'pif.self_registration_enabled',
      value: { value: true, status: 'SET', note: 'x' },
      updated_at: '2026-11-14T11:00:00.000Z',
      updated_by: '22222222-2222-7222-8222-222222222222',
    };
    const h = harness([row]);
    await expect(h.repo.findByKey('pif.self_registration_enabled')).resolves.toEqual(row);
  });
});

describe('SettingsRepository.findByKeyWithActor', () => {
  it('LEFT JOINs shared.users, so a row with no updated_by still comes back', async () => {
    // The two rows migration 0019 seeds have updated_by NULL. An inner
    // join would make them vanish from this read entirely.
    const h = harness([]);
    await h.repo.findByKeyWithActor('pif.self_registration_enabled');

    const sql = h.sql();
    expect(sql).toContain('LEFT JOIN shared.users u ON u.id = s.updated_by');
    expect(sql).not.toMatch(/(?<!LEFT )JOIN shared\.users/);
  });

  it('selects both the display name and the username, so the caller can fall back', async () => {
    const h = harness([]);
    await h.repo.findByKeyWithActor('pif.self_registration_enabled');

    expect(h.sql()).toContain('u.username');
    expect(h.sql()).toContain('u.display_name');
  });

  it('parameterises the key here too', async () => {
    const h = harness([]);
    await h.repo.findByKeyWithActor('pif.self_registration_enabled');
    expect(h.sql()).toContain('WHERE s.key = $1');
    expect(h.params()).toEqual(['pif.self_registration_enabled']);
  });

  it('returns null for an absent key', async () => {
    const h = harness([]);
    await expect(h.repo.findByKeyWithActor('nope')).resolves.toBeNull();
  });
});

describe('SettingsRepository.upsert', () => {
  const WRITTEN = {
    key: 'pif.self_registration_enabled',
    value: { value: true, status: 'SET', note: 'x' },
    updated_at: '2026-11-14T11:30:00.000Z',
    updated_by: '22222222-2222-7222-8222-222222222222',
  };

  it('is an ON CONFLICT upsert on the primary key, not a read-then-decide', async () => {
    const h = harness([WRITTEN]);
    await h.repo.upsert({ key: WRITTEN.key, value: WRITTEN.value, updatedBy: WRITTEN.updated_by });

    const sql = h.sql();
    expect(sql).toContain('INSERT INTO shared.settings');
    expect(sql).toContain('ON CONFLICT (key) DO UPDATE');
    // One statement, so two administrators pressing at once cannot both
    // insert and nothing needs a transaction here.
    expect(h.query).toHaveBeenCalledTimes(1);
  });

  it('RESTATES updated_at = now() IN THE UPDATE BRANCH', async () => {
    // The column DEFAULT only fires on INSERT. Without this, an update
    // would keep the original timestamp and the screen would report the
    // wrong "last changed" time — a wrong fact, quietly.
    const h = harness([WRITTEN]);
    await h.repo.upsert({ key: WRITTEN.key, value: WRITTEN.value, updatedBy: WRITTEN.updated_by });
    expect(h.sql()).toContain('updated_at = now()');
  });

  it('serialises the value once and casts it to jsonb', async () => {
    const h = harness([WRITTEN]);
    await h.repo.upsert({ key: WRITTEN.key, value: { value: false }, updatedBy: null });

    expect(h.sql()).toContain('$2::jsonb');
    expect(h.params()[1]).toBe('{"value":false}');
  });

  it('parameterises all three inputs, including the key', async () => {
    const h = harness([WRITTEN]);
    await h.repo.upsert({ key: WRITTEN.key, value: { value: true }, updatedBy: 'actor-id' });

    expect(h.params()).toEqual([WRITTEN.key, '{"value":true}', 'actor-id']);
  });

  it('accepts a null writer, which the seeded rows already have', async () => {
    const h = harness([{ ...WRITTEN, updated_by: null }]);
    await expect(
      h.repo.upsert({ key: WRITTEN.key, value: { value: false }, updatedBy: null })
    ).resolves.toMatchObject({ updated_by: null });
  });

  it('returns the row it wrote, so the caller never has to guess', async () => {
    const h = harness([WRITTEN]);
    await expect(
      h.repo.upsert({ key: WRITTEN.key, value: WRITTEN.value, updatedBy: WRITTEN.updated_by })
    ).resolves.toEqual(WRITTEN);
  });

  it('THROWS RATHER THAN FABRICATING A RECORD if the statement returns nothing', async () => {
    // Unreachable in practice. It matters anyway: returning an invented
    // record would report a silent write failure to an administrator as a
    // success, and a control over a public endpoint must not do that.
    const h = harness([]);
    await expect(
      h.repo.upsert({ key: WRITTEN.key, value: { value: true }, updatedBy: null })
    ).rejects.toThrow(/returned no row/);
  });
});
