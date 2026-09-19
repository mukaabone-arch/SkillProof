import { Body, Controller, Get, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PortfolioService } from './portfolio.service';
import { SetPortfolioVisibilityDto, UpdatePortfolioContentDto } from './portfolio.dto';

/** Candidate half — their own portfolio draft: view, edit, approve, publish. */
@Controller('portfolio/me')
@UseGuards(JwtAuthGuard)
export class PortfolioController {
  constructor(private readonly svc: PortfolioService) {}

  @Get()
  getMine(@Req() req: AuthenticatedRequest) {
    return this.svc.getMine(req.user.sub);
  }

  @Put()
  updateContent(@Req() req: AuthenticatedRequest, @Body() dto: UpdatePortfolioContentDto) {
    return this.svc.updateContent(req.user.sub, dto);
  }

  /** Marks the current draft reviewed — required before it can ever be shown to an employer, see CandidatePortfolio.approvedAt's doc comment. */
  @Post('approve')
  approve(@Req() req: AuthenticatedRequest) {
    return this.svc.approve(req.user.sub);
  }

  @Put('visibility')
  setVisibility(@Req() req: AuthenticatedRequest, @Body() dto: SetPortfolioVisibilityDto) {
    return this.svc.setVisibility(req.user.sub, dto.visible);
  }
}
