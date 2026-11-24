export interface QuantityStepperProps {
  value: number;
  onChange: (value: number) => void;
  accent?: 'blue' | 'green';
  min?: number;
  max?: number;
}

const ACCENT_BG: Record<'blue' | 'green', string> = {
  blue: 'bg-brand-blue',
  green: 'bg-brand-green',
};

export function QuantityStepper({ value, onChange, accent = 'green', min = 0, max = 99 }: QuantityStepperProps) {
  return (
    <div className={['flex h-9 items-center justify-between rounded-lg text-white', ACCENT_BG[accent]].join(' ')}>
      <button
        type="button"
        aria-label="Decrease quantity"
        onClick={() => onChange(Math.max(min, value - 1))}
        className="flex h-9 w-9 shrink-0 items-center justify-center text-lg font-bold"
      >
        −
      </button>
      <span className="min-w-[1.5rem] text-center text-sm font-bold" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        aria-label="Increase quantity"
        onClick={() => onChange(Math.min(max, value + 1))}
        className="flex h-9 w-9 shrink-0 items-center justify-center text-lg font-bold"
      >
        +
      </button>
    </div>
  );
}
