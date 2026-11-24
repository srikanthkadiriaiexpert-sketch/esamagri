import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { RequireCustomer } from '../auth/decorators/require-customer.decorator';
import { EntitlementConfigRepository } from './repositories/entitlement-config.repository';
import { RikBannersService } from './services/rik-banners.service';
import { RikNewArrivalsService } from './services/rik-new-arrivals.service';
import { rikImageUrl } from './services/rik-media.service';

/**
 * COMMON CONTENT: the part of the catalogue that belongs to every resident.
 *
 * ================================================================
 * WHY THIS CONTROLLER EXISTS
 * ================================================================
 *
 * `RikController` carries a CLASS-LEVEL `@RequireRikCustomer()`, and that is
 * right for what it holds: entitlements, vouchers, issue schedules, eligible
 * days. Declared once rather than twelve times, it cannot be forgotten on a
 * route added later — the file says so itself.
 *
 * Three of its routes, though, were never about entitlement at all. Seasonal
 * banners are decoration. New Arrivals is a shop window. The catalogue is a
 * reference list of what the food IS — deliberately stripped of every
 * entitlement rule before it is sent, carrying no ratio, no maximum, no
 * minimum eligible days and no dietary applicability. None of the three reads
 * a pool balance, an eligibility row or a period.
 *
 * They sat behind the RIK guard only because they were written in the RIK
 * controller, and the approved common-customer-experience decision makes that
 * a real defect rather than an untidiness: a PIF-only resident's home screen
 * lost its promotional banners and two of its three feature cards, which is
 * what made a newly registered account look half-built.
 *
 * ================================================================
 * WHY A NEW CONTROLLER RATHER THAN RELAXING THE OLD ONE
 * ================================================================
 *
 * Removing the class-level guard to free three routes would have turned one
 * safe default into nine per-route decorators that somebody has to remember —
 * and the nine are the ones that actually matter. So the RIK controller is
 * untouched, its guard intact, and these three get an address of their own
 * where `@RequireCustomer()` is the whole requirement.
 *
 * `@RequireCustomer()` IS NOT THE ABSENCE OF A CHECK. A STAFF principal of any
 * role, SUPER_ADMIN included, is 403 here, and an unauthenticated caller is
 * 401. What changed is only which customers qualify: all of them, rather than
 * the ration-approved ones.
 *
 * ================================================================
 * WHAT IS DELIBERATELY NOT HERE
 * ================================================================
 *
 * Nothing that depends on who is asking. Every response below is identical
 * for every customer on the same day, which is the test for whether a route
 * belongs in this file: `entitlements/current`, `eligibility-days`,
 * `issue-vouchers` and `issue-schedule` are all answers about ONE person and
 * all stay where they are, behind the RIK guard.
 *
 * This controller also holds no write path of any kind. Three GETs.
 *
 * ================================================================
 * THE OLD ADDRESSES STILL ANSWER, FOR NOW
 * ================================================================
 *
 * `GET /rik/banners`, `/rik/new-arrivals` and `/rik/catalogue` are unchanged
 * and still RIK-only. They are kept for one release so that a browser holding
 * a cached front-end bundle mid-deploy does not break, and because the file
 * they live in has an unrelated approved change pending that this work must
 * not collide with. Every client is repointed here in the same release, so
 * those three become dead code and SHOULD BE DELETED once the pending
 * entitlement work has landed. Until then the view shapes below are a
 * deliberate, time-boxed second copy — which is why the field lists are
 * written out in full rather than being quietly shared with a helper that
 * might drift in one place and not the other.
 */
