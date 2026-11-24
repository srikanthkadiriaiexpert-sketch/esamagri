import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { AuthModule } from '../auth/auth.module';
import { CustomerController } from './customer.controller';
import { CustomerProfileService } from './services/customer-profile.service';

/**
 * The customer's own account surface (STEP 9) — profile read/update
 * over the frozen `shared.customers` + `shared.customer_addresses`
 * tables.
 *
 * Sits alongside RikModule and PifModule rather than inside either,
 * because a customer's identity and residence belong to neither
 * module: both consume it, and the RIK/PIF separation rule
 * ("RikModule must NEVER import PifModule") stays intact precisely
 * because this shared customer concern has its own home.
 *
 * Imports AuthModule for the guards (JwtAuthGuard, AuthorizationGuard)
 * and SharedModule for the shared.* repositories; it owns no database
 * connection and no schema of its own.
 *
 * Deliberately NOT here: RIK entitlement, PIF catalogue/cart/order
 * engines, notifications delivery and the admin surface — each is
 * assigned to its own later phase in docs/implementation-backlog.md.
 */
@Module({
  imports: [SharedModule, AuthModule],
  controllers: [CustomerController],
  providers: [CustomerProfileService],
  exports: [CustomerProfileService],
})
export class CustomerModule {}
