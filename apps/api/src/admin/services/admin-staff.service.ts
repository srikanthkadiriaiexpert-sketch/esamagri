import { Injectable, Logger } from '@nestjs/common';
import type { AuthContext } from '../../auth/auth-context';
import { PasswordService } from '../../auth/services/password.service';
import {
  UsersRepository,
  type StaffAccountRecord,
} from '../../shared/repositories/users.repository';
import { UserRolesRepository } from '../../shared/repositories/user-roles.repository';
import { AuthSessionsRepository } from '../../shared/repositories/auth-sessions.repository';
import { AuditLogRepository } from '../../shared/repositories/audit-log.repository';
import { PASSWORD_RULE_MESSAGE } from '../dto/staff.dto';

export type StaffAdminErrorCode =
  | 'STAFF_NOT_FOUND'
  | 'USERNAME_TAKEN'
  | 'ROLE_UNKNOWN'
  | 'WEAK_PASSWORD'
  | 'NOT_STAFF_PRINCIPAL'
  | 'SELF_STATUS_CHANGE'
  | 'SELF_ROLE_REVOKE'
  | 'LAST_ACTIVE_SUPER_ADMIN';

/** A refusal the controller maps to a specific HTTP status. */
export class StaffAdminError extends Error {
  constructor(
    readonly code: StaffAdminErrorCode,
    message: string,
    readonly detail: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'StaffAdminError';
  }
}

/** A staff account with its live role grants, as the screens render it. */
export interface StaffAccountView {
  id: string;
  username: string;
  displayName: string;
  status: string;
  roles: string[];
  totpEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const SUPER_ADMIN = 'SUPER_ADMIN';
const PG_UNIQUE_VIOLATION = '23505';

/**
 * Super Admin staff management.
 *
 * =====================================================================
 * WHAT THIS ADDS, AND WHAT IT DELIBERATELY REUSES
 * =====================================================================
 *
 * The RBAC model was already complete and is not touched: roles,
 * permissions and their mapping live in shared.roles /
 * shared.permissions / shared.role_permissions exactly as migrations
 * 0019 and 0023 seeded them, and every authorization decision still
 * comes from AuthorizationService reading that graph live. Nothing here
 * invents a role, a permission, or a second place to store either.
 *
 * What was missing was the ability to ACT on it. `shared.user.manage`
 * ("Create/manage staff user accounts") and `shared.role.grant`
 * ("Grant/revoke roles — the only role that can grant other roles")
 * have been seeded since Phase 2 and granted to SUPER_ADMIN alone, and
 * no route had ever required them. This service is the work those two
 * permissions were written for, so no migration is needed and no role
 * gains anything.
 *
 * =====================================================================
 * THE REFUSALS, AND WHY EACH ONE EXISTS
 * =====================================================================
 *
 * THE LAST ACTIVE SUPER ADMIN CANNOT BE SHUT OUT. Suspending the only
 * active SUPER_ADMIN, or revoking SUPER_ADMIN from them, would leave an
 * installation with nobody who can create staff, grant roles or undo
 * the mistake — and no screen could fix it, because fixing it requires
 * the permission that just disappeared. Recovery would mean hand-written
 * SQL against production. The count is taken live, in the database, at
 * the moment of the check.
 *
 * NOBODY CHANGES THEIR OWN STATUS OR DROPS THEIR OWN SUPER_ADMIN. Not
 * because it is dangerous in itself, but because it is the shape most
 * self-lockouts take: an administrator tidying up a staff list and
 * clicking the wrong row. A second administrator can always do it.
 *
 * A ROLE MUST EXIST IN shared.roles. The DTO checks the name against the
 * TypeScript mirror; this service additionally asks the database,
 * because the database is the authority and the mirror can lag. In
 * particular there is no `RIK_STAFF` — the seeded counter-facing RIK
 * role is `RIK_PICKUP_STAFF` — and `DELIVERY_STAFF` carries PIF
 * delivery permissions only. Neither is reinterpreted here.
 *
 * PRIVILEGE ESCALATION IS A PERMISSION QUESTION, ANSWERED AT THE ROUTE.
 * Granting and revoking roles require `shared.role.grant`, which only
 * SUPER_ADMIN holds, so a RIK_ADMIN cannot give themselves or anyone
 * else a role no matter what they post. The controller enforces that
 * with AuthorizationGuard; this service refuses a non-STAFF principal
 * outright as a second line.
 *
 * =====================================================================
 * SECRETS
 * =====================================================================
 *
 * A plaintext password enters this service and leaves as a bcrypt hash;
 * it is never logged, never written to an audit payload, and never
 * returned. `StaffAccountView` has no field for a hash or a TOTP
 * secret, and the repository's administration reads do not select
 * either, so there is no path by which one reaches a response body.
 *
 * Suspending an account and resetting a password both revoke the
 * account's live sessions, because `status` is only checked when
 * somebody signs IN — without that, a suspension would not take effect
 * until the current token happened to expire.
 */
@Injectable()
export class AdminStaffService {
  private readonly logger = new Logger(AdminStaffService.name);