@Controller('content')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class CommonContentController {
  constructor(
    private readonly config: EntitlementConfigRepository,
    private readonly newArrivalsService: RikNewArrivalsService,
    private readonly bannersService: RikBannersService
  ) {}

  /**
   * The seasonal banners the home screen shows today.
   *
   * NOT THE HERO. The home screen's permanent hero is a committed brand asset
   * rendered by the customer app itself, owned by no table and reachable from
   * no endpoint. This returns the OPTIONAL seasonal pictures beneath it, and
   * an empty list — the normal state — leaves the home screen as it is.
   *
   * The server does the date arithmetic: published, pictured, and inside its
   * window as at today. So a phone with a wrong clock cannot show a banner
   * early or hold an expired one, and staff schedule a Diwali banner in
   * advance without anybody having to remember to take it down.
   */
  @Get('banners')
  @RequireCustomer()
  async banners() {
    const items = await this.bannersService.listForCustomers();
    return {
      asOf: new Date().toISOString().slice(0, 10),
      items: items.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        imageUrl: rikImageUrl(row.image_ref),
        startsOn: row.starts_on,
        endsOn: row.ends_on,
      })),
    };
  }

  /**
   * New Arrivals — what staff are currently featuring.
   *
   * A SHOP WINDOW, NOT AN ALLOWANCE. Appearing here says one thing: a member
   * of staff chose to highlight this. It says nothing about whether the
   * reader is entitled to it, how much they may take, or whether any is in
   * stock — this route reads one table of listings and never consults a pool,
   * a scale, a period or an eligibility row. That is precisely why it is safe
   * for every customer: there is no per-person figure in it to leak.
   *
   * A resident who sees something here and wants to know their allowance goes
   * to Know Your Ration, which is the only place that answers that question
   * and is still behind the RIK guard.
   */
  @Get('new-arrivals')
  @RequireCustomer()
  async newArrivals() {
    const items = await this.newArrivalsService.listForCustomers();
    return {
      asOf: new Date().toISOString().slice(0, 10),
      items: items.map((row) => ({
        /** Stable identity for the card. A listing id, not a product id. */
        id: row.id,
        /** The catalogue code, or null for a standalone listing. */
        code: row.code,
        /** The catalogue name when linked, the staff-typed one otherwise. */
        name: row.display_name,
        brand: row.brand,
        imageRef: rikImageUrl(row.effective_image_ref),
        headline: row.headline,
        // Catalogue facts, all null on a standalone listing. Screens show
        // them only when present rather than inventing placeholders.
        unit: row.unit,
        packSize: row.pack_size === null ? null : Number(row.pack_size),
        packUnit: row.pack_unit,
        issuePeriod: row.issue_period,
        poolName: row.pool_name,
        /** When it started being featured — the basis for the NEW badge. */
        publishedFrom: row.published_from,
      })),
    };
  }

  /**
   * The provision catalogue, as a reference list — what Nutrition Info reads.
   *
   * WHAT IT DELIBERATELY DOES NOT RETURN, and this is what makes it common
   * content rather than entitlement data: no consumption ratio, no maximum
   * quantity, no maximum packs, no minimum eligible days, no dietary
   * applicability, no selectability flag. Those are entitlement rules, and
   * publishing a ratio here would let a reader infer an allowance this route
   * never checked. What is left is what is true of the item on a shelf — what
   * it is called, whose brand it is, what it looks like, and how it is packed.
   *
   * READ-ONLY BY CONSTRUCTION, over the same `loadConfiguration` the engine
   * reads, with the same active/effective-window filter — so a retired item
   * disappears from here exactly when it disappears from the engine, and no
   * second definition of "active" can drift from the first.
   */
  @Get('catalogue')
  @RequireCustomer()
  async catalogue() {
    const asOf = new Date().toISOString().slice(0, 10);
    const configuration = await this.config.loadConfiguration(asOf);
    const poolByItsId = new Map(configuration.pools.map((pool) => [pool.id, pool]));

    const items = configuration.provisions.map((provision) => {
      const pool = poolByItsId.get(provision.pool_id);
      return {
        // The stable business key. Anything keyed to a provision from outside
        // the database keys on this, never on the uuid, which differs
        // between environments.
        code: provision.code,
        name: provision.name,
        brand: provision.brand,
        imageRef: rikImageUrl(provision.image_ref),
        unit: provision.unit,
        packSize: provision.pack_size === null ? null : Number(provision.pack_size),
        packUnit: provision.pack_unit,
        isLoose: provision.is_loose,
        issuePeriod: provision.issue_period,
        poolCode: pool?.code ?? null,
        poolName: pool?.name ?? null,
      };
    });

    return { asOf, items };
  }
}
