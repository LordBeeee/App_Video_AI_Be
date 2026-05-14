import { Controller, Get, Param, Query } from '@nestjs/common';
import { AiModelsService } from './ai-models.service';

@Controller('ai-models')
export class AiModelsController {
  constructor(private readonly aiModelsService: AiModelsService) {}

  // GET /ai-models?providerCode=kling&modelType=video_generation
  @Get()
  findAll(
    @Query('providerCode') providerCode?: string,
    @Query('modelType') modelType?: string,
  ) {
    return this.aiModelsService.findAll(providerCode, modelType);
  }

  // GET /ai-models/provider/kling
  @Get('provider/:providerCode')
  findByProvider(@Param('providerCode') providerCode: string) {
    return this.aiModelsService.findByProvider(providerCode);
  }

  // GET /ai-models/:id
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.aiModelsService.findOne(+id);
  }
}