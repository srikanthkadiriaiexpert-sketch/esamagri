import type { ReactNode } from 'react';
import { ApiError, NetworkError } from '../lib/api/client';

/**
 * The shared pieces of the seven RIK configuration screens (STEP 11C).
 *
 * These exist so the screens differ only in WHICH configuration they
 * edit, never in how they behave when something goes wrong, and so a
 * rule cannot be restated in one screen's markup.
 *
 * `serverMessage` is the important one. When the server refuses a
 * change it sends a sentence written for the administrator plus a
 * machine-readable reason, so the screen shows the server's own words
 * rather than a guess of its own. That is deliberate: if a screen wrote
 * its own "a ratio must be positive", there would be two statements of
 * the rule and only one of them enforced. The frontend states nothing
 * about entitlement; it reports what the authority said.
 */

/** The server's explanation of a refusal, or an honest fallback. */
export function serverMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 400 && err.message) return err.message;
    // PHASE F: a 409 is a refusal the server explained in the facility's own
    // words — a duplicate SKU, a category that still holds products — and
    // those sentences are the whole value of the refusal, so they are passed
    // through exactly as a 400's are.
    if (err.status === 409 && err.message) return err.message;
    if (err.status === 403) return 'Your role does not include permission to change RIK configuration.';
    if (err.status === 401) return 'Your session has expired. Please sign in again.';
    if (err.status === 404) return 'That configuration row no longer exists. Reload and try again.';
    return 'The change could not be saved. Please try again.';
  }
  if (err instanceof NetworkError) {
    return 'The server could not be reached. Check your connection and try again.';
  }
  return 'The change could not be saved. Please try again.';
}

/** Which field the server objected to, when it said. */
export function serverField(err: unknown): string | null {
  if (err instanceof ApiError) {
    const field = err.details?.field;
    return typeof field === 'string' ? field : null;
  }
  return null;
}

export function ConfigError({ error }: { error: unknown }) {
  if (error === null || error === undefined) return null;
  const field = serverField(error);
  return (
    <p
      role="alert"
      className="mt-3 rounded-lg border border-semantic-danger/30 bg-semantic-dangerLight px-3 py-2 text-sm text-semantic-danger"
    >
      {serverMessage(error)}
      {field ? <span className="ml-1 font-semibold">({field})</span> : null}
    </p>
  );
}

export function ConfigNotice({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="status" className="mt-3 rounded-lg border border-brand-green/30 bg-brand-greenLight px-3 py-2 text-sm text-brand-greenDark">
      {children}
    </p>
  );
}

/**
 * Whether a rule is in force, and if not, why not. An administrator
 * reading a configuration list needs to tell "this is the rule today"
 * from "this used to be the rule" at a glance, because both are shown —
 * configuration is retired, never deleted.
 */
export function RuleStatus({
  isActive,
  effectiveFrom,
  effectiveTo,
  today = new Date().toISOString().slice(0, 10),
}: {
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  today?: string;
}) {
  const label = !isActive
    ? 'Retired'
    : effectiveFrom > today
      ? 'Scheduled'
      : effectiveTo !== null && effectiveTo < today
        ? 'Closed'
        : 'In force';

  const tone =
    label === 'In force'
      ? 'bg-brand-greenLight text-brand-greenDark'
      : label === 'Scheduled'
        ? 'bg-brand-amberLight text-brand-amberDark'
        : 'bg-slate-100 text-slate-600';

  return <span className={['rounded px-2 py-0.5 text-xs font-bold', tone].join(' ')}>{label}</span>;
}

/** The window a rule applies to, in the form an administrator reads it. */
export function EffectiveWindow({ from, to }: { from: string; to: string | null }) {
  return (
    <span className="tabular-nums text-slate-600">
      {from} → {to ?? 'open'}
    </span>
  );
}

export function FieldLabel({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      {children}
      {hint ? <span className="mt-1 block text-xs font-normal text-slate-500">{hint}</span> : null}
    </label>
  );
}

const CONTROL =
  'mt-1 min-h-touch w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={CONTROL} />;
}

export function SelectInput({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={CONTROL}>
      {children}
    </select>
  );
}

export function PrimaryButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="submit"
      {...props}
      className="min-h-touch rounded-lg bg-brand-forest px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function SecondaryButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className="min-h-touch rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** A table that scrolls sideways on a phone rather than squashing. */
export function ConfigTable({ caption, head, children }: { caption: string; head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[46rem] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Th({ children }: { children: ReactNode }) {
  return (
    <th scope="col" className="px-4 py-2.5">
      {children}
    </th>
  );
}

export function Td({ children, numeric = false }: { children: ReactNode; numeric?: boolean }) {
  return <td className={['px-4 py-3 text-slate-700', numeric ? 'tabular-nums' : ''].join(' ')}>{children}</td>;
}

/**
 * A collapsible "add new" panel. Closed by default: these screens are
 * read far more often than written, and an always-open form invites a
 * change nobody meant to make.
 */
export function AddPanel({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-touch w-full items-center justify-between px-4 py-3 text-left text-sm font-bold text-slate-800"
      >
        {title}
        <span aria-hidden="true" className="text-slate-400">
          {open ? '−' : '+'}
        </span>
      </button>
      {open ? <div className="border-t border-slate-100 p-4">{children}</div> : null}
    </div>
  );
}

/** Today, as YYYY-MM-DD — the default start date for a new rule. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Parses a number an administrator typed. Returns `undefined` for an
 * empty box so a PATCH omits the field entirely, and passes anything
 * else through as typed — including a negative or a zero, so the SERVER
 * decides whether it is allowed and says why. Silently correcting the
 * input here would hide the rule instead of enforcing it.
 */
export function numberOrUndefined(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
}

/** Same, but an empty box means "clear this nullable column". */
export function numberOrNull(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}
