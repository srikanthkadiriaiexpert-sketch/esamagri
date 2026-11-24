import { IsOptional, IsString, Length, Matches, ValidateIf } from 'class-validator';

/**
 * PIF customer self-registration — request shapes.
 *
 * The same E.164-ish pattern the login DTOs use, deliberately: a resident
 * registers and signs in with one number, and two different patterns would
 * mean a number accepted at registration and refused at login. The SERVICE
 * canonicalises through shared/mobile-number.ts, which is the single
 * implementation RIK officer registration and the eligibility import also use.
 *
 * WHAT THIS COLLECTS, AND WHAT IT REFUSES TO COLLECT
 *
 * Collected: name, mobile number, quarter block, quarter number. That is the
 * whole list, and it is the list the project owner approved — no more was
 * invented.
 *
 * NOT collected, and there is no field for any of them, so
 * `forbidNonWhitelisted` refuses a body that tries:
 *
 *   * `rikId` — a RIK ID is issued by the database to officers only, and a
 *     resident registering for PIF has none. Requirement 3.
 *   * `dietaryPreference` — it stays NULL through registration. It is RIK's
 *     concept, the resident records their own later through their profile, and
 *     the existing ration screen already answers "Please set your dietary
 *     preference before viewing your ration." Requirement 8.
 *   * `isActive`, `officialName`, `createdBy` — staff-controlled columns. A
 *     resident does not get to set their own account status, the facility's
 *     spelling of their name, or who registered them.
 *   * `email`, `serviceNumber`, `rank`, `unit`, `aadhaar`, `pan` — no column
 *     exists for any of them and the specification prohibits them.
 */

/** E.164-ish: optional leading +, 8-15 digits, first digit non-zero. */
const MOBILE_NUMBER_PATTERN = /^\+?[1-9]\d{7,14}$/;
const OTP_CODE_PATTERN = /^\d{6}$/;

export class RequestRegistrationOtpDto {
  @IsString()
  @Matches(MOBILE_NUMBER_PATTERN, { message: 'mobileNumber must be a valid mobile number' })
  mobileNumber!: string;
}

/**
 * TWO WAYS TO PROVE THE NUMBER, AND THEY DO NOT MIX.
 *
 * A registration arrives one of two ways, and the body shape says which:
 *
 *   "Create an account"  → `mobileNumber` + `code`, and NO `registrationTicket`.
 *                          A REGISTER-purpose code, consumed by the service.
 *
 *   Common login         → `registrationTicket` ALONE. The resident already
 *                          verified a LOGIN code; the ticket the server minted
 *                          for them carries the number, signed.
 *
 * WHY THE TICKET PATH FORBIDS A MOBILE NUMBER RATHER THAN IGNORING ONE. The
 * service reads the number out of the ticket either way, so a `mobileNumber`
 * sent alongside a ticket could only be noise or an attempt to steer the
 * registration somewhere else. Accepting and discarding it would leave a body
 * that looks like it was honoured and was not — so it is refused, loudly, and
 * the refusal is a property of the request shape rather than a check the
 * service has to remember.
 *
 * `@ValidateIf` is what makes each field required on its own path and absent
 * on the other. Combined with the controller's `forbidNonWhitelisted`, a body
 * that carries both credentials, or neither, cannot reach the service.
 */
export class RegisterCustomerDto {
  /**
   * The signed proof that this number was verified moments ago on the login
   * screen. Opaque to the client: it is read, verified and expired by the
   * server, and the client's only job is to hand it back unmodified.
   */
  @IsOptional()
  @IsString()
  @Length(20, 512)
  registrationTicket?: string;

  /**
   * Required on the "Create an account" path. `@ValidateIf` turns the
   * requirement off when a ticket is present; the mutual exclusion itself is
   * `registrationCredentialOf` below, because expressing "exactly one of
   * these" in decorators alone produces rules that read as if they apply on
   * both paths and in fact apply on neither.
   */
  @ValidateIf((o: RegisterCustomerDto) => o.registrationTicket === undefined)
  @IsString()
  @Matches(MOBILE_NUMBER_PATTERN, { message: 'mobileNumber must be a valid mobile number' })
  mobileNumber?: string;

  /** Required on the "Create an account" path. See above. */
  @ValidateIf((o: RegisterCustomerDto) => o.registrationTicket === undefined)
  @IsString()
  @Matches(OTP_CODE_PATTERN, { message: 'code must be a 6-digit numeric code' })
  code?: string;

  /**
   * The resident's own display name. Theirs to choose and theirs to change; it
   * is never overwritten by staff, who write `official_name` instead.
   */
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsString()
  @Length(1, 60)
  quarterBlock!: string;

  @IsString()
  @Length(1, 60)
  quarterNumber!: string;
}

/**
 * EXACTLY ONE CREDENTIAL, DECIDED IN ONE PLACE.
 *
 * A pure function, so the rule is unit-testable without a Nest container, a
 * validation pipe or an HTTP request — and so the controller and the service
 * cannot disagree about what a valid body is.
 *
 * Returns the credential, or null when the body carries both or neither. Both
 * is refused rather than resolved by precedence: a request that presents a
 * ticket AND a code has not said which one it wants honoured, and choosing
 * for it would mean silently ignoring a credential the caller believed in.
 */
export function registrationCredentialOf(
  dto: Pick<RegisterCustomerDto, 'registrationTicket' | 'mobileNumber' | 'code'>
):
  | { kind: 'TICKET'; ticket: string }
  | { kind: 'OTP'; mobileNumber: string; code: string }
  | null {
  const hasTicket = typeof dto.registrationTicket === 'string' && dto.registrationTicket !== '';
  const hasOtp =
    typeof dto.mobileNumber === 'string' &&
    dto.mobileNumber !== '' &&
    typeof dto.code === 'string' &&
    dto.code !== '';

  if (hasTicket && hasOtp) return null;
  if (hasTicket) return { kind: 'TICKET', ticket: dto.registrationTicket! };
  if (hasOtp) return { kind: 'OTP', mobileNumber: dto.mobileNumber!, code: dto.code! };
  return null;
}

/**
 * A ticket must not travel with a mobile number, even a matching one.
 *
 * Separate from the above so the refusal can SAY which rule was broken: a
 * body carrying both gets this message, a body carrying neither gets the
 * ordinary "a credential is required". Reported as a validation failure, not
 * as a bad ticket, because the ticket may be perfectly good.
 */
export function hasConflictingCredentials(
  dto: Pick<RegisterCustomerDto, 'registrationTicket' | 'mobileNumber' | 'code'>
): boolean {
  const hasTicket = typeof dto.registrationTicket === 'string' && dto.registrationTicket !== '';
  if (!hasTicket) return false;
  return (
    (typeof dto.mobileNumber === 'string' && dto.mobileNumber !== '') ||
    (typeof dto.code === 'string' && dto.code !== '')
  );
}
