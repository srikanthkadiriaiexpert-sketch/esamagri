import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { AuthModule } from '../auth/auth.module';
import { AnnouncementsController } from './announcements.controller';
import { AnnouncementsService } from './announcements.service';

/**
 * The customer-facing announcement board.
 *
 * It sits beside RikModule and PifModule rather than inside either,
 * because an announcement may be addressed to RIK, to PIF or to
 * everyone, and putting it in one module would make the other import it
 * — which the module boundaries in app.module.ts forbid. SharedModule
 * is the common ground, and `shared.announcements` is a shared-schema
 * table, so the repository comes from there.
 *
 * AuthModule is imported for JwtAuthGuard only.
 */
@Module({
  imports: [SharedModule, AuthModule],
  controllers: [AnnouncementsController],
  providers: [AnnouncementsService],
})
export class AnnouncementsModule {}
