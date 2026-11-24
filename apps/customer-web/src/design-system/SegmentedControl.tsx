export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  'aria-label': string;
  size?: 'md' | 'lg';
}

/**
 * The RIK / PIF selector (STEP 8 Section 4 — "one of the most
 * important UI elements... make it visually prominent"). Generic over
 * the option type so it can also drive smaller in-page tab groups
 * (e.g. order-status filters) without a second component.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  ...rest
}: SegmentedControlProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={rest['aria-label']}
      className="flex rounded-2xl bg-slate-100 p-1"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={[
              'flex flex-1 items-center justify-center gap-1.5 rounded-xl font-bold transition-colors',
              size === 'lg' ? 'h-14 text-base' : 'h-11 text-sm',
              active ? 'bg-white text-brand-forest shadow-card' : 'text-slate-500 hover:text-slate-700',
            ].join(' ')}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
