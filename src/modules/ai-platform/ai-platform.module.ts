import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CloudinaryModule } from '../../common/cloudinary/cloudinary.module';
import { Asset } from '../assets/entities/asset.entity';
import { AiModel } from './entities/ai-model.entity';
import { WalletModule } from '../wallet/wallet.module';
import { AiGeneration } from './entities/ai-generation.entity';
import { AiGenerationAsset } from './entities/ai-generation-asset.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { Conversation } from './entities/conversation.entity';
import { FxRate } from './entities/fx-rate.entity';
import { PricingQuote } from './entities/pricing-quote.entity';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { FxService } from './fx.service';
import { GenerationsController } from './generations.controller';
import { GenerationsService } from './generations.service';
import { OpenRouterWebhookController } from './openrouter-webhook.controller';
import { OpenRouterService } from './openrouter.service';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';

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
    OpenRouterWebhookController,
  ],
  providers: [
    OpenRouterService,
    CatalogService,
    FxService,
    PricingService,
    GenerationsService,
    ChatService,
  ],
})
export class AiPlatformModule {}
