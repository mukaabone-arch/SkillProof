import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { DataExportBuilderService } from './data-export-builder.service';
import { DataExportService } from './data-export.service';
import { DataExportJob } from './data-export.job';

@Module({
  imports: [NotificationsModule, EntitlementsModule],
  providers: [DataExportBuilderService, DataExportService, DataExportJob],
  exports: [DataExportService],
})
export class DataExportModule {}
