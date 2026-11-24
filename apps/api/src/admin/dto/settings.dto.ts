import { IsBoolean } from 'class-validator';

/**
 * The PIF self-registration switch.
 *
 * `@IsBoolean()` AND NOT A COERCING VALIDATOR, deliberately. The
 * controller's ValidationPipe runs with `transform: true`, so a coercing
 * decorator would accept the string "false" and turn it into something
 * truthy on its way to a control that opens a public endpoint. Requiring
 * a real JSON boolean means a client that sends `"false"` is refused with
 * a 400 rather than silently enabling registration.
 *
 * `forbidNonWhitelisted` on the same pipe rejects any extra property, so
 * this payload cannot smuggle a second field — a `key`, for instance —
 * into the settings write. The key is chosen by the server, never by the
 * caller.
 */
export class SetPifSelfRegistrationDto {
  @IsBoolean()
  enabled!: boolean;
}
