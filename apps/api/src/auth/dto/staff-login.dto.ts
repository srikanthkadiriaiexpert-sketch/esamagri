import { IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class StaffLoginDto {
  @IsString()
  @MinLength(1)
  username!: string;

  @IsString()
  @MinLength(1)
  password!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'totpCode must be a 6-digit numeric code' })
  totpCode?: string;
}
