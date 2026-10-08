import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CatalogService } from './catalog.service';
import type { AiModality } from './catalog.service';

@Controller('ai-catalog')
@UseGuards(JwtAuthGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  list(
    @Query('modality') modality: AiModality,
    @Query('refresh') refresh?: string,
  ) {
    return this.catalog.list(modality || 'chat', refresh === 'true');
  }
}
