import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Paging and filtering a stored import preview (LAUNCH PREPARATION).
 *
 * The upload itself carries no fields to validate — it is a file — so the
 * only request shape the import needs to police is this one. `verdict` lets
 * the preview screen show "just the problems", which is the view an operator
 * actually wants in front of a four-hundred-row file.
 */
export class ImportRowsQueryDto {
  @IsOptional()
  @IsIn(['CREATE', 'UPDATE', 'INVALID'])
  verdict?: 'CREATE' | 'UPDATE' | 'INVALID';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
