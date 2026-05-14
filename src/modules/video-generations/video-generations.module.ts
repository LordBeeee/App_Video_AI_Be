import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VideoGeneration } from './entities/video-generation.entity';
import { Asset } from '../assets/entities/asset.entity';
import { VideoGenerationsService } from './video-generations.service';
import { VideoGenerationsController } from './video-generations.controller';
import { AiModelsModule } from '../ai-models/ai-models.module';
import { Project } from '../projects/entities/project.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([VideoGeneration, Asset, Project]),
    AiModelsModule,
  ],
  controllers: [VideoGenerationsController],
  providers: [VideoGenerationsService],
  exports: [VideoGenerationsService],
})
export class VideoGenerationsModule {}