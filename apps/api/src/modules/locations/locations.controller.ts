import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LocationSearchDto } from './locations.dto';
import { LocationSearchService } from './location-search.service';

/**
 * Proxies city search to whatever LocationSearchProvider is wired up
 * (Google Places today) so the API key never reaches the browser — the
 * client only ever calls this endpoint, never Places directly. Authenticated
 * (not public) so rate limiting has a stable per-candidate key instead of
 * needing to extract/trust a client IP.
 */
@Controller('locations')
@UseGuards(JwtAuthGuard)
export class LocationsController {
  constructor(private readonly svc: LocationSearchService) {}

  @Get('search')
  search(@Req() req: AuthenticatedRequest, @Query() dto: LocationSearchDto) {
    return this.svc.search(req.user.sub, dto.q);
  }
}
