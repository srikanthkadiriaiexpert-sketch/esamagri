import type { RikEntitlementInfo } from '../lib/api/types';

export interface EntitlementCardProps {
  entitlement: RikEntitlementInfo;
}

/**
 * RIK entitlement display (STEP 8 Section 5/12). Deliberately no
 * progress bar / percentage-scale visualization anywhere in this
 * component — the kickoff explicitly rules that out. Instead:
 * allowed / issued / reserved / remaining as plain labeled figures,
 * plus alternatives/substitution info when present. The actual
 * entitlement business logic (calculations, conversions) is not
 * implemented here — this only renders whatever `entitlement` it is
 * given.
 */
export function EntitlementCard({ entitlement }: EntitlementCardProps) {
  return (
    <div className="rounded-2xl border border-brand-blueLight bg-brand-blueLight/40 p-4">
      <p className="text-sm font-bold text-brand-blueDark">{entitlement.category} entitlement</p>
      <dl className="mt-3 grid grid-cols-2 gap-3">
        <Stat label="Allowed" value={`${entitlement.allowedQty} ${entitlement.unit}`} />
        <Stat label="Issued" value={`${entitlement.issuedQty} ${entitlement.unit}`} />
        <Stat label="Reserved" value={`${entitlement.reservedQty} ${entitlement.unit}`} />
        <Stat label="Remaining" value={`${entitlement.remainingQty} ${entitlement.unit}`} emphasize />
      </dl>
      {entitlement.alternatives && entitlement.alternatives.length > 0 ? (
        <div className="mt-3 border-t border-brand-blue/20 pt-3">
          <p className="text-xs font-semibold text-brand-blueDark">Available alternatives</p>
          <ul className="mt-1.5 space-y-1">
            {entitlement.alternatives.map((alt) => (
              <li key={alt.productId} className="text-xs text-slate-600">
                {alt.productName}
                {alt.conversionNote ? <span className="text-slate-400"> — {alt.conversionNote}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-brand-blueDark/70">{label}</dt>
      <dd className={['mt-0.5', emphasize ? 'text-base font-extrabold text-brand-blueDark' : 'text-sm font-semibold text-slate-700'].join(' ')}>
        {value}
      </dd>
    </div>
  );
}
