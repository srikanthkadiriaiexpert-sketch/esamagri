import { IsIn, IsOptional, IsString, Length, ValidateIf } from 'class-validator';

/**
 * The only customer-editable profile fields (spec ACC-1): display name
 * and quarter/residence. Every property is optional so the client can
 * PATCH one without resending the other, but residence is validated as
 * a PAIR — `shared.customer_addresses` declares quarter_block and
 * quarter_number NOT NULL, so accepting one without the other would
 * mean writing an empty string to satisfy the constraint. That is
 * rejected as VALIDATION_FAILED instead.
 *
 * `mobileNumber` is deliberately absent: it is the identity STEP 6
 * authenticates against, so changing it is account recovery, not a
 * profile edit. The policy for that is a NEW BUSINESS DECISION
 * REQUIRED item surfaced during STEP 9 (proposed/open, not ratified,
 * not implemented). A client sending the field is rejected by the
 * whitelist/forbidNonWhitelisted validation rather than silently
 * ignored.
 *
 * No Aadhaar, PAN, service number, rank, unit or family field appears
 * here, per the specification's explicit prohibition.
 */
export class UpdateCustomerProfileDto {
  @IsOptional()
  @IsString()
  @Length(1, 120, { message: 'name must be between 1 and 120 characters' })
  name?: string;

  /**
   * The officer's own dietary preference (STEP 11E).
   *
   * Added because the alternative was worse: until now this column
   * could only be set by SQL, so an officer whose preference had never
   * been recorded saw a prompt they had no way to satisfy.
   *
   * It governs FUTURE entitlement only. A confirmed selection carries
   * its own basis and rule snapshot, and the database refuses to
   * rewrite either — so no change here can restate a past issue.
   *
   * WHAT IS NOT DECIDED HERE: what should happen to an OPEN draft, or
   * to an entitlement already part-consumed, when the preference
   * changes mid-period. The specification does not say, and a pro-rata
   * rule invented in a DTO would be a business rule nobody approved.
   * Today the next calculation simply uses the new preference and any
   * line that no longer fits is refused on its next validation.
   */
  @IsOptional()
  @IsIn(['PV', 'EV', 'NV'], { message: 'dietaryPreference must be PV, EV or NV' })
  dietaryPreference?: 'PV' | 'EV' | 'NV';

  /** Required whenever quarterNumber is supplied — the pair is written together. */
  @ValidateIf((dto: UpdateCustomerProfileDto) => dto.quarterNumber !== undefined || dto.quarterBlock !== undefined)
  @IsString()
  @Length(1, 60, { message: 'quarterBlock must be between 1 and 60 characters' })
  quarterBlock?: string;

  /** Required whenever quarterBlock is supplied — the pair is written together. */
  @ValidateIf((dto: UpdateCustomerProfileDto) => dto.quarterBlock !== undefined || dto.quarterNumber !== undefined)
  @IsString()
  @Length(1, 60, { message: 'quarterNumber must be between 1 and 60 characters' })
  quarterNumber?: string;

  @IsOptional()
  @IsString()
  @Length(0, 120, { message: 'landmark must be 120 characters or fewer' })
  landmark?: string;

  @IsOptional()
  @IsString()
  @Length(0, 60, { message: 'label must be 60 characters or fewer' })
  label?: string;
}