  constructor(
    private readonly users: UsersRepository,
    private readonly userRoles: UserRolesRepository,
    private readonly sessions: AuthSessionsRepository,
    private readonly passwords: PasswordService,
    private readonly auditLog: AuditLogRepository
  ) {}

  // ------------------------------------------------------------- reads

  async listStaff(params: {
    q?: string;
    role?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: StaffAccountView[]; total: number; limit: number; offset: number }> {
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;
    const filters = {
      q: params.q ?? null,
      role: params.role ?? null,
      status: params.status ?? null,
    };

    const [rows, total] = await Promise.all([
      this.users.list({ ...filters, limit, offset }),
      this.users.countMatching(filters),
    ]);
    const roles = await this.userRoles.rolesForUsers(rows.map((row) => row.id));

    return {
      items: rows.map((row) => this.toView(row, roles.get(row.id) ?? [])),
      total,
      limit,
      offset,
    };
  }

  /** One account, with its roles and the permissions those roles confer. */
  async getStaff(userId: string): Promise<StaffAccountView & { permissions: string[] }> {
    const account = await this.users.findAccountById(userId);
    if (!account) throw new StaffAdminError('STAFF_NOT_FOUND', 'No such staff account.');

    const resolved = await this.userRoles.resolveForUser(userId);
    return {
      ...this.toView(account, [...resolved.roles].sort()),
      permissions: [...resolved.permissions].sort(),
    };
  }

  /** Every role the database has, with what each one confers. */
  async listRoles(): Promise<Array<{ name: string; description: string | null; permissions: string[] }>> {
    return this.userRoles.listRolesWithPermissions();
  }

  // ------------------------------------------------------------ writes

  async createStaff(
    actor: AuthContext,
    input: {
      username: string;
      displayName: string;
      password: string;
      role?: string;
      status?: string;
    }
  ): Promise<StaffAccountView> {
    this.requireStaffActor(actor);
    this.assertPasswordAcceptable(input.password, input.username);

    if (input.role !== undefined && !(await this.userRoles.roleExists(input.role))) {
      throw new StaffAdminError('ROLE_UNKNOWN', `No such role: ${input.role}.`, { role: input.role });
    }

    const passwordHash = await this.passwords.hash(input.password);
    let account: StaffAccountRecord;
    try {
      account = await this.users.create({
        username: input.username,
        passwordHash,
        displayName: input.displayName,
        status: input.status ?? 'ACTIVE',
        createdBy: actor.principalId,
      });
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        throw new StaffAdminError('USERNAME_TAKEN', 'That username is already in use.', {
          username: input.username,
        });
      }
      throw err;
    }

    await this.audit(actor, 'STAFF_ACCOUNT_CREATED', account.id, {
      username: account.username,
      displayName: account.display_name,
      status: account.status,
    });

    const granted: string[] = [];
    if (input.role !== undefined) {
      await this.userRoles.grant({ userId: account.id, roleName: input.role, grantedBy: actor.principalId });
      granted.push(input.role);
      await this.audit(actor, 'STAFF_ROLE_GRANTED', account.id, { role: input.role, atCreation: true });
    }

    this.logger.log(`Staff account ${account.username} created by ${actor.principalId}`);
    return this.toView(account, granted);
  }

