import { ExportRequestStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

/** Compliance Center / Data Exports admin filter — same shape convention as ListAccountActionsQueryDto. */
export class ListExportRequestsQueryDto {
  @IsOptional()
  @IsEnum(ExportRequestStatus)
  status?: ExportRequestStatus;
}
