import { Controller, Get } from '@nestjs/common';
import { NewsService } from './news.service';

/**
 * Public, unauthenticated, read-only — same posture as PlansController.
 * Powers the landing page's news strip for anonymous visitors; no auth
 * guard, no per-user content, nothing personalized. A pure cache read
 * (see NewsService.listRecent) — this endpoint never fetches an external
 * feed itself, so it's as fast/reliable as any other DB-backed read.
 */
@Controller('news')
export class NewsController {
  constructor(private readonly news: NewsService) {}

  @Get()
  list() {
    return this.news.listRecent();
  }
}
