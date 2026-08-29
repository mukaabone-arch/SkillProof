import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { randomUUID } from 'crypto';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard, AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrgMemberGuard, OrgScopedRequest } from '../auth/org-member.guard';
import { STORAGE_SERVICE, StorageService } from '../../storage/storage.interface';
import { OrgsService } from './orgs.service';
import { DeactivateOrgDto, UpdateOrgDto } from './orgs.dto';

const MAX_LOGO_BYTES = 5 * 1024 * 1024;

/** Same convention as ProfilesController's PHOTO_EXTENSION_BY_MIME — fileFilter below rejects anything else before this callback ever runs. */
const LOGO_EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

@Controller('orgs')
export class OrgsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly svc: OrgsService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: AuthenticatedRequest) {
    const membership = await this.prisma.orgMember.findUnique({
      where: { userId: req.user.sub },
      include: { organization: true },
    });
    if (!membership) throw new NotFoundException('No organization found for this account.');

    const { logoKey, ...organization } = membership.organization;
    return {
      organization: { ...organization, hasLogo: logoKey != null },
      role: req.user.role,
    };
  }

  /**
   * Editing org info spends nothing and changes nothing another member
   * relies on the same way seats/roles do, but it's still org-identity
   * data — admin-only, same dividing line OrgMembersController draws for
   * every mutation on that controller.
   */
  @Patch('me')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgMemberGuard)
  @Roles(Role.EMPLOYER_ADMIN)
  updateMe(@Req() req: OrgScopedRequest, @Body() dto: UpdateOrgDto) {
    return this.svc.update(req.orgId, dto);
  }

  /**
   * Submits (or resubmits, after a rejection) this org for admin review —
   * see OrgsService.submitForVerification. Admin-only for the same reason
   * as updateMe: org-identity data, not a per-seat action.
   */
  @Post('me/verification/submit')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgMemberGuard)
  @Roles(Role.EMPLOYER_ADMIN)
  submitVerification(@Req() req: OrgScopedRequest) {
    return this.svc.submitForVerification(req.orgId, req.user.sub);
  }

  /** Concrete-consequence numbers for the deactivation confirmation UI — see OrgsService.previewDeactivationImpact. */
  @Get('me/deactivation-preview')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgMemberGuard)
  @Roles(Role.EMPLOYER_ADMIN)
  previewDeactivation(@Req() req: OrgScopedRequest) {
    return this.svc.previewDeactivationImpact(req.orgId);
  }

  /**
   * Immediate, no approval workflow — see OrgsService.deactivate. Admin-only:
   * this blocks the whole org, not just the caller's own seat.
   */
  @Post('me/deactivate')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgMemberGuard)
  @Roles(Role.EMPLOYER_ADMIN)
  deactivate(@Req() req: OrgScopedRequest, @Body() dto: DeactivateOrgDto) {
    return this.svc.deactivate(req.orgId, req.user.sub, dto);
  }

  @Post('me/logo')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgMemberGuard)
  @Roles(Role.EMPLOYER_ADMIN)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_LOGO_BYTES },
      fileFilter: (_req, file, cb) => {
        if (!(file.mimetype in LOGO_EXTENSION_BY_MIME)) {
          return cb(new BadRequestException('Only JPEG, PNG, or WebP images are accepted'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadLogo(@Req() req: OrgScopedRequest, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    // Bare storage key, same convention as ProfilesController.uploadPhoto —
    // resolved against the configured backend wherever it's read back.
    const key = `${randomUUID()}${LOGO_EXTENSION_BY_MIME[file.mimetype]}`;
    await this.storage.write(key, file.buffer, file.mimetype);
    return this.svc.saveLogo(req.orgId, key);
  }

  @Delete('me/logo')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgMemberGuard)
  @Roles(Role.EMPLOYER_ADMIN)
  deleteLogo(@Req() req: OrgScopedRequest) {
    return this.svc.deleteLogo(req.orgId);
  }

  /**
   * Proxy-serve only — the stored key is never handed to a client (see
   * * OrgsService's withHasLogo). Scoped to the caller's own org via the JWT —
   * there's no org ID in the path, so there's no cross-org surface to guard.
   */
  @Get('me/logo')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgMemberGuard)
  @Roles(Role.EMPLOYER_ADMIN, Role.EMPLOYER_MEMBER)
  async getLogo(@Req() req: OrgScopedRequest) {
    const { buffer, contentType } = await this.svc.getLogoForViewing(req.orgId);
    return new StreamableFile(buffer, { type: contentType, disposition: 'inline' });
  }
}
