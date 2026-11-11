import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Role } from '@prisma/client';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { OrgMemberGuard, OrgScopedRequest } from '../../auth/org-member.guard';
import { OrgSetupCompleteGuard } from '../../auth/org-setup-complete.guard';
import { OrgVerifiedGuard } from '../../auth/org-verified.guard';
import { JobImportService } from './job-import.service';
import { MAX_IMPORT_ROWS, templateCsv } from './job-csv';

const MAX_FILE_BYTES = 2 * 1024 * 1024;

const CSV_UPLOAD = {
  storage: memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (_req: unknown, file: Express.Multer.File, cb: (err: Error | null, accept: boolean) => void) => {
    const name = file.originalname.toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      return cb(new BadRequestException('Save the sheet as "CSV UTF-8" in Excel or Google Sheets, then upload that file.'), false);
    }
    if (!name.endsWith('.csv')) return cb(new BadRequestException('Upload a .csv file made from the template.'), false);
    cb(null, true);
  },
};

export class PublishImportedJobsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_IMPORT_ROWS)
  @IsUUID('4', { each: true })
  jobIds: string[];
}

/**
 * Bulk job import — same guards and roles as JobsController (a verified,
 * set-up employer org). Upload creates drafts only; publish posts the ready
 * ones. See JobImportService.
 */
@Controller('jobs/import')
@UseGuards(JwtAuthGuard, RolesGuard, OrgMemberGuard, OrgSetupCompleteGuard, OrgVerifiedGuard)
@Roles(Role.EMPLOYER_ADMIN, Role.EMPLOYER_MEMBER)
export class JobImportController {
  constructor(private readonly svc: JobImportService) {}

  @Get('template')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="myambii-jobs-template.csv"')
  template() {
    // A BOM so Excel opens it as UTF-8 (₹, accented names).
    return `﻿${templateCsv()}`;
  }

  @Post()
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', CSV_UPLOAD))
  upload(@Req() req: OrgScopedRequest, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Choose a CSV file to upload.');
    return this.svc.importCsv(req.orgId, req.user.sub, file.buffer);
  }

  @Post('publish')
  @HttpCode(200)
  publish(@Req() req: OrgScopedRequest, @Body() dto: PublishImportedJobsDto) {
    return this.svc.publish(req.orgId, dto.jobIds);
  }

  @Get(':batchId')
  batch(@Req() req: OrgScopedRequest, @Param('batchId', new ParseUUIDPipe()) batchId: string) {
    return this.svc.batch(req.orgId, batchId);
  }
}
