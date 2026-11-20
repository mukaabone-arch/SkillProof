import { Global, Module } from '@nestjs/common';
import { CandidatePackageService } from './candidate-package.service';
import { WebhookDispatcherService } from './webhook-dispatcher.service';

/**
 * Global so any service where something happens (applications, the
 * pipeline, submissions, outreach, jobs) can inject the dispatcher without
 * a module import cycle; it depends only on Prisma.
 */
@Global()
@Module({
  providers: [CandidatePackageService, WebhookDispatcherService],
  exports: [CandidatePackageService, WebhookDispatcherService],
})
export class WebhooksModule {}
