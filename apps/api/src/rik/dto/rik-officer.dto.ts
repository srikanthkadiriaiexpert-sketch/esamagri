import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Request shapes for officer administration (STEP 15B Phase A).
 *
 * RECONSTRUCTED from the approved Phase A report after the working container
 * was lost; not the recovered original bytes.
 *
 * A SHAPE gate, not the business rules — the same division of labour as
 * rik-admin-config.dto.ts. Every controller route runs the pipe with
 * `whitelist` and `forbidNonWhitelisted`, which is what makes the PROHIBITED
 * fields enforceable: a body carrying `serviceNumber`, `rank`, `unit`,
 * `aadhaar`, `pan`, `eligibleDays` or `rikId` is refused outright, because no
 * DTO here declares them.
 *
 * The rules that matter — mobile normalisation, duplicate refusal, blank and
 * length checks, the dietary-preference set — live in RikOfficerService and
 * are exercised through HTTP. `@Length` appears below only where the server's
 * own message would be identical, and the service still re-checks every one,
 * so no rule has exactly one home.
 */

export class RegisterOfficerDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  /** Normalised by the service; accepted here in any of its written forms. */
  @IsString()
  @Length(1, 20)
  mobileNumber!: string;

  @IsString()
  @Length(1, 60)
  quarterBlock!: string;

  @IsString()
  @Length(1, 60)
  quarterNumber!: string;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  landmark?: string;

  /**
   * OPTIONAL HERE, CONDITIONALLY REQUIRED IN THE SERVICE.
   *
   * Mandatory when registering a NEW officer; ignored when linking a resident
   * who already has an account, whose own preference is never overwritten
   * (approved decisions T2-2 and T2-9). The shape gate cannot express that,
   * because which path applies is only known after the mobile number has been
   * canonicalised and looked up. RikOfficerService.register() enforces it, and
   * still rejects a value outside the set on the registration path, so the
   * rule has not been weakened — only moved to where the information is.
   */
  @IsOptional()
  @IsIn(['PV', 'EV', 'NV'])
  dietaryPreference?: 'PV' | 'EV' | 'NV';
}

export class SetOfficerActiveDto {
  @IsBoolean()
  isActive!: boolean;
}

export class OfficerListQueryDto {
  @IsOptional()
  @IsString()
  @Length(0, 120)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
