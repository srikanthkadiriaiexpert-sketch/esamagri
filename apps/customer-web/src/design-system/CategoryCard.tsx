import type { CategorySummary } from '../lib/api/types';

export interface CategoryCardProps {
  category: CategorySummary;
  accent?: 'blue' | 'green';
  /**
   * How much room the picture gets. 'md' is the original and stays the
   * default, so every existing caller — the RIK grids among them — renders
   * exactly as before. 'lg' is the PIF shop, where a photograph of the
   * groceries is the point of the card rather than a decoration on it.
   */
  size?: 'md' | 'lg';
  onClick: () => void;
}

/** Reusable category tile (STEP 8 Section 11) for both RIK and PIF category grids. */
export function CategoryCard({ category, accent = 'green', size = 'md', onClick }: CategoryCardProps) {
  const art = size === 'lg' ? 'h-16 w-16' : 'h-12 w-12';
  const icon = size === 'lg' ? 'h-7 w-7' : 'h-5 w-5';
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 rounded-2xl border border-slate-100 bg-white p-3 text-center shadow-card"
    >
      <span
        className={[
          `flex ${art} items-center justify-center overflow-hidden rounded-full`,
          accent === 'blue' ? 'bg-brand-blueLight' : 'bg-brand-greenLight',
        ].join(' ')}
      >
        {category.imageUrl ? (
          <img src={category.imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className={accent === 'blue' ? 'text-brand-blueDark' : 'text-brand-greenDark'} aria-hidden="true">
            <svg viewBox="0 0 24 24" className={icon} fill="none">
              <path d="M4 10.5L12 4l8 6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M6 9.5V19h12V9.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
          </span>
        )}
      </span>
      <span className="line-clamp-2 text-xs font-semibold leading-tight text-slate-700">{category.name}</span>
      {typeof category.productCount === 'number' ? (
        <span className="text-[10px] text-slate-400">{category.productCount} items</span>
      ) : null}
    </button>
  );
}
