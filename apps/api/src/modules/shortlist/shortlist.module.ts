import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ShortlistController } from './shortlist.controller';
import { ShortlistService } from './shortlist.service';

@Module({
  imports: [AuthModule],
  controllers: [ShortlistController],
  providers: [ShortlistService],
})
export class ShortlistModule {}
