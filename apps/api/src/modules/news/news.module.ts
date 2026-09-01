import { Module } from '@nestjs/common';
import { NewsController } from './news.controller';
import { NewsService } from './news.service';
import { NewsFeedRefreshJob } from './news-feed-refresh.job';

/** PrismaModule is @Global (see its own doc comment) — nothing to import here. */
@Module({
  controllers: [NewsController],
  providers: [NewsService, NewsFeedRefreshJob],
})
export class NewsModule {}
