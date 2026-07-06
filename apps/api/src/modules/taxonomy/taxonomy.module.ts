import { Module } from '@nestjs/common';
import { TaxonomyController } from './taxonomy.controller';

@Module({ controllers: [TaxonomyController] })
export class TaxonomyModule {}
