import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CandidateDocumentsController, OrgDocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentsGenerationJob } from './documents-generation.job';

/**
 * PrismaModule/StorageModule are both @Global (see their own doc comments)
 * — nothing to import for either. Only AuthModule is needed, for the
 * guards on this module's own controllers (JwtAuthGuard, OrgMemberGuard).
 * DocumentsService is exported so AdminModule can wire up the
 * GET/POST /admin/documents endpoints without duplicating this logic.
 */
@Module({
  imports: [AuthModule],
  controllers: [CandidateDocumentsController, OrgDocumentsController],
  providers: [DocumentsService, DocumentsGenerationJob],
  exports: [DocumentsService],
})
export class DocumentsModule {}
