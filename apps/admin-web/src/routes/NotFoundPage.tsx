import { Link } from 'react-router-dom';

/**
 * An address inside the admin console that does not exist. Kept
 * deliberately plain: it must not hint at what other routes exist, and
 * it must not be mistaken for the unauthorized state, which is a
 * different answer to a different question.
 */
export function NotFoundPage() {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-8 text-center">
      <h1 className="text-base font-bold text-brand-forest">This page does not exist</h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
        Check the address, or go back to the dashboard.
      </p>
      <Link
        to="/"
        className="mt-4 inline-flex min-h-touch items-center rounded-lg bg-brand-forest px-4 py-2 text-sm font-semibold text-white"
      >
        Go to dashboard
      </Link>
    </section>
  );
}
