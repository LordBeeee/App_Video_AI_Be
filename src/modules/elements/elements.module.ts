import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiElement } from './entities/ai-element.entity';
import { AiElementImage } from './entities/ai-element-image.entity';
import { AiElementVideo } from './entities/ai-element-video.entity';
import { Asset } from '../assets/entities/asset.entity';
import { ElementsController } from './elements.controller';
import { ElementsService } from './elements.service';
import { AiModelsModule } from '../ai-models/ai-models.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AiElement, AiElementImage, AiElementVideo, Asset]),
    AiModelsModule,
    // CloudinaryService/KlingService: nếu chúng đang là provider global (không thuộc module riêng)
    // thì không cần import gì thêm. Nếu bạn có CloudinaryModule/KlingModule riêng, import vào đây.
  ],
  controllers: [ElementsController],
  providers: [ElementsService],
  exports: [ElementsService],
})
export class ElementsModule {}