  async updateStaff(
    actor: AuthContext,
    userId: string,
    input: { displayName: string }
  ): Promise<StaffAccountView> {
    this.requireStaffActor(actor);
    const before = await this.users.findAccountById(userId);
    if (!before) throw new StaffAdminError('STAFF_NOT_FOUND', 'No such staff account.');

    const updated = await this.users.updateDisplayName(userId, input.displayName);
    if (!updated) throw new StaffAdminError('STAFF_NOT_FOUND', 'No such staff account.');

    await this.audit(
      actor,
      'STAFF_ACCOUNT_UPDATED',
      userId,
      { displayName: updated.display_name },
      { displayName: before.display_name }
    );

    const roles = await this.userRoles.rolesForUsers([userId]);
    return this.toView(updated, roles.get(userId) ?? []);
  }

  async setStatus(
    actor: AuthContext,
    userId: string,
    input: { status: string; reason: string }
  ): Promise<StaffAccountView> {
    this.requireStaffActor(actor);

    if (userId === actor.principalId) {
      throw new StaffAdminError(
        'SELF_STATUS_CHANGE',
        'You cannot change your own account status. Ask another Super Admin to do it.'
      );
    }

    const before = await this.users.findAccountById(userId);
    if (!before) throw new StaffAdminError('STAFF_NOT_FOUND', 'No such staff account.');

    if (input.status !== 'ACTIVE') {
      await this.assertNotLastActiveSuperAdmin(userId, before.status, 'suspended');
    }

    const updated = await this.users.updateStatus(userId, input.status);
    if (!updated) throw new StaffAdminError('STAFF_NOT_FOUND', 'No such staff account.');

    let revokedSessions = 0;
    if (input.status !== 'ACTIVE') {
      revokedSessions = await this.sessions.revokeAllForPrincipal('STAFF', userId);
    }

    await this.audit(
      actor,
      'STAFF_STATUS_CHANGED',
      userId,
      { status: updated.status, reason: input.reason, revokedSessions },
      { status: before.status }
    );

    const roles = await this.userRoles.rolesForUsers([userId]);
    return this.toView(updated, roles.get(userId) ?? []);
  }

  async assignRole(actor: AuthContext, userId: string, roleName: string): Promise<StaffAccountView> {
    this.requireStaffActor(actor);

    const account = await this.users.findAccountById(userId);
    if (!account) throw new StaffAdminError('STAFF_NOT_FOUND', 'No such staff account.');

    if (!(await this.userRoles.roleExists(roleName))) {
      throw new StaffAdminError('ROLE_UNKNOWN', `No such role: ${roleName}.`, { role: roleName });
    }

    const changed = await this.userRoles.grant({ userId, roleName, grantedBy: actor.principalId });
    if (changed) {
      await this.audit(actor, 'STAFF_ROLE_GRANTED', userId, { role: roleName });
    }

    const roles = await this.userRoles.rolesForUsers([userId]);
    return this.toView(account, roles.get(userId) ?? []);
  }

  async revokeRole(actor: AuthContext, userId: string, roleName: string): Promise<StaffAccountView> {
    this.requireStaffActor(actor);

    const account = await this.users.findAccountById(userId);
    if (!account) throw new StaffAdminError('STAFF_NOT_FOUND', 'No such staff account.');

    if (roleName === SUPER_ADMIN) {
      if (userId === actor.principalId) {
        throw new StaffAdminError(
          'SELF_ROLE_REVOKE',
          'You cannot remove your own Super Admin role. Ask another Super Admin to do it.'
        );
      }
      await this.assertNotLastActiveSuperAdmin(userId, account.status, 'left without the Super Admin role');
    }

    const changed = await this.userRoles.revoke({ userId, roleName });
    if (changed) {
      await this.audit(actor, 'STAFF_ROLE_REVOKED', userId, { role: roleName });
    }

    const roles = await this.userRoles.rolesForUsers([userId]);
    return this.toView(account, roles.get(userId) ?? []);
  }

