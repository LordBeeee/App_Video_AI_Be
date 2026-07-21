// import { Module } from '@nestjs/common';
// import { TypeOrmModule } from '@nestjs/typeorm';
// import { Asset } from './entities/asset.entity';
// import { AssetsController } from './assets.controller';
// import { AssetsService } from './assets.service';
// import { CloudinaryModule } from '../../common/cloudinary/cloudinary.module';

// @Module({
//   imports: [TypeOrmModule.forFeature([Asset]), CloudinaryModule],
//   controllers: [AssetsController],
//   providers: [AssetsService],
//   exports: [AssetsService],
// })
// export class AssetsModule {}
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Asset } from './entities/asset.entity';
import { VideoGeneration } from '../video-generations/entities/video-generation.entity';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { CloudinaryModule } from '../../common/cloudinary/cloudinary.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Asset, VideoGeneration]), // ← thêm VideoGeneration
    CloudinaryModule,
  ],
  controllers: [AssetsController],
  providers: [AssetsService],
  exports: [AssetsService],
})
export class AssetsModule {}