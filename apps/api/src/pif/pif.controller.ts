import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ERROR_CODES } from '@esamagri/shared-types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { RequireCustomer } from '../auth/decorators/require-customer.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AccessTokenPrincipal } from '../auth/services/token.service';
import { CatalogueError, PifCatalogueService } from './services/pif-catalogue.service';
import { OrderError, PifOrderService } from './services/pif-order.service';
import { QuoteDto } from './dto/pif-catalogue.dto';
import { CheckoutDto } from './dto/pif-order.dto';
import type { ProductRecord } from './repositories/pif-catalogue.repository';
import type { OrderEventRecord, OrderItemRecord, OrderRecord } from './repositories/pif-orders.repository';

/**
 * The PIF shop, as a customer uses it (PHASE F).
 *
 * Browse → search → product → quote → checkout (cash on delivery) → order
 * status. Every route here is the customer's own: a product listing shows
 * only what is active, and an order route answers only about an order
 * belonging to the authenticated shopper — someone else's order answers
 * exactly as one that does not exist, so an id in a URL reveals nothing.
 *
 * READ ONLY ON THE STATUS. There is no customer route that moves an order's
 * status, cancels one, or marks anything delivered, and the application
 * holds no UPDATE on pif.orders at all (migration 0050), so there is nothing
 * for such a route to reach even if one were added by mistake.
 *
 * THE MONEY IS THE SERVER'S. `POST /pif/quote` exists so the cart screen can
 * display totals it did not compute; `POST /pif/checkout` recomputes every
 * figure from the catalogue and ignores anything the body might claim.
 *
 * NOTHING RIK. This controller touches no RIK table, service or permission,
 * and the RIK controllers touch nothing here.
 */
