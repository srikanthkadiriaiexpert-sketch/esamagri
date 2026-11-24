import type { PifProduct, RikProduct } from '../lib/api/types';
import { Button } from './Button';
import { RemoteImage } from './RemoteImage';
import { QuantityStepper } from './QuantityStepper';

function formatMoney(money: { amountMinor: number; currency: 'INR' }): string {
  return `₹${(money.amountMinor / 100).toFixed(2)}`;
}

interface RikProductCardProps {
  module: 'rik';
  product: RikProduct;
  quantity: number;
  onAdd: () => void;
  onQuantityChange: (qty: number) => void;
  onClick?: () => void;
}
interface PifProductCardProps {
  module: 'pif';
  product: PifProduct;
  quantity: number;
  onAdd: () => void;
  onQuantityChange: (qty: number) => void;
  onClick?: () => void;
}

export type ProductCardProps = RikProductCardProps | PifProductCardProps;

/**
 * The single reusable product card (STEP 8 Section 9) for both RIK
 * and PIF grids. RIK products never render commercial pricing; PIF
 * products always do. Availability, Add button, and quantity controls
 * are shared behavior — only the price/entitlement row differs by
 * module.
 */
export function ProductCard(props: ProductCardProps) {
  const { product, quantity, onAdd, onQuantityChange, onClick } = props;
  const accent = props.module === 'rik' ? 'blue' : 'green';

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
      <button type="button" onClick={onClick} className="block aspect-square w-full bg-slate-50">
        {/* A stored image URL is a claim: if the file is not there, the
            placeholder is shown rather than the browser's broken-image
            glyph. See RemoteImage. */}
        <RemoteImage
          src={product.imageUrl}
          alt={product.name}
          className="h-full w-full object-cover"
          fallback={
            <div className="flex h-full w-full items-center justify-center text-slate-300">
              <PlaceholderImageIcon />
            </div>
          }
        />
      </button>
      <div className="flex flex-1 flex-col p-3">
        <button type="button" onClick={onClick} className="text-left">
          <p className="line-clamp-2 text-sm font-semibold text-slate-900">{product.name}</p>
          <p className="mt-0.5 text-xs text-slate-500">{product.unitLabel}</p>
        </button>

        {props.module === 'pif' ? (
          <p className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-sm font-extrabold text-slate-900">{formatMoney(props.product.price)}</span>
            {props.product.mrp && props.product.mrp.amountMinor > props.product.price.amountMinor ? (
              <span className="text-xs text-slate-400 line-through">{formatMoney(props.product.mrp)}</span>
            ) : null}
          </p>
        ) : props.product.entitlement ? (
          <p className="mt-1.5 text-xs font-semibold text-brand-blueDark">
            {props.product.entitlement.remainingQty} {props.product.entitlement.unit} remaining
          </p>
        ) : null}

        {!product.inStock ? (
          <p className="mt-1.5 text-xs font-semibold text-semantic-danger">Out of stock</p>
        ) : (
          <div className="mt-2">
            {quantity > 0 ? (
              <QuantityStepper value={quantity} onChange={onQuantityChange} accent={accent} />
            ) : (
              <Button size="sm" fullWidth accent={accent} onClick={onAdd}>
                Add
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PlaceholderImageIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 40 40" className="h-8 w-8">
      <rect x="6" y="9" width="28" height="22" rx="2.5" stroke="currentColor" strokeWidth="1.6" fill="none" />
      <circle cx="14" cy="16" r="2.5" stroke="currentColor" strokeWidth="1.6" fill="none" />
      <path d="M6 26l8-8 6 6 6-5 8 8" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinejoin="round" />
    </svg>
  );
}
