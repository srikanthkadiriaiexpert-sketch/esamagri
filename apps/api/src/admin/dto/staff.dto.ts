import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { STAFF_ROLES, type StaffRole } from '@esamagri/shared-types';

/**
 * Request shapes for Super Admin staff management.
 *
 * A SHAPE GATE, as everywhere else in this codebase. Every route runs the
 * validation pipe with `whitelist` and `forbidNonWhitelisted`, and that is what
 * makes the absences below enforceable rather than decorative.
 *
 * NOTE WHAT CANNOT BE SENT:
 *
 *   * no `passwordHash` — the caller supplies a plaintext password which the
 *     server hashes with bcrypt (PasswordService). A client that could post a
 *     hash directly could post a hash it did not derive, and the password
 *     policy below would govern nothing;
 *   * no `totpSecret` and no `totpEnabled` — two-factor enrolment belongs to
 *     the account holder, not to an administrator, and there is no enrolment
 *     endpoint in this phase (reported as a limitation rather than faked);
 *   * no `permissions` — permissions are attached to ROLES in
 *     shared.role_permissions, by migration. An administrator grants a role;
 *     nobody grants a user an individual permission, because the schema has no
 *     place to put one and inventing one would fork the RBAC model;
 *   * no `id`, `createdAt`, `updatedAt`, `lastLoginAt` — the server's to set;
 *   * no `mobileNumber` — shared.users has no such column (migration 0003, and
 *     no later migration alters that table). Adding one is a schema change,
 *     reported separately rather than assumed.
 *
 * ROLE NAMES COME FROM `STAFF_ROLES`, the TypeScript mirror of shared.roles.
 * A role outside that list is refused here, and the service additionally
 * resolves the name against shared.roles before writing, because the database
 * is the final authority on which roles exist. In particular there is no
 * `RIK_STAFF`: the seeded counter-facing RIK role is `RIK_PICKUP_STAFF`.
 */

/** ACTIVE and SUSPENDED are what an administrator may set. */
export const ASSIGNABLE_STAFF_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type AssignableStaffStatus = (typeof ASSIGNABLE_STAFF_STATUSES)[number];

/**
 * `DISABLED` exists in the `users_status_chk` constraint and is deliberately
 * NOT assignable through this API. Suspension is reversible and is what an
 * administrator needs; a permanent disable is a decision with no undo in the
 * UI, so it stays a database-level action until somebody asks for it by name.
 */
export const ALL_STAFF_STATUSES = ['ACTIVE', 'SUSPENDED', 'DISABLED'] as const;

/**
 * The password policy, in one place so the DTO and the service cannot drift.
 *
 * Length does most of the work; the character-class rule is there because an
 * administrator typing a colleague's first password will otherwise reach for
 * something memorable. The service additionally refuses a password containing
 * the username, which no regex here can see.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_PATTERN =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/;
export const PASSWORD_RULE_MESSAGE =
  'Password must be at least 12 characters and include a lower-case letter, an upper-case letter, a digit and a symbol.';

export class CreateStaffDto {
  /** The person's full name, as it should appear in the portal header. */
  @IsString()
  @Length(2, 120)
  displayName!: string;

  /**
   * The sign-in name. Lower-case letters, digits, dot, dash and underscore
   * only: a username that differs from another only by case or by a trailing
   * space is an account-confusion problem, and `users_username_uq` is
   * case-SENSITIVE, so the format rule is what prevents `A.Kumar` and
   * `a.kumar` both existing.
   */
  @IsString()
  @Length(3, 64)
  @Matches(/^[a-z0-9][a-z0-9._-]*$/, {
    message:
      'Username must be lower-case and may contain only letters, digits, dot, dash and underscore.',
  })
  username!: string;

  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_RULE_MESSAGE })
  password!: string;

  /**
   * Optional at creation. An account with no role resolves to zero
   * permissions and can sign in but reach nothing — a real, valid state the
   * RBAC layer already handles (see UserRolesRepository's own comment), and
   * the safe default if an administrator is unsure which role to give.
   */
  @IsOptional()
  @IsIn(STAFF_ROLES)
  role?: StaffRole;

  @IsOptional()
  @IsIn(ASSIGNABLE_STAFF_STATUSES)
  status?: AssignableStaffStatus;
}

/**
 * What an administrator may edit after the fact: the display name, and nothing
 * else. A username is an identity, not a label — renaming one rewrites who
 * every audit row refers to, so it is not editable here.
 */
export class UpdateStaffDto {
  @IsString()
  @Length(2, 120)
  displayName!: string;
}

export class SetStaffStatusDto {
  @IsIn(ASSIGNABLE_STAFF_STATUSES)
  status!: AssignableStaffStatus;

  /** Why, for the audit row. Required: a suspension should never be mute. */
  @IsString()
  @Length(5, 500)
  reason!: string;
}

export class AssignStaffRoleDto {
  @IsIn(STAFF_ROLES)
  role!: StaffRole;
}

/**
 * A password reset where the ADMINISTRATOR supplies the new password.
 *
 * The server never generates and returns a credential, because a credential
 * in a response body is a credential in a log, a proxy cache and a browser's
 * network panel. The administrator sets a value, conveys it to the person out
 * of band, and the response says only that the reset happened.
 */
export class ResetStaffPasswordDto {
  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_RULE_MESSAGE })
  newPassword!: string;

  @IsString()
  @Length(5, 500)
  reason!: string;
}

export class StaffSearchQueryDto {
  /** Matches display name or username, case-insensitively. */
  @IsOptional()
  @IsString()
  @Length(0, 120)
  q?: string;

  @IsOptional()
  @IsIn(STAFF_ROLES)
  role?: StaffRole;

  @IsOptional()
  @IsIn(ALL_STAFF_STATUSES)
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