@Controller('pif')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class PifController {
  constructor(
    private readonly catalogue: PifCatalogueService,
    private readonly orders: PifOrderService
  ) {}

  /** The home screen: active categories with their active subcategories. */
  @Get('categories')
  @RequireCustomer()
  async categories() {
    const tree = await this.catalogue.publicCategories();
    return tree.map((category) => ({
      id: category.id,
      name: category.name,
      // The navigation slug, so a shop screen can resolve its URL to this id
      // rather than guessing by name. See CategoryRecord.slug.
      slug: category.slug,
      description: category.description,
      imageUrl: imageUrl(category.image_ref),
      productCount: category.product_count,
      subcategories: category.children.map((child) => ({
        id: child.id,
        name: child.name,
        slug: child.slug,
        imageUrl: imageUrl(child.image_ref),
        productCount: child.product_count,
      })),
    }));
  }

  /** A category's products, paginated server-side. */
  @Get('categories/:categoryId/products')
  @RequireCustomer()
  async categoryProducts(
    @Param('categoryId', new ParseUUIDPipe()) categoryId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('availableOnly') availableOnly?: string
  ) {
    const result = await this.catalogue.publicProducts({
      categoryId,
      page: toInt(page, 1),
      pageSize: toInt(pageSize, 20),
      availableOnly: availableOnly === 'true',
    });
    return {
      items: result.items.map(productView),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  /** Search by name, brand or SKU. */
  @Get('search')
  @RequireCustomer()
  async search(
    @Query('q') q?: string,
    @Query('categoryId') categoryId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('availableOnly') availableOnly?: string
  ) {
    const result = await this.catalogue.publicProducts({
      query: q ?? null,
      categoryId: categoryId ?? null,
      page: toInt(page, 1),
      pageSize: toInt(pageSize, 20),
      availableOnly: availableOnly === 'true',
    });
    return {
      items: result.items.map(productView),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      query: q ?? '',
    };
  }

  @Get('products/:productId')
  @RequireCustomer()
  async product(@Param('productId', new ParseUUIDPipe()) productId: string) {
    try {
      const product = await this.catalogue.publicProduct(productId);
      const variants = await this.catalogue.variantsOf(product);
      return { ...productView(product), variants: variants.map(productView) };
    } catch (err) {
      if (err instanceof CatalogueError) {
        throw new NotFoundException({
          code: ERROR_CODES.NOT_FOUND,
          message: 'That product is not in the catalogue.',
        });
      }
      throw err;
    }
  }

  /**
   * Price a cart. The client sends ids and quantities; this answers with the
   * line totals, the tax, the order total and anything it had to refuse.
   */
  @Post('quote')
  @RequireCustomer()
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async quote(@Body() dto: QuoteDto) {
    const quote = await this.orders.quote(dto.lines, dto.fulfillmentMode ?? 'DELIVERY');
    return {
      lines: quote.priced.map((line) => ({
        productId: line.productId,
        name: line.productName,
        brand: line.brand,
        unit: line.unit,
        qty: line.qty,
        unitPrice: line.unitPrice,
        taxRateName: line.taxRateName,
        taxRatePct: line.taxRatePct,
        discountPct: line.discountPct,
        lineSubtotal: line.lineSubtotal,
        lineDiscount: line.lineDiscount,
        lineTax: line.lineTax,
        lineTotal: line.lineTotal,
      })),
      refused: quote.refused,
      subtotal: quote.subtotal,
      discountTotal: quote.discountTotal,
      taxTotal: quote.taxTotal,
      /*
       * THE DELIVERY FIGURES, all four of them the server's.
       *
       * `merchandiseTotal` is what the goods cost and what the threshold was
       * tested on; `deliveryTotal` is the charge that follows; `deliveryFee`,
       * `deliveryThreshold` and `amountToFreeDelivery` are returned so the
       * cart can say "Add Rs X more to unlock FREE delivery" without a single
       * screen hard-coding 20 or 499 and then drifting from the rule.
       */
      merchandiseTotal: quote.merchandiseTotal,
      deliveryTotal: quote.deliveryTotal,
      freeDelivery: quote.freeDelivery,
      deliveryFee: quote.deliveryFee,
      deliveryThreshold: quote.deliveryThreshold,
      amountToFreeDelivery: quote.amountToFreeDelivery,
      total: quote.total,
      paymentMethod: 'COD',
    };
  }

  /** Place the order. Cash on delivery, and no payment is simulated. */
  @Post('checkout')
  @RequireCustomer()
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async checkout(
    @CurrentPrincipal() principal: AccessTokenPrincipal,
    @Body() dto: CheckoutDto
  ) {
    try {
      const placed = await this.orders.checkout(principal.principalId, {
        lines: dto.lines,
        fulfillmentMode: dto.fulfillmentMode,
        deliveryAddressId: dto.deliveryAddressId ?? null,
        customerNote: dto.customerNote ?? null,
        idempotencyKey: dto.idempotencyKey ?? null,
      });
      return {
        orderId: placed.orderId,
        orderNumber: placed.orderNumber,
        status: 'PLACED',
        total: placed.total,
        paymentMethod: 'COD',
        /** True when this request was a repeat of one already placed. */
        duplicate: placed.duplicate,
      };
    } catch (err) {
      throw toCustomerHttp(err);
    }
  }

  @Get('orders')
  @RequireCustomer()
  async myOrders(@CurrentPrincipal() principal: AccessTokenPrincipal) {
    const orders = await this.orders.listForCustomer(principal.principalId);
    return { items: orders.map(orderSummaryView) };
  }

  @Get('orders/:orderId')
  @RequireCustomer()
  async myOrder(
    @CurrentPrincipal() principal: AccessTokenPrincipal,
    @Param('orderId', new ParseUUIDPipe()) orderId: string
  ) {
    try {
      const view = await this.orders.customerView(principal.principalId, orderId);
      return customerOrderView(view.order, view.items, view.events);
    } catch (err) {
      if (err instanceof OrderError) {
        throw new NotFoundException({
          code: ERROR_CODES.NOT_FOUND,
          message: 'That order does not exist.',
        });
      }
      throw err;
    }
  }
}

/** Keys become URLs here and nowhere else. */
export function imageUrl(imageRef: string | null): string | null {
  if (imageRef === null) return null;
  // A key stored by PifMediaService is served by PifMediaController; a path
  // that was configured as a static asset (the RIK category covers work this
  // way) is passed through unchanged.
  return imageRef.startsWith('pif/') ? `/pif/media/${imageRef}` : imageRef;
}

export function productView(product: ProductRecord) {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    brand: product.brand,
    description: product.description,
    categoryId: product.category_id,
    categoryName: product.category_name,
    parentCategoryName: product.parent_category_name,
    unit: product.unit,
    packSize: product.pack_size === null ? null : Number(product.pack_size),
    packUnit: product.pack_unit,
    price: Number(product.selling_price),
    discountPct: product.discount_pct === null ? null : Number(product.discount_pct),
    taxRateName: product.tax_rate_name,
    taxRatePct: product.tax_rate_pct === null ? 0 : Number(product.tax_rate_pct),
    imageUrl: imageUrl(product.image_ref),
    available: product.available,
    minOrderQty: Number(product.min_order_qty),
    maxOrderQty: product.max_order_qty === null ? null : Number(product.max_order_qty),
    qtyStep: Number(product.qty_step),
    variantLabel: product.variant_label,
  };
}

export function orderSummaryView(order: OrderRecord) {
  return {
    id: order.id,
    orderNumber: order.order_number,
    status: order.status,
    fulfillmentMode: order.fulfillment_mode,
    itemCount: order.item_count,
    /*
     * The delivery charge this order carried.
     *
     * It is here because PifOrderListItem in the customer client DECLARES it,
     * and a type that promises a field the server never sends is worse than
     * no type at all: the value arrives as undefined and the first screen to
     * render it crashes on `undefined.toFixed`. The repository already selects
     * the column, so sending it costs nothing and makes the contract true.
     */
    deliveryTotal: Number(order.delivery_total),
    total: Number(order.total),
    paymentMethod: order.payment_method,
    placedAt: order.placed_at,
    updatedAt: order.updated_at,
  };
}

/**
 * The customer's own order.
 *
 * Note what is NOT here: no staff member's name, no internal note, no event
 * sequence number. The shopper is shown what happened to their order and
 * when — not the facility's own record of who did it.
 */
export function customerOrderView(
  order: OrderRecord,
  items: OrderItemRecord[],
  events: OrderEventRecord[]
) {
  return {
    id: order.id,
    orderNumber: order.order_number,
    status: order.status,
    fulfillmentMode: order.fulfillment_mode,
    paymentMethod: order.payment_method,
    deliveryAddress: order.delivery_address_snapshot,
    contactName: order.contact_name,
    contactMobile: order.contact_mobile,
    customerNote: order.customer_note,
    subtotal: Number(order.subtotal),
    discountTotal: Number(order.discount_total),
    taxTotal: Number(order.tax_total),
    // What was actually charged on THIS order, not what today's rule would
    // charge: a past order keeps the figure it was placed with.
    deliveryTotal: Number(order.delivery_total),
    total: Number(order.total),
    placedAt: order.placed_at,
    acceptedAt: order.accepted_at,
    readyAt: order.ready_at,
    outForDeliveryAt: order.out_for_delivery_at,
    deliveredAt: order.delivered_at,
    codCollectedAt: order.cod_collected_at,
    cancelledAt: order.cancelled_at,
    notDeliveredAt: order.not_delivered_at,
    items: items.map((item) => ({
      productId: item.product_id,
      sku: item.sku,
      name: item.product_name,
      brand: item.brand,
      unit: item.unit,
      packSize: item.pack_size === null ? null : Number(item.pack_size),
      imageUrl: imageUrl(item.image_ref),
      qty: Number(item.qty),
      unitPrice: Number(item.unit_price),
      taxRatePct: Number(item.tax_rate_pct),
      lineTotal: Number(item.line_total),
    })),
    timeline: events
      .filter((event) => event.status !== null)
      .map((event) => ({ status: event.status, at: event.recorded_at, reason: event.reason })),
  };
}

function toInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** A refusal the shopper can act on, rather than a bare 400. */
function toCustomerHttp(err: unknown): unknown {
  if (err instanceof OrderError) {
    if (err.code === 'ORDER_NOT_FOUND') {
      return new NotFoundException({
        code: ERROR_CODES.NOT_FOUND,
        message: 'That order does not exist.',
      });
    }
    return new BadRequestException({
      code: ERROR_CODES.VALIDATION_FAILED,
      message: err.message,
      details: { reason: err.code, ...(err.details ?? {}) },
    });
  }
  if (err instanceof CatalogueError) {
    return new BadRequestException({
      code: ERROR_CODES.VALIDATION_FAILED,
      message: err.message,
      details: { reason: err.code },
    });
  }
  return err;
}
