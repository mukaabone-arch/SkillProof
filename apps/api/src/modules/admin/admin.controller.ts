import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdminService } from './admin.service';
import { AccountService } from '../account/account.service';
import { DataExportService } from '../data-export/data-export.service';
import { ListExportRequestsQueryDto } from '../data-export/data-export.dto';
import { BillingProfilesService } from '../billing/billing-profiles.service';
import { TransactionsService } from '../billing/transactions.service';
import {
  AmendTransactionDto,
  AttachProviderReferenceDto,
  CreateBillingProfileDto,
  CreateTransactionDto,
  UpdateBillingProfileDto,
  UpdateTransactionStatusDto,
} from '../billing/billing.dto';
import {
  CreateAssessmentDto,
  CreateQuestionDto,
  ListAccountActionsQueryDto,
  ListAttemptsQueryDto,
  ReviewAttemptDto,
  SetSubscriptionDto,
  UpdateAssessmentDto,
} from './admin.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.PLATFORM_ADMIN)
export class AdminController {
  constructor(
    private readonly svc: AdminService,
    private readonly account: AccountService,
    private readonly dataExport: DataExportService,
    private readonly billingProfiles: BillingProfilesService,
    private readonly transactions: TransactionsService,
  ) {}

  /** Compliance Center / Privacy Requests — see AccountService.listActionsForAdmin's own doc comment for exactly what each derived field does and doesn't claim. */
  @Get('account-actions')
  listAccountActions(@Query() query: ListAccountActionsQueryDto) {
    return this.account.listActionsForAdmin(query);
  }

  @Get('assessments')
  list() {
    return this.svc.listAssessments();
  }

  @Post('assessments')
  create(@Body() dto: CreateAssessmentDto) {
    return this.svc.createAssessment(dto);
  }

  @Patch('assessments/:id')
  update(@Param('id') id: string, @Body() dto: UpdateAssessmentDto) {
    return this.svc.updateAssessment(id, dto);
  }

  @Post('assessments/:id/questions')
  addQuestion(@Param('id') id: string, @Body() dto: CreateQuestionDto) {
    return this.svc.addQuestion(id, dto);
  }

  /** Body is a bare JSON array, not a wrapped object — validated item-by-item in the service. */
  @Post('assessments/:id/questions/bulk')
  bulkAddQuestions(@Param('id') id: string, @Body() body: unknown) {
    return this.svc.bulkAddQuestions(id, body);
  }

  @Delete('questions/:id')
  removeQuestion(@Param('id') id: string) {
    return this.svc.removeQuestion(id);
  }

  /** Review queue — GET /admin/attempts?status=FLAGGED lists attempts needing a decision. */
  @Get('attempts')
  listAttempts(@Query() query: ListAttemptsQueryDto) {
    return this.svc.listAttemptsForReview(query);
  }

  /** Admin-only attempt review — includes integrity data never shown to the candidate. */
  @Get('attempts/:id')
  getAttempt(@Param('id') id: string) {
    return this.svc.getAttemptForReview(id);
  }

  /** The only path that can invalidate an attempt/badge — never automatic. */
  @Patch('attempts/:id/review')
  reviewAttempt(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: ReviewAttemptDto,
  ) {
    return this.svc.reviewAttempt(id, req.user.sub, dto);
  }

  /** Foundation work for testing entitlements before any payment provider exists — see EntitlementsModule's README. */
  @Post('candidates/:candidateProfileId/subscription')
  setSubscription(@Param('candidateProfileId') candidateProfileId: string, @Body() dto: SetSubscriptionDto) {
    return this.svc.setSubscription(candidateProfileId, dto);
  }

  /** Compliance Center / Data Exports — status and timestamps only, never the exported content. See DataExportService.listForAdmin's own doc comment. */
  @Get('export-requests')
  listExportRequests(@Req() req: AuthenticatedRequest, @Query() query: ListExportRequestsQueryDto) {
    return this.dataExport.listForAdmin(req.user.sub, query);
  }

  /** Resets a FAILED export back to REQUESTED so the generation sweep retries it — the only write this admin view can make. */
  @Post('export-requests/:id/retry')
  retryExportRequest(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.dataExport.retry(req.user.sub, id);
  }

  // ---------- Billing profiles ----------

  /** Registered before 'billing-profiles/:id' in this file only for readability — Nest matches by segment count, so there's no routing ambiguity between the two either way. */
  @Get('billing-profiles')
  listBillingProfiles() {
    return this.billingProfiles.list();
  }

  @Post('candidates/:candidateProfileId/billing-profile')
  createCandidateBillingProfile(
    @Req() req: AuthenticatedRequest,
    @Param('candidateProfileId') candidateProfileId: string,
    @Body() dto: CreateBillingProfileDto,
  ) {
    return this.billingProfiles.createForCandidate(req.user.sub, candidateProfileId, dto);
  }

  @Post('orgs/:organizationId/billing-profile')
  createOrgBillingProfile(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateBillingProfileDto,
  ) {
    return this.billingProfiles.createForOrganization(req.user.sub, organizationId, dto);
  }

  @Get('billing-profiles/:id')
  getBillingProfile(@Param('id') id: string) {
    return this.billingProfiles.get(id);
  }

  @Patch('billing-profiles/:id')
  updateBillingProfile(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: UpdateBillingProfileDto) {
    return this.billingProfiles.update(req.user.sub, id, dto);
  }

  @Delete('billing-profiles/:id')
  deleteBillingProfile(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.billingProfiles.softDelete(req.user.sub, id);
  }

  // ---------- Transactions ----------

  @Get('billing-profiles/:id/transactions')
  listTransactions(@Param('id') id: string) {
    return this.transactions.listForProfile(id);
  }

  /** Sets the financial core (amountPaise/currency/type/status) once — never editable in place after this. See Transaction's own schema doc comment. */
  @Post('billing-profiles/:id/transactions')
  createTransaction(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: CreateTransactionDto) {
    return this.transactions.create(req.user.sub, id, dto);
  }

  /** Corrects amountPaise/currency/type by posting a new row referencing :id — the original is never touched. */
  @Post('transactions/:id/amend')
  amendTransaction(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: AmendTransactionDto) {
    return this.transactions.amend(req.user.sub, id, dto);
  }

  /** The only way status may change post-creation — enforced against a fixed forward-only state machine, not a general update. */
  @Patch('transactions/:id/status')
  transitionTransactionStatus(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: UpdateTransactionStatusDto) {
    return this.transactions.transitionStatus(req.user.sub, id, dto.status);
  }

  /** Fills provider/providerOrderId/providerPaymentId once, null -> value only — reconciliation metadata, not a correction to the financial facts. */
  @Patch('transactions/:id/provider-reference')
  attachTransactionProviderReference(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: AttachProviderReferenceDto,
  ) {
    return this.transactions.attachProviderReference(req.user.sub, id, dto);
  }
}
