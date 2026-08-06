import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { AccountModule } from '../account/account.module';
import { DataExportModule } from '../data-export/data-export.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [AuthModule, EntitlementsModule, AccountModule, DataExportModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
