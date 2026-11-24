import { useCallback, useState } from 'react';
import { useResource } from '../../lib/api/resource';
import { fetchHistory } from '../../lib/api/rik-config-api';
import { LoadingState, EmptyState, FailureState } from '../../design-system/States';
import { ConfigTable, FieldLabel, SecondaryButton, SelectInput, Td, Th } from '../../design-system/ConfigUI';

/**
 * Rule history — screen 7 of 7 (STEP 11C).
 *
 * What was changed, by whom, and when. Every entry comes from
 * shared.audit_log, which is append-only: a database trigger rejects
 * UPDATE and DELETE on that table outright, for every role. So this
 * screen shows a record that nobody — including whoever made the change
 * — can revise afterwards.
 *
 * No second history table was created for this. The audit log already
 * recorded administrative actions; STEP 11C writes RIK configuration
 * changes into it with the values before and after, and this screen
 * reads them back.
 *
 * What it does NOT show: a customer's entitlement or selection. This is
 * the history of the RULES, filtered to the four RIK configuration
 * tables and nothing else — the server refuses any other filter rather
 * than trusting the query string.
 */
const ENTITY_FILTERS = [
  { value: '', label: 'All RIK configuration' },
  { value: 'rik.entitlement_pools', label: 'Entitlement pools' },
  { value: 'rik.pool_scales', label: 'Daily scales' },
  { value: 'rik.pool_conversions', label: 'Conversions' },
  { value: 'rik.provisions', label: 'Provisions' },
] as const;

const ACTION_LABELS: Record<string, string> = {
  RIK_CONFIG_POOL_CREATED: 'Pool created',
  RIK_CONFIG_POOL_UPDATED: 'Pool changed',
  RIK_CONFIG_SCALE_CREATED: 'Daily scale created',
  RIK_CONFIG_SCALE_UPDATED: 'Daily scale changed',
  RIK_CONFIG_SCALE_SUPERSEDED: 'Daily scale superseded',
  RIK_CONFIG_CONVERSION_CREATED: 'Conversion created',
  RIK_CONFIG_CONVERSION_UPDATED: 'Conversion changed',
  RIK_CONFIG_PROVISION_CREATED: 'Provision created',
  RIK_CONFIG_PROVISION_UPDATED: 'Provision changed',
};

export function RuleHistoryPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [entityType, setEntityType] = useState<string>('');
  const history = useResource(() => fetchHistory({ entityType: entityType || null, limit: 200 }), [
    reloadKey,
    entityType,
  ]);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-slate-600">
        Every change to the RIK entitlement configuration, with the values before and after. These entries are written
        to the audit log, which the database refuses to let anyone edit or delete afterwards.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem]">
          <FieldLabel label="Show">
            <SelectInput value={entityType} onChange={(e) => setEntityType(e.target.value)}>
              {ENTITY_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </SelectInput>
          </FieldLabel>
        </div>
        <SecondaryButton onClick={reload}>Refresh</SecondaryButton>
      </div>

      {history.status === 'loading' ? <LoadingState label="Loading rule history…" /> : null}
      {history.status === 'error' ? <FailureState error={history.error} onRetry={reload} /> : null}
      {history.status === 'not_implemented' ? <EmptyState title="Rule history is not available yet." /> : null}

      {history.status === 'success' ? (
        history.data.items.length === 0 ? (
          <EmptyState
            title="No configuration changes recorded yet"
            description="Anything changed on the other six screens appears here, permanently."
          />
        ) : (
          <ConfigTable
            caption="RIK entitlement configuration change history"
            head={
              <>
                <Th>When</Th>
                <Th>What changed</Th>
                <Th>Who</Th>
                <Th>Before</Th>
                <Th>After</Th>
              </>
            }
          >
            {history.data.items.map((entry) => (
              <tr key={entry.id} className="border-b border-slate-100 align-top last:border-0">
                <Td numeric>{formatWhen(entry.createdAt)}</Td>
                <Td>
                  <p className="font-semibold text-slate-800">{ACTION_LABELS[entry.action] ?? entry.action}</p>
                  <p className="mt-0.5 font-mono text-xs text-slate-500">{entry.entityType}</p>
                </Td>
                <Td>
                  <p className="text-slate-800">{entry.actorName ?? 'Unknown'}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{entry.actorRole ?? '—'}</p>
                </Td>
                <Td>
                  <Values values={entry.before} empty="Created" />
                </Td>
                <Td>
                  <Values values={entry.after} changedFrom={entry.before} />
                </Td>
              </tr>
            ))}
          </ConfigTable>
        )
      ) : null}
    </div>
  );
}

/**
 * Renders a recorded payload. On the "after" side, a value that
 * actually changed is marked — the useful question in an audit list is
 * which field moved, not what the whole row happened to contain.
 */
function Values({
  values,
  changedFrom,
  empty,
}: {
  values: Record<string, unknown> | null;
  changedFrom?: Record<string, unknown> | null;
  empty?: string;
}) {
  if (values === null || values === undefined) {
    return <span className="text-xs text-slate-400">{empty ?? '—'}</span>;
  }
  const entries = Object.entries(values);
  if (entries.length === 0) {
    return <span className="text-xs text-slate-400">{empty ?? '—'}</span>;
  }

  return (
    <dl className="max-w-xs space-y-0.5 text-xs">
      {entries.map(([key, value]) => {
        const changed = changedFrom ? String(changedFrom[key] ?? '') !== String(value ?? '') : false;
        return (
          <div key={key} className="flex gap-1">
            <dt className="text-slate-500">{key}</dt>
            <dd className={changed ? 'font-bold text-brand-forest' : 'text-slate-700'}>{display(value)}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function display(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

function formatWhen(iso: string): string {
  // The server sends a timestamptz; show it in the reader's own zone
  // rather than pretending a stored string is a local time.
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString();
}