  /**
   * Replaces an account's password with one the administrator supplies, and
   * revokes that account's live sessions so the old credential stops working
   * immediately rather than at token expiry.
   *
   * The new password is never returned. The administrator already knows it —
   * they chose it — and a credential in a response body is a credential in
   * every log and proxy between here and their browser.
   */
  async resetPassword(
    actor: AuthContext,
    userId: string,
    input: { newPassword: string; reason: string }
  ): Promise<{ userId: string; revokedSessions: number }> {
    this.requireStaffActor(actor);

    const account = await this.users.findAccountById(userId);
    if (!account) throw new StaffAdminError('STAFF_NOT_FOUND', 'No such staff account.');

    this.assertPasswordAcceptable(input.newPassword, account.username);

    const passwordHash = await this.passwords.hash(input.newPassword);
    const updated = await this.users.updatePasswordHash(userId, passwordHash);
    if (!updated) throw new StaffAdminError('STAFF_NOT_FOUND', 'No such staff account.');

    const revokedSessions = await this.sessions.revokeAllForPrincipal('STAFF', userId);

    // The payload records THAT a reset happened and what it cost the user in
    // sessions. It must never carry the password, or any part of it.
    await this.audit(actor, 'STAFF_PASSWORD_RESET', userId, {
      reason: input.reason,
      revokedSessions,
    });

    this.logger.log(`Password reset for staff ${account.username} by ${actor.principalId}`);
    return { userId, revokedSessions };
  }

  // ------------------------------------------------------------ helpers

  private toView(account: StaffAccountRecord, roles: readonly string[]): StaffAccountView {
    return {
      id: account.id,
      username: account.username,
      displayName: account.display_name,
      status: account.status,
      roles: [...roles],
      totpEnabled: account.totp_enabled,
      lastLoginAt: account.last_login_at === null ? null : account.last_login_at.toISOString(),
      createdAt: account.created_at.toISOString(),
      updatedAt: account.updated_at.toISOString(),
    };
  }

  private requireStaffActor(actor: AuthContext): void {
    if (actor.principalType !== 'STAFF') {
      throw new StaffAdminError('NOT_STAFF_PRINCIPAL', 'Only a staff principal may manage staff accounts.');
    }
  }

  /**
   * Refuses a change that would leave no active SUPER_ADMIN.
   *
   * Only bites when the target currently holds SUPER_ADMIN and is currently
   * ACTIVE — an already-suspended Super Admin is not propping anything up, and
   * suspending a second one while a first is active is fine.
   */
  private async assertNotLastActiveSuperAdmin(
    userId: string,
    currentStatus: string,
    whatWouldHappen: string
  ): Promise<void> {
    if (currentStatus !== 'ACTIVE') return;

    const resolved = await this.userRoles.resolveForUser(userId);
    if (!resolved.roles.includes(SUPER_ADMIN)) return;

    const activeSuperAdmins = await this.users.countActiveWithRole(SUPER_ADMIN);
    if (activeSuperAdmins <= 1) {
      throw new StaffAdminError(
        'LAST_ACTIVE_SUPER_ADMIN',
        `This is the only active Super Admin account. If it were ${whatWouldHappen}, nobody could ` +
          'manage staff or grant roles. Give another account the Super Admin role first.',
        { activeSuperAdmins }
      );
    }
  }

  /**
   * The one password rule a regex in the DTO cannot express: the password must
   * not contain the username. `admin / admin@2026!` passes every character
   * class and is the first thing anybody guesses.
   */
  private assertPasswordAcceptable(password: string, username: string): void {
    const normalized = password.toLowerCase();
    const user = username.toLowerCase();
    if (user.length >= 3 && normalized.includes(user)) {
      throw new StaffAdminError(
        'WEAK_PASSWORD',
        'The password must not contain the username. ' + PASSWORD_RULE_MESSAGE
      );
    }
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: unknown }).code === PG_UNIQUE_VIOLATION
    );
  }

  private async audit(
    actor: AuthContext,
    action: string,
    entityId: string,
    after: Record<string, unknown>,
    before?: Record<string, unknown>
  ): Promise<void> {
    await this.auditLog.logEvent({
      actorId: actor.principalId,
      actorRole: [...actor.roles].sort().join(',') || null,
      module: 'shared',
      action,
      entityType: 'shared.users',
      entityId,
      before,
      after,
    });
  }
}
