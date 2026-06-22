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
    @Query('supportsMotionControl') supportsMotionControl?: string,
  ) {
    
    // chuyển string 'true'/'false' → boolean | undefined
    const smc = supportsMotionControl !== undefined
      ? supportsMotionControl === 'true'
      : undefined;

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