import { useResource } from '../lib/api/resource';
import { fetchSeasonalBanners, type SeasonalBanner } from '../lib/api/rik-banners-api';

/**
 * Seasonal promotional banners — Diwali, Sankranti, Christmas, a summer
 * offer — shown BELOW the permanent hero on the customer home screen.
 *
 * THE RULE THIS COMPONENT EXISTS TO HONOUR: it can never replace the hero.
 * It renders after it, in its own section, and it returns `null` for every
 * state that is not "there is at least one live banner" — loading, error,
 * empty, and a server that has not shipped the route yet. So on a normal day
 * with nothing scheduled, the home screen is byte-for-byte what it is today,
 * with no gap, no spinner and no placeholder box under the hero.
 *
 * WHY FAILURE IS SILENT HERE, WHEN THE REST OF THIS APP IS LOUD ABOUT IT.
 * Everywhere else an unreachable API is reported, because the customer asked
 * for that thing and deserves to know it did not arrive. Nobody asks for a
 * promotional banner. Putting "Couldn't load banners" under the hero would
 * turn a marketing extra into an apparent fault on the first screen after
 * sign-in — so a failure here costs the customer nothing and says nothing.
 *
 * The server decides what is live. It returns only published, pictured
 * banners whose date window covers today, so this component holds no date
 * logic and a phone with a wrong clock cannot show a banner early.
 */
export function SeasonalBanners() {
  const banners = useResource<SeasonalBanner[]>(() => fetchSeasonalBanners(), undefined, []);

  if (banners.status !== 'success' || banners.data.length === 0) {
    return null;
  }

  return (
    <section className="mt-4 space-y-3" aria-label="Seasonal offers">
      {banners.data.map((banner) => (
        <BannerCard key={banner.id} banner={banner} />
      ))}
    </section>
  );
}

/**
 * One banner.
 *
 * The picture keeps its own aspect ratio: width is 100% of the content
 * column and height is derived, exactly as the hero does it, so there is no
 * fixed-height container to crop a staff upload of unexpected proportions.
 * Whatever shape they upload is what they see.
 *
 * `loading="lazy"` and `decoding="async"` because this sits below the hero,
 * which is the screen's one `fetchPriority="high"` image and must stay that
 * way — a seasonal banner must never compete with the hero for the first
 * paint on a phone.
 *
 * The title is the alt text. A screen-reader user and a customer whose
 * images failed both get the same sentence, which is the whole reason the
 * database makes the title mandatory.
 */
function BannerCard({ banner }: { banner: SeasonalBanner }) {
  return (
    <figure className="overflow-hidden rounded-2xl bg-white shadow-card">
      <img
        src={banner.imageUrl}
        alt={banner.title}
        loading="lazy"
        decoding="async"
        className="block h-auto w-full"
      />
      {banner.description === null ? null : (
        <figcaption className="px-4 py-3">
          <p className="text-sm font-bold text-slate-900">{banner.title}</p>
          <p className="mt-0.5 text-xs text-slate-600">{banner.description}</p>
        </figcaption>
      )}
    </figure>
  );
}
