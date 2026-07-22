import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { ProfileViewsController } from './profile-views.controller';
import { ProfileViewsService } from './profile-views.service';

@Module({
  imports: [AuthModule, EntitlementsModule],
  controllers: [ProfileViewsController],
  providers: [ProfileViewsService],
  exports: [ProfileViewsService],
})
export class ProfileViewsModule {}
