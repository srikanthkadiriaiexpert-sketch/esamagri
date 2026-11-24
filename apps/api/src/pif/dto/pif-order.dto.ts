import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CartLineDto } from './pif-catalogue.dto';

/** Placing an order (PHASE F). Quantities and ids only — see QuoteDto. */
export class CheckoutDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartLineDto)
  lines!: CartLineDto[];

  @IsIn(['PICKUP', 'DELIVERY'])
  fulfillmentMode!: 'PICKUP' | 'DELIVERY';

  @IsOptional()
  @IsUUID()
  deliveryAddressId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  customerNote?: string | null;

  /**
   * The client's own key for this checkout attempt. Sending one means a
   * double tap, a retry or a flaky connection produces ONE order; the
   * second attempt is answered with the first order's number.
   */
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey?: string | null;
}

/**
 * An operational move, recorded by a named staff member.
 *
 * `COD_COLLECTED` is included because cash changing hands at the door is an
 * operational fact the facility needs recorded. It is NOT a billing entry:
 * no bill, invoice or receipt is produced here, and `SALE_FINALIZED` is
 * deliberately not offered, because this application cannot know what the
 * facility's separate billing software did.
 */
export class OrderStatusDto {
  @IsIn([
    'ACCEPTED',
    'PREPARING',
    'READY_PICKED',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'NOT_DELIVERED',
    'COD_COLLECTED',
    'CANCELLED',
  ])
  status!: string;

  /** Mandatory for CANCELLED and NOT_DELIVERED; the service enforces that. */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

export class OrderNoteDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  note!: string;
}
