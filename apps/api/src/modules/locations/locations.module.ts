import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LocationsController } from './locations.controller';
import { LocationSearchService } from './location-search.service';
import { LOCATION_SEARCH_PROVIDER } from './location-search-provider.interface';
import { GooglePlacesLocationProvider } from './google-places-location.provider';

@Module({
  imports: [AuthModule],
  controllers: [LocationsController],
  providers: [
    LocationSearchService,
    { provide: LOCATION_SEARCH_PROVIDER, useClass: GooglePlacesLocationProvider },
  ],
  exports: [LocationSearchService],
})
export class LocationsModule {}
