import { useNavigate } from 'react-router-dom';
import { Header, HeaderCartButton } from '../../design-system/Header';
import { SearchInput } from '../../design-system/SearchInput';
import { CategoryCard } from '../../design-system/CategoryCard';
import { AnnouncementCard } from '../../design-system/AnnouncementCard';
import { LoadingState, EmptyState, ErrorState } from '../../design-system/StateViews';
import { useResource } from '../../lib/api/resource';
import { apiRequest } from '../../lib/api/client';
import { usePifCart } from '../../lib/cart/PifCartContext';
import { fetchPifCategories, type PifCategoryNode } from '../../lib/api/pif-api';
import { approvedCategories } from '../../lib/businesses/unapproved-pif-categories';
import type { Announcement } from '../../lib/api/types';

/** PIF module home (STEP 8 Section 6). Shows ONLY PIF content — no RIK data anywhere on this screen (Section 7). */
export function PifHomePage() {
  const navigate = useNavigate();
  const cart = usePifCart();

  // Server-side search/pagination architecture (Section 10): this
  // screen only shows a bounded category grid, never the full
  // 3,000+ SKU catalog — full listing lives behind /pif/search and
  // /pif/categories/:id, each server-paginated.
  // The real catalogue: active categories with their active subcategories.
  const categories = useResource<PifCategoryNode[]>(() => fetchPifCategories(), undefined, []);
  const announcements = useResource<Announcement[]>(
    () => apiRequest<Announcement[]>('/announcements?audience=PIF'),
    undefined,
    []
  );

  // The twelve rejected categories are filtered out of every customer-facing
  // listing; see lib/businesses/unapproved-pif-categories.ts.
  const shelves = approvedCategories(categories.status === 'success' ? categories.data : []);

  return (
    <div className="app-shell min-h-screen bg-slate-50">
      <Header
        title="PIF — Payment Issue Facility"
        tone="forest"
        rightSlot={<HeaderCartButton count={cart.itemCount} dark onClick={() => navigate('/pif/cart')} />}
      />

      <main className="p-4">
        <button type="button" onClick={() => navigate('/pif/search')} className="block w-full text-left">
          <SearchInput readOnly value="" placeholder="Search groceries…" />
        </button>

        {/* The shop's own introduction. Deliberately carries no price, no
            delivery promise and no discount: this screen has no data for any
            of those, and a banner that invented one would be a lie in the
            customer's hand. */}
        <section className="mt-4 overflow-hidden rounded-2xl bg-brand-green p-4 text-white shadow-card">
          <p className="text-base font-extrabold leading-tight">Daily essentials, at the facility</p>
          <p className="mt-1 text-xs font-medium text-white/80">
            Browse the yard&apos;s grocery shelves and pay cash on delivery.
          </p>
          <span className="mt-3 inline-flex items-center rounded-full bg-brand-yellow px-3 py-1 text-[11px] font-bold text-brand-forest">
            Cash on delivery
          </span>
        </section>

        {announcements.status === 'success' && announcements.data.length > 0 ? (
          <section className="mt-4 rounded-2xl bg-white p-3 shadow-card">
            {announcements.data.map((a) => (
              <AnnouncementCard key={a.id} announcement={a} />
            ))}
          </section>
        ) : null}

        <section className="mt-4" aria-labelledby="pif-categories-heading">
          <h2 id="pif-categories-heading" className="mb-2.5 text-sm font-bold text-slate-900">
            Shop by category
          </h2>

          {categories.status === 'loading' ? <LoadingState /> : null}
          {categories.status === 'error' ? <ErrorState /> : null}
          {categories.status === 'not_implemented' ? (
            <ErrorState variant="not_implemented" description="The PIF catalog is being built and will appear here soon." />
          ) : null}
          {categories.status === 'success' && shelves.length === 0 ? <EmptyState title="No categories yet" /> : null}
          {categories.status === 'success' && shelves.length > 0 ? (
            <>
              <div className="flex flex-col gap-4">
                {shelves.map((group) => (
                  <div key={group.id}>
                    <div className="grid grid-cols-3 gap-3">
                      <CategoryCard
                        category={group}
                        accent="green"
                        size="lg"
                        onClick={() => navigate(`/pif/categories/${group.id}`)}
                      />
                      {group.subcategories.map((child) => (
                        <CategoryCard
                          key={child.id}
                          category={child}
                          accent="green"
                          size="lg"
                          onClick={() => navigate(`/pif/categories/${child.id}`)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </section>

        {/* mt-4, matching every other section on this screen: the odd mt-5
            here made the gap above "My PIF Orders" visibly wider than the
            gaps above it for no reason. */}
        <section className="mt-4">
          <button
            type="button"
            onClick={() => navigate('/pif/orders')}
            className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-card"
          >
            <p className="text-sm font-bold text-slate-900">My PIF Orders</p>
            <p className="mt-0.5 text-xs text-slate-500">Track delivery status, reorder favourites</p>
          </button>
        </section>
      </main>
    </div>
  );
}
