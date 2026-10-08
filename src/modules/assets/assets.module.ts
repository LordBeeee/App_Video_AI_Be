import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Asset } from './entities/asset.entity';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { CloudinaryModule } from '../../common/cloudinary/cloudinary.module';
import { AiGeneration } from '../ai-platform/entities/ai-generation.entity';
import { AiGenerationAsset } from '../ai-platform/entities/ai-generation-asset.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Asset, AiGeneration, AiGenerationAsset]),
    CloudinaryModule,
  ],
  controllers: [AssetsController],
  providers: [AssetsService],
  exports: [AssetsService],
})
export class AssetsModule {}
