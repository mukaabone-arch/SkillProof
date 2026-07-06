import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrgMemberGuard } from '../auth/org-member.guard';
import { CandidatesService } from './candidates.service';
import { SearchCandidatesDto } from './candidates.dto';

@Controller('candidates')
@UseGuards(JwtAuthGuard, RolesGuard, OrgMemberGuard)
@Roles(Role.EMPLOYER_ADMIN, Role.EMPLOYER_MEMBER)
export class CandidatesController {
  constructor(private readonly svc: CandidatesService) {}

  @Get('search')
  search(@Query() dto: SearchCandidatesDto) {
    return this.svc.search(dto);
  }
}
