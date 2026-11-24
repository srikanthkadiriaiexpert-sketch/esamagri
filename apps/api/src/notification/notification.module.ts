import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OtpSmsService } from './otp-sms.service';
import { SmsGatewayHubProvider } from './smsgatewayhub.provider';

/**
 * Notification infrastructure: PIF new-order alerts (visual + audible
 * buzzer where permitted, always with a visible fallback), customer
 * order-status notifications, and the WhatsApp Business Platform
 * integration boundary (official API only — never browser automation
 * or a QR-session library; see @esamagri/config's api-env.ts for the
 * WHATSAPP_* settings this module will read).
 *
 * CARRIES ONE SMS PROVIDER: SMS Gateway Hub. OtpSmsService is the port
 * AuthModule injects and calls for every code it issues;
 * SmsGatewayHubProvider is the transport behind it, and is registered
 * here but NOT exported — nothing outside this module should be able to
 * send an SMS without going through the port, which is what decides
 * whether a channel is selected at all.
 *
 * The provider is TRANSPORT ONLY — the code is generated, hashed and
 * verified by AuthModule, and this module holds no verification logic of
 * any kind. See the service, and @esamagri/config's api-env.ts, for why
 * the provider's own AUTOGEN/VERIFY flow is not to be adopted: the OTP
 * sent is OUR code, and shared.otp_requests.otp_hash holds its HMAC.
 *
 * The outbox/retry/deduplication architecture (shared.notification_outbox)
 * is still to come, alongside the order-status channels. OtpSmsService
 * does not write to that table yet: an OTP send is attempted once,
 * immediately, and its outcome is audited by the caller — a queue would
 * add a second place where a code could sit waiting, which is the
 * opposite of what a one-time code wants.
 *
 * When no provider is available, a provider boundary here must isolate
 * itself safely (log only) rather than fabricate a successful send —
 * never a fake "delivered" notification presented as real. OtpSmsService
 * reports DISABLED when no channel is selected, a logged,
 * caller-audited FAILED/NO_PROVIDER when a channel with no transport
 * is, and SENT only on the word of the gateway itself.
 */
@Module({
  imports: [ConfigModule],
  providers: [OtpSmsService, SmsGatewayHubProvider],
  exports: [OtpSmsService],
})
export class NotificationModule {}
