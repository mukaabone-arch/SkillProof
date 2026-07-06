import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('taxonomy')
export class TaxonomyController {
  constructor(private readonly prisma: PrismaService) {}

  /** Public: the full skills taxonomy, grouped by domain. */
  @Get()
  async list() {
    return this.prisma.domain.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { skills: { orderBy: { name: 'asc' } } },
    });
  }
}
