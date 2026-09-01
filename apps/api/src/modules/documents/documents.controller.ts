import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgMemberGuard, OrgScopedRequest } from '../auth/org-member.guard';
import { DocumentsService } from './documents.service';

/**
 * Candidate-facing GST documents (subscription charges) — every
 * ownership check runs through DocumentsService.getOwnedByCandidateUser
 * (404, not 403, on a document that isn't theirs — same "don't confirm
 * existence" posture as every other owned-resource lookup in this
 * codebase), never a bare findUnique by id here.
 */
@Controller('documents/me')
@UseGuards(JwtAuthGuard)
export class CandidateDocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest) {
    return this.documents.listForCandidateUser(req.user.sub);
  }

  @Get(':id/download')
  async download(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const document = await this.documents.getOwnedByCandidateUser(req.user.sub, id);
    const url = await this.documents.getDownloadUrl(document);
    return { url };
  }
}

/**
 * Organisation-facing GST documents — will start returning rows once
 * assessment-request documents ship (currently only subscriptions
 * generate documents, and those are always candidate-owned, so this list
 * is empty for every org today; wired up now rather than left as a TODO,
 * since the ownership-scoping logic is identical either way and adding it
 * later would mean touching this same guard/route shape again).
 */
@Controller('documents/org')
@UseGuards(JwtAuthGuard, OrgMemberGuard)
export class OrgDocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  async list(@Req() req: OrgScopedRequest) {
    return this.documents.listForOrg(req.orgId);
  }

  @Get(':id/download')
  async download(@Req() req: OrgScopedRequest, @Param('id') id: string) {
    const document = await this.documents.getOwnedByOrg(req.orgId, id);
    const url = await this.documents.getDownloadUrl(document);
    return { url };
  }
}
