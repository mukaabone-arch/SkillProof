import { Body, Controller, Get, Header, Param, Post, Req, StreamableFile, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AccountService } from './account.service';
import { DataExportService } from '../data-export/data-export.service';
import { DeactivateAccountDto, DeleteAccountDto } from './account.dto';

@Controller('account')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CANDIDATE)
export class AccountController {
  constructor(
    private readonly svc: AccountService,
    private readonly exports: DataExportService,
  ) {}

  @Get('status')
  status(@Req() req: AuthenticatedRequest) {
    return this.svc.getStatus(req.user.sub);
  }

  @Post('deactivate')
  deactivate(@Req() req: AuthenticatedRequest, @Body() dto: DeactivateAccountDto) {
    return this.svc.deactivate(req.user.sub, dto);
  }

  @Post('reactivate')
  reactivate(@Req() req: AuthenticatedRequest) {
    return this.svc.reactivate(req.user.sub);
  }

  @Post('delete')
  delete(@Req() req: AuthenticatedRequest, @Body() dto: DeleteAccountDto) {
    return this.svc.delete(req.user.sub, dto);
  }

  /** "Download my data" — same family of rights as deactivate/delete above. Generation is asynchronous; this just enqueues (see DataExportJob). */
  @Post('exports')
  requestExport(@Req() req: AuthenticatedRequest) {
    return this.exports.requestExport(req.user.sub);
  }

  @Get('exports')
  listExports(@Req() req: AuthenticatedRequest) {
    return this.exports.listMine(req.user.sub);
  }

  /** Streams the export JSON as an attachment — never a public URL; every download goes through this authenticated, owner-only route. */
  @Get('exports/:id/download')
  @Header('Content-Type', 'application/json')
  async downloadExport(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const { buffer, filename } = await this.exports.downloadExport(req.user.sub, id);
    return new StreamableFile(buffer, { type: 'application/json', disposition: `attachment; filename="${filename}"` });
  }
}
