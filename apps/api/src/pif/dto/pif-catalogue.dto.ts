import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * The shapes the PIF catalogue accepts (PHASE F).
 *
 * The controllers run with `whitelist` and `forbidNonWhitelisted`, so a field
 * that is not declared here is not ignored — the request is refused. That is
 * deliberate for a catalogue screen: an extra "stockQty" or "isPaid" in a
 * body should be a visible mistake, not a silent one.
 *
 * These are SHAPE guards only. Whether a SKU is free, a tax rate exists, a
 * category is active or a price is sane is PifCatalogueService's, and the
 * database has the final word on all of it.
 */

export class CategoryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ProductDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  sku!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  barcode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  brand?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  unit!: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  packSize?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  packUnit?: string | null;

  /** Rupees and paise. Two decimal places, never negative. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  sellingPrice!: number;

  /**
   * Optional, and only because the frozen schema already carries the column.
   * This module does no purchasing: nothing reads it, and no screen shows it
   * to a customer.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  purchasePrice?: number | null;

  @IsOptional()
  @IsUUID()
  taxRateId?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  discountPct?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  minOrderQty?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  maxOrderQty?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  qtyStep?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  available?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  variantGroup?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  variantLabel?: string | null;
}

export class ProductFlagsDto {
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  available?: boolean;
}

export class ProductPriceDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  sellingPrice!: number;

  @IsOptional()
  @IsUUID()
  taxRateId?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  discountPct?: number | null;
}

export class TaxRateDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  ratePct!: number;
}

export class CartLineDto {
  @IsUUID()
  productId!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  qty!: number;
}

/**
 * A quote, or a checkout. NOTE WHAT IS ABSENT: there is no price, no total,
 * no tax and no product name here, and adding one would be refused by
 * `forbidNonWhitelisted`. The client sends what it wants and how much of it;
 * every figure is the server's.
 */
export class QuoteDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartLineDto)
  lines!: CartLineDto[];

  /**
   * How the order would reach the customer, because the delivery charge
   * depends on it: store pickup is always free. OPTIONAL, defaulting to
   * DELIVERY in the service — the cart screen has no pickup/delivery choice
   * on it, and quoting the charged case there is the honest default: a
   * shopper who later chooses pickup sees the charge disappear, rather than
   * one who expected free delivery discovering a fee at checkout.
   *
   * It contributes to the arithmetic only by selecting a rule. The fee and
   * the threshold are the server's, in PifPricingService.
   */
  @IsOptional()
  @IsIn(['PICKUP', 'DELIVERY'])
  fulfillmentMode?: 'PICKUP' | 'DELIVERY';
}
