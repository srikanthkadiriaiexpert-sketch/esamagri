/**
 * Numeric helpers for the entitlement engine.
 *
 * Everything the engine multiplies is a configured quantity (grams,
 * millilitres, pieces) against a small day count, so the magnitudes stay
 * far inside the exactly-representable integer range. What floating
 * point does introduce is dust — 0.1 + 0.2 territory — which would make
 * a remaining balance read as 8999.999999999998 instead of 9000. Every
 * result is therefore normalised to a fixed internal precision.
 *
 * Internal precision is kept deliberately higher than anything shown to
 * a customer: a ratio such as 20/7 is irrational in decimal, and
 * rounding it early would let a split selection drift far enough to
 * wrongly accept or reject a borderline quantity.
 */

/** Internal working precision. Six decimals matches numeric(14,6). */
export const INTERNAL_DP = 6;

/** Parse a pg `numeric` (delivered as text) without losing configured precision. */
export function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/** Normalise to internal precision, removing floating-point dust. */
export function round(value: number, dp: number = INTERNAL_DP): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** dp;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * The quantity a customer is shown.
 *
 * Entitlement quantities are physical amounts that have to be weighed or
 * counted out at a counter, so a remaining balance of 233.333… g of
 * garlic is shown as 233 g, not 233.33 g. Rounding is DOWNWARD, because
 * rounding up would present a customer with a fraction of a gram more
 * than the approved entitlement allows.
 *
 * Fractional units are preserved only where the configured unit is
 * genuinely divisible below 1 — which, for the units this system uses
 * (g, ml, piece), it is not.
 */
export function displayQuantity(value: number): number {
  return Math.floor(round(value));
}

/** Multiply a daily scale by eligible days at internal precision. */
export function scaleByDays(dailyQty: number, eligibleDays: number): number {
  return round(dailyQty * eligibleDays);
}

/**
 * Pool units consumed by taking `quantity` of a provision whose
 * configured ratio is `consumptionRatio` pool units per provision unit.
 */
export function poolEquivalent(quantity: number, consumptionRatio: number): number {
  return round(quantity * consumptionRatio);
}

/**
 * The most of a provision that a remaining pool balance can buy.
 * Floored to a whole unit for the same reason displayQuantity is.
 */
export function maxProvisionQuantity(remainingPoolQty: number, consumptionRatio: number): number {
  if (consumptionRatio <= 0) return 0;
  return Math.max(0, Math.floor(round(remainingPoolQty / consumptionRatio)));
}

/**
 * Comparison with a tolerance of half an internal unit.
 *
 * Used for the over-entitlement check so that a selection landing
 * exactly on the entitlement is accepted rather than rejected by a
 * trailing 1e-13.
 */
export function exceeds(consumed: number, entitlement: number): boolean {
  return round(consumed) - round(entitlement) > 1 / 10 ** INTERNAL_DP / 2;
}
