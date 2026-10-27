import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CloudinaryService } from '../../../common/cloudinary/cloudinary.service';
import { WalletService } from '../../wallet/wallet.service';
import { KlingService } from '../kling.service';
import { SeedanceService } from '../seedance.service';
import { VeoService } from '../veo.service';
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
    private readonly seedance: SeedanceService,
    private readonly veo: VeoService,
    private readonly dataSource: DataSource,
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
          statuses: ['pending', 'submitted', 'queued', 'processing', 'running'],
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
      if (!['kling', 'seedance', 'veo'].includes(generation.source)) continue;
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
    if (!['kling', 'seedance', 'veo'].includes(generation.source) || !generation.externalJobId)
      return generation;
    if (this.inProgress.has(generation.id)) return generation;
    this.inProgress.add(generation.id);
    const lock = this.dataSource.createQueryRunner();
    let claimed = false;
    try {
      await lock.connect();
      const [claim] = await lock.query(
        'SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS claimed',
        ['video-generation', generation.id],
      );
      claimed = !!claim?.claimed;
      if (!claimed) return generation;
      const fresh = await this.generations.findOne({ where: { id: generation.id } });
      if (!fresh || !['pending', 'submitted', 'queued', 'processing', 'running'].includes(fresh.status))
        return fresh || generation;
      generation = fresh;
      if (!generation.externalJobId) return generation;
      const isSeedance = generation.source === 'seedance';
      const isVeo = generation.source === 'veo';
      const job = isVeo
        ? await this.veo.getJob(generation.externalJobId, generation.modelSlug === 'google/veo-3.1-fast'
          ? 'veo-3.1-fast-generate-001' : 'veo-3.1-generate-001')
        : isSeedance
        ? await this.seedance.getJob(generation.externalJobId)
        : await this.kling.getJob(generation.modelSlug, generation.externalJobId);
      const state = job.status;
      if (['completed', 'succeeded', 'succeed'].includes(state)) {
        if (!('buffer' in job && job.buffer) && !('url' in job && job.url))
          throw new BadRequestException('Provider chưa trả về URL video');
        let output = await this.outputAssets.findVideoOutput(generation.id);
        if (!output) {
          const folder = `ai-generation/users/${generation.userId}/videos`;
          let uploaded = await this.cloudinary.findVideo(folder, generation.id);
          if (!uploaded) {
            const buffer = isVeo && 'buffer' in job && job.buffer
              ? job.buffer
              : isSeedance
              ? await this.seedance.download(job.url!)
              : await this.kling.download(job.url!);
            uploaded = await this.cloudinary.uploadVideoBuffer(buffer, folder, generation.id);
          }
          output = await this.outputAssets.saveOutput(
            generation.id, generation.userId, 'video', uploaded.secure_url,
            { generationId: generation.id, thumbnailUrl: uploaded.thumbnail_url,
              fileSizeBytes: uploaded.bytes, durationSeconds: uploaded.duration,
              mediaDurationSeconds: uploaded.duration, width: uploaded.width,
              height: uploaded.height, fps: uploaded.frame_rate },
          );
        }
        const lastFrameUrl = 'lastFrameUrl' in job && typeof job.lastFrameUrl === 'string'
          ? job.lastFrameUrl : undefined;
        if (isSeedance && lastFrameUrl) {
          try {
            const lastFrame = await this.seedance.download(lastFrameUrl);
            const image = await this.cloudinary.uploadBuffer(
              lastFrame,
              `ai-generation/users/${generation.userId}/images`,
              `${generation.id}_last_frame`,
            );
            await this.outputAssets.saveOutput(
              generation.id,
              generation.userId,
              'image',
              image.secure_url,
              { generationId: generation.id, mimeType: 'image/jpeg', fileSizeBytes: image.bytes },
              'last_frame',
            );
          } catch (error) {
            this.logger.warn(
              `Không thể lưu ảnh cuối của video ${generation.id}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        const quote = await this.quotes.findOneOrFail({
          where: { id: generation.quoteId },
        });
        const seedanceRate = Number(quote.request?.units?.usdPerMillionTokens);
        const units = Number(job.units);
        const actualUsd = isVeo
          ? Number(quote.providerCostMaxUsd)
          : isSeedance
          ? Number.isFinite(units) && units >= 0 && seedanceRate > 0
            ? units * seedanceRate / 1_000_000 : undefined
          : typeof job.costUsd === 'number' && Number.isFinite(job.costUsd) && job.costUsd >= 0
            ? job.costUsd : undefined;
        const charge = chargeQuoteVnd(
          Number(quote.maxPriceVnd),
          Number(quote.usdVndRate),
          Number(quote.markupRate),
          actualUsd,
        );
        generation.status = 'succeeded';
        generation.outputUrls = [output.storedUrl];
        generation.usage = isVeo ? {} : isSeedance
          ? { completion_tokens: Number.isFinite(units) ? units : undefined }
          : { units: Number.isFinite(units) ? units : undefined };
        generation.actualCostUsd =
          actualUsd != null ? String(actualUsd) : undefined;
        generation.chargedVnd = charge;
        generation.completedAt = new Date();
        await this.generations.update(generation.id, {
          status: generation.status,
          outputUrls: generation.outputUrls,
          usage: generation.usage,
          actualCostUsd: generation.actualCostUsd,
          chargedVnd: generation.chargedVnd,
          completedAt: generation.completedAt,
        });
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
        await this.generations.update(generation.id, {
          status: generation.status,
          errorMessage: generation.errorMessage,
          completedAt: generation.completedAt,
        });
        await this.wallets.release(
          generation.walletHoldId!,
          generation.errorMessage || `Video ${state}`,
        );
      } else {
        generation.status = state || generation.status;
        await this.generations.update(generation.id, {
          status: generation.status,
        });
      }
      return generation;
    } finally {
      try {
        if (claimed) await lock.query('SELECT pg_advisory_unlock(hashtext($1), hashtext($2))',
          ['video-generation', generation.id]);
      } finally {
        await lock.release();
        this.inProgress.delete(generation.id);
      }
    }
  }
}
