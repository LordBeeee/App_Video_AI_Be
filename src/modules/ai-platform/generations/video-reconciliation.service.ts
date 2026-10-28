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
        .andWhere('(generation.next_check_at IS NULL OR generation.next_check_at <= :now)', { now: new Date() })
        .orderBy('generation.next_check_at', 'ASC', 'NULLS FIRST')
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
    let stage = 'checking_provider';
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
      await this.markStage(generation, stage, { lastSyncAttemptAt: new Date() });
      const isSeedance = generation.source === 'seedance';
      const isVeo = generation.source === 'veo';
      const job = isVeo
        ? await this.veo.getJob(generation.externalJobId, generation.modelSlug === 'google/veo-3.1-fast'
          ? 'veo-3.1-fast-generate-001' : 'veo-3.1-generate-001')
        : isSeedance
        ? await this.seedance.getJob(generation.externalJobId)
        : await this.kling.getJob(generation.modelSlug, generation.externalJobId);
      const state = job.status;
      generation.providerStatus = state;
      await this.generations.update(generation.id, { providerStatus: state });
      if (['completed', 'succeeded', 'succeed'].includes(state)) {
        stage = 'waiting_provider_output';
        if (!('buffer' in job && job.buffer) && !('url' in job && job.url))
          throw new BadRequestException('Provider chưa trả về URL video');
        let output = await this.outputAssets.findVideoOutput(generation.id);
        if (!output) {
          const folder = `ai-generation/users/${generation.userId}/videos`;
          stage = 'checking_storage';
          await this.markStage(generation, stage);
          let uploaded = await this.cloudinary.findVideo(folder, generation.id);
          if (!uploaded) {
            stage = 'downloading_video';
            await this.markStage(generation, stage);
            const buffer = isVeo && 'buffer' in job && job.buffer
              ? job.buffer
              : isSeedance
              ? await this.seedance.download(job.url!)
              : await this.kling.download(job.url!);
            stage = 'uploading_cloudinary';
            await this.markStage(generation, stage);
            uploaded = await this.cloudinary.uploadVideoBuffer(buffer, folder, generation.id);
          }
          stage = 'saving_result';
          await this.markStage(generation, stage);
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
        stage = 'calculating_charge';
        await this.markStage(generation, stage);
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
        stage = 'settling_wallet';
        await this.markStage(generation, stage);
        await this.wallets.settle(generation.walletHoldId!, charge, {
          generationId: generation.id,
          modality: 'video',
        });
        generation.status = 'succeeded';
        generation.outputUrls = [output.storedUrl];
        generation.usage = isVeo ? {} : isSeedance
          ? { completion_tokens: Number.isFinite(units) ? units : undefined }
          : { units: Number.isFinite(units) ? units : undefined };
        generation.actualCostUsd =
          actualUsd != null ? String(actualUsd) : undefined;
        generation.chargedVnd = charge;
        generation.completedAt = new Date();
        generation.nextCheckAt = null;
        await this.generations.update(generation.id, {
          status: generation.status,
          outputUrls: generation.outputUrls,
          usage: generation.usage,
          actualCostUsd: generation.actualCostUsd,
          chargedVnd: generation.chargedVnd,
          completedAt: generation.completedAt,
          nextCheckAt: null,
          providerStatus: state,
          processingStage: null,
          syncErrorCode: null,
          syncErrorMessage: null,
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
        generation.nextCheckAt = null;
        stage = 'settling_wallet';
        await this.markStage(generation, stage);
        await this.wallets.release(
          generation.walletHoldId!,
          generation.errorMessage || `Video ${state}`,
        );
        await this.generations.update(generation.id, {
          status: generation.status,
          errorMessage: generation.errorMessage,
          completedAt: generation.completedAt,
          nextCheckAt: null,
          providerStatus: state,
          processingStage: null,
          syncErrorCode: null,
          syncErrorMessage: null,
        });
      } else {
        generation.status = state || generation.status;
        const ageMs = Date.now() - new Date(generation.createdAt || Date.now()).getTime();
        const delayMs = ageMs < 120_000 ? 30_000 : ageMs < 600_000 ? 60_000 : 120_000;
        generation.nextCheckAt = new Date(Date.now() + delayMs);
        await this.generations.update(generation.id, {
          status: generation.status,
          nextCheckAt: generation.nextCheckAt,
          processingStage: 'checking_provider',
          syncErrorCode: null,
          syncErrorMessage: null,
        });
      }
      return generation;
    } catch (error) {
      if (claimed) {
        const diagnostic = this.syncDiagnostic(stage, error, generation.source);
        await this.generations.update(generation.id, {
          processingStage: stage,
          syncErrorCode: diagnostic.code,
          syncErrorMessage: diagnostic.message,
          nextCheckAt: new Date(Date.now() + 120_000),
        }).catch((writeError) => this.logger.warn(
          `Không thể lưu lỗi đồng bộ video ${generation.id}: ${writeError instanceof Error ? writeError.message : String(writeError)}`,
        ));
      }
      throw error;
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

  private async markStage(generation: AiGeneration, stage: string, extra: { lastSyncAttemptAt?: Date } = {}) {
    generation.processingStage = stage;
    await this.generations.update(generation.id, { processingStage: stage, ...extra });
  }

  private syncDiagnostic(stage: string, error: unknown, source: AiGeneration['source']) {
    const detail = error instanceof Error ? error.message : String(error);
    const provider = source === 'kling' ? 'Kling' : source === 'seedance' ? 'Seedance' : 'Veo';
    if (stage === 'uploading_cloudinary' || stage === 'checking_storage') {
      if (/quota|exceed|(?:storage|usage).*limit|limit.*(?:storage|usage)|25\s*gb/i.test(detail)) return {
        code: 'CLOUDINARY_QUOTA_EXCEEDED',
        message: `${provider} đã tạo xong video, nhưng Cloudinary đã vượt hạn mức lưu trữ. Hệ thống sẽ thử lại sau khi tài khoản hoạt động.`,
      };
      if (/unauthorized|forbidden|invalid|401|403|api.key|credential/i.test(detail)) return {
        code: 'CLOUDINARY_AUTH_FAILED',
        message: `${provider} đã tạo xong video, nhưng Cloudinary từ chối tài khoản lưu trữ. Hệ thống sẽ thử lại.`,
      };
      if (stage === 'checking_storage') return {
        code: 'CLOUDINARY_CHECK_FAILED',
        message: `${provider} đã tạo xong video, nhưng chưa kiểm tra được kho lưu trữ Cloudinary. Hệ thống sẽ thử lại.`,
      };
      return { code: 'CLOUDINARY_UPLOAD_FAILED', message: `${provider} đã tạo xong video, nhưng chưa tải lên được Cloudinary. Hệ thống sẽ thử lại.` };
    }
    if (stage === 'waiting_provider_output') return { code: 'VIDEO_OUTPUT_MISSING', message: 'Nhà cung cấp báo hoàn thành nhưng chưa trả về video. Hệ thống sẽ thử lại.' };
    if (stage === 'downloading_video') return { code: 'VIDEO_DOWNLOAD_FAILED', message: `${provider} đã tạo xong video, nhưng hệ thống chưa tải được video để lưu trữ. Hệ thống sẽ thử lại.` };
    if (stage === 'saving_result') return { code: 'VIDEO_SAVE_FAILED', message: 'Video đã tạo xong nhưng chưa lưu được vào thư viện. Hệ thống sẽ thử lại.' };
    if (stage === 'calculating_charge') return { code: 'VIDEO_PRICING_FAILED', message: 'Video đã tạo xong nhưng chưa tính được chi phí cuối cùng. Hệ thống sẽ thử lại.' };
    if (stage === 'settling_wallet') return { code: 'WALLET_SETTLEMENT_FAILED', message: 'Video đã tạo xong nhưng chưa quyết toán được ví. Hệ thống sẽ thử lại.' };
    return { code: 'PROVIDER_CHECK_FAILED', message: 'Chưa kiểm tra được trạng thái video từ nhà cung cấp. Hệ thống sẽ thử lại.' };
  }
}
