import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CloudinaryModule } from '../../common/cloudinary/cloudinary.module';
import { Asset } from '../assets/entities/asset.entity';
import { AiModel } from './catalog/ai-model.entity';
import { WalletModule } from '../wallet/wallet.module';
import { AiGeneration } from './generations/ai-generation.entity';
import { AiGenerationAsset } from './generations/ai-generation-asset.entity';
import { ChatMessage } from './chat/chat-message.entity';
import { Conversation } from './chat/conversation.entity';
import { FxRate } from './pricing/fx-rate.entity';
import { PricingQuote } from './pricing/pricing-quote.entity';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { ChatController } from './chat/chat.controller';
import { ChatService } from './chat/chat.service';
import { FxService } from './pricing/fx.service';
import { GenerationsController } from './generations/generations.controller';
import { GenerationsService } from './generations/generations.service';
import { OpenRouterService } from './openrouter.service';
import { KlingService } from './kling.service';
import { SeedanceService } from './seedance.service';
import { PricingController } from './pricing/pricing.controller';
import { PricingService } from './pricing/pricing.service';
import {
  ElementsController,
  VoicesController,
} from './custom-assets/custom-assets.controller';
import { GenerationAssetsService } from './generations/generation-assets.service';
import { VideoReconciliationService } from './generations/video-reconciliation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AiGeneration,
      AiGenerationAsset,
      PricingQuote,
      FxRate,
      Conversation,
      ChatMessage,
      Asset,
      AiModel,
    ]),
    CloudinaryModule,
    WalletModule,
  ],
  controllers: [
    CatalogController,
    PricingController,
    GenerationsController,
    ChatController,
    ElementsController,
    VoicesController,
  ],
  providers: [
    OpenRouterService,
    KlingService,
    SeedanceService,
    CatalogService,
    FxService,
    PricingService,
    GenerationsService,
    GenerationAssetsService,
    VideoReconciliationService,
    ChatService,
  ],
})
export class AiPlatformModule {}
