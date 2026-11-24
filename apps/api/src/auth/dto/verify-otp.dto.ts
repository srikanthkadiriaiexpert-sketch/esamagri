import { IsString, Matches } from 'class-validator';

const MOBILE_NUMBER_PATTERN = /^\+?[1-9]\d{7,14}$/;
const OTP_CODE_PATTERN = /^\d{6}$/;

export class VerifyOtpDto {
  @IsString()
  @Matches(MOBILE_NUMBER_PATTERN, { message: 'mobileNumber must be a valid mobile number' })
  mobileNumber!: string;

  @IsString()
  @Matches(OTP_CODE_PATTERN, { message: 'code must be a 6-digit numeric code' })
  code!: string;
}
