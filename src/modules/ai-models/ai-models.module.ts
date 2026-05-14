import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModel } from './entities/ai-model.entity';
import { AiProvider } from '../ai-provider/entities/ai-provider.entity';
import { AiModelsService } from './ai-models.service';
import { AiModelsController } from './ai-models.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([AiModel, AiProvider]),  // ← phải có cả AiProvider
  ],
  controllers: [AiModelsController],
  providers: [AiModelsService],
  exports: [AiModelsService],
})
export class AiModelsModule {}