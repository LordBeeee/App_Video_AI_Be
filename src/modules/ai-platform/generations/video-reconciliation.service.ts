import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CloudinaryService } from '../../../common/cloudinary/cloudinary.service';
import { WalletService } from '../../wallet/wallet.service';
import { KlingService } from '../kling.service';
import { chargeQuoteVnd } from '../pricing/pricing-calculator';
import { PricingQuote } from '../pricing/pricing-quote.entity';
import { AiGeneration } from './ai-generation.entity';
import { GenerationAssetsService } from './generation-assets.service';

@Injectable()
export class VideoReconciliationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(VideoReconciliationService.name);
  private readonly inProgress = new Set<string>();
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(AiGeneration)
    private readonly generations: Repository<AiGeneration>,
    @InjectRepository(PricingQuote)
    private readonly quotes: Repository<PricingQuote>,
    private readonly kling: KlingService,
    private readonly cloudinary: CloudinaryService,
    private readonly outputAssets: GenerationAssetsService,
    private readonly wallets: WalletService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const intervalMs = Math.max(
      15_000,
      Number(this.config.get<string>('VIDEO_RECONCILE_INTERVAL_MS')) || 30_000,
    );
    this.timer = setInterval(() => void this.reconcilePending(), intervalMs);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async reconcilePending() {
    let pending: AiGeneration[];
    try {
      pending = await this.generations
        .createQueryBuilder('generation')
        .where('generation.modality = :modality', { modality: 'video' })
        .andWhere('generation.status IN (:...statuses)', {
          statuses: ['pending', 'queued', 'processing', 'running'],
        })
        .orderBy('generation.updated_at', 'ASC')
        .take(20)
        .getMany();
    } catch (error) {
      this.logger.warn(
        `Tạm bỏ qua đối soát video: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    for (const generation of pending) {
      if (generation.source !== 'kling') continue;
      try {
        await this.reconcile(generation);
      } catch (error) {
        this.logger.warn(
          `Không thể đối soát video ${generation.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  async reconcile(generation: AiGeneration) {
    if (generation.source !== 'kling' || !generation.externalJobId)
      return generation;
    if (this.inProgress.has(generation.id)) return generation;
    this.inProgress.add(generation.id);
    try {
      const job = await this.kling.getJob(
        generation.modelSlug,
        generation.externalJobId,
      );
      const state = job.status;
      if (['completed', 'succeeded', 'succeed'].includes(state)) {
        if (!job.url)
          throw new BadRequestException('Kling chưa trả về URL video');
        const buffer = await this.kling.download(job.url);
        const uploaded = await this.cloudinary.uploadVideoBuffer(
          buffer,
          `ai-generation/users/${generation.userId}/videos`,
          generation.id,
        );
        await this.outputAssets.saveOutput(
          generation.id,
          generation.userId,
          'video',
          uploaded.secure_url,
          { generationId: generation.id, thumbnailUrl: uploaded.thumbnail_url },
        );
        const quote = await this.quotes.findOneOrFail({
          where: { id: generation.quoteId },
        });
        const actualUsd =
          typeof job.costUsd === 'number' &&
          Number.isFinite(job.costUsd) &&
          job.costUsd >= 0
            ? job.costUsd
            : undefined;
        const charge = chargeQuoteVnd(
          Number(quote.maxPriceVnd),
          Number(quote.usdVndRate),
          Number(quote.markupRate),
          actualUsd,
        );
        generation.status = 'succeeded';
        generation.outputUrls = [uploaded.secure_url];
        generation.usage = {
          units: Number.isFinite(job.units) ? job.units : undefined,
        };
        generation.actualCostUsd =
          actualUsd != null ? String(actualUsd) : undefined;
        generation.chargedVnd = charge;
        generation.completedAt = new Date();
        await this.generations.save(generation);
        await this.wallets.settle(generation.walletHoldId!, charge, {
          generationId: generation.id,
          modality: 'video',
        });
      } else if (['failed', 'cancelled', 'expired'].includes(state)) {
        generation.status = 'failed';
        const jobError: unknown = job.error;
        generation.errorMessage =
          typeof jobError === 'string'
            ? jobError
            : jobError && typeof jobError === 'object' && 'message' in jobError
              ? String(jobError.message)
              : `Video ${state}`;
        generation.completedAt = new Date();
        await this.generations.save(generation);
        await this.wallets.release(
          generation.walletHoldId!,
          generation.errorMessage || `Video ${state}`,
        );
      } else {
        generation.status = state || generation.status;
        await this.generations.save(generation);
      }
      return generation;
    } finally {
      this.inProgress.delete(generation.id);
    }
  }
}
