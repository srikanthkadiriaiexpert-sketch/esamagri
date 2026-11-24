/**
 * Renders the final approved e Samagri logo asset
 * (public/brand/e-samagri-logo.jpg) exactly as supplied — never
 * cropped, redrawn, or recomposited. The only transformation applied
 * is uniform CSS scaling (via the `className` height), the same as
 * placing any image at a given size on a page; the pixels themselves
 * are untouched. See public/brand/README.md.
 */
export function Logo({ className = 'h-11 w-11' }: { className?: string }) {
  return (
    <img
      src="/brand/e-samagri-logo.jpg"
      alt="e Samagri — Essentials for a Brighter Tomorrow"
      className={[className, 'rounded-lg object-contain'].join(' ')}
    />
  );
}
