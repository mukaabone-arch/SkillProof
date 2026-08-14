import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
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

  /**
   * Returns a short-lived, single-use download URL — never a public one;
   * only reachable by first hitting this authenticated, owner-only route.
   * The client fetches this JSON, then navigates to `url` directly to
   * download, rather than the API proxying the export's bytes itself.
   */
  @Get('exports/:id/download')
  async downloadExport(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<{ url: string }> {
    return this.exports.downloadExport(req.user.sub, id);
  }
}
