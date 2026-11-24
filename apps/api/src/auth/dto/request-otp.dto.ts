import { IsString, Matches } from 'class-validator';

/** E.164-ish: optional leading +, 8-15 digits, first digit non-zero. */
const MOBILE_NUMBER_PATTERN = /^\+?[1-9]\d{7,14}$/;

export class RequestOtpDto {
  @IsString()
  @Matches(MOBILE_NUMBER_PATTERN, { message: 'mobileNumber must be a valid mobile number' })
  mobileNumber!: string;
}
