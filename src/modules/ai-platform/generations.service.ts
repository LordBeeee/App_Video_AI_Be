import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, timingSafeEqual } from 'crypto';
import { In, Repository } from 'typeorm';
import { CloudinaryService } from '../../common/cloudinary/cloudinary.service';
import { Asset } from '../assets/entities/asset.entity';
import { WalletService } from '../wallet/wallet.service';
import { AiGeneration } from './entities/ai-generation.entity';
import { AiGenerationAsset } from './entities/ai-generation-asset.entity';
import { PricingQuote } from './entities/pricing-quote.entity';
import { OpenRouterService } from './openrouter.service';
import { PricingService } from './pricing.service';

interface CreateGenerationBody {
  quoteId: string;
  prompt: string;
  projectId?: number;
  referenceUrls?: string[];
  referenceAssetIds?: number[];
}

@Injectable()
export class GenerationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GenerationsService.name);
  private reconciliationTimer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(AiGeneration)
    private readonly generations: Repository<AiGeneration>,
    @InjectRepository(AiGenerationAsset)
    private readonly generationAssets: Repository<AiGenerationAsset>,
    @InjectRepository(PricingQuote)
    private readonly quotes: Repository<PricingQuote>,
    @InjectRepository(Asset) private readonly assets: Repository<Asset>,
    private readonly pricing: PricingService,
    private readonly wallets: WalletService,
    private readonly openRouter: OpenRouterService,
    private readonly cloudinary: CloudinaryService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const intervalMs = Math.max(
      15_000,
      Number(this.config.get<string>('VIDEO_RECONCILE_INTERVAL_MS')) || 30_000,
    );
    this.reconciliationTimer = setInterval(() => {
      void this.reconcilePendingVideos();
    }, intervalMs);
    this.reconciliationTimer.unref();
  }

  onModuleDestroy() {
    if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
  }

  private async reconcilePendingVideos() {
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
      try {
        await this.reconcileVideo(generation);
      } catch (error) {
        this.logger.warn(
          `Không thể đối soát video ${generation.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private chargeVnd(quote: PricingQuote, actualCostUsd?: number) {
    if (!(actualCostUsd != null && actualCostUsd >= 0))
      return Number(quote.maxPriceVnd);
    return Math.min(
      Number(quote.maxPriceVnd),
      Math.ceil(
        actualCostUsd *
          Number(quote.usdVndRate) *
          (1 + Number(quote.markupRate)),
      ),
    );
  }

  private async resolveActualCost(
    providerGenerationId: string | undefined,
    inlineCost: unknown,
  ) {
    const direct = Number(inlineCost);
    if (Number.isFinite(direct)) return direct;
    if (!providerGenerationId) return undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const metadata =
          await this.openRouter.getGeneration(providerGenerationId);
        const parsed = Number(
          metadata.data?.total_cost ?? metadata.data?.usage?.cost,
        );
        if (Number.isFinite(parsed)) return parsed;
      } catch {
        /* Generation metadata can be eventually consistent. */
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400));
    }
    return undefined;
  }

  private async saveAsset(
    generationId: string,
    userId: number,
    modality: string,
    url: string,
    metadata: Record<string, any> = {},
  ) {
    const asset = await this.assets.save(
      this.assets.create({
        userId,
        projectId: null,
        sceneId: null,
        assetType: modality,
        assetRole: 'output',
        sourceType: 'generated',
        originalUrl: url,
        storedUrl: url,
        thumbnailUrl:
          String(metadata.thumbnailUrl || '') ||
          (modality === 'image' ? url : null),
        storageProvider: 'cloudinary',
        mimeType:
          modality === 'image'
            ? 'image/png'
            : modality === 'audio'
              ? 'audio/mpeg'
              : 'video/mp4',
        fileSizeBytes: null,
        durationSeconds: null,
        fps: null,
        width: null,
        height: null,
        isFavorite: false,
        metadata,
      }),
    );
    await this.generationAssets.save(
      this.generationAssets.create({
        generationId,
        assetId: asset.id,
        role: 'output',
      }),
    );
    return asset;
  }

  async create(userId: number, body: CreateGenerationBody) {
    const prompt = String(body.prompt || '').trim();
    if (!prompt) throw new BadRequestException('Prompt là bắt buộc');
    const quote = await this.pricing.getValidQuote(
      userId,
      body.quoteId,
      prompt,
    );
    if (quote.modality === 'chat')
      throw new BadRequestException('Dùng API chat cho báo giá chat');
    const referenceAssetIds = Array.from(
      new Set(
        (body.referenceAssetIds || [])
          .map(Number)
          .filter((id) => Number.isSafeInteger(id) && id > 0),
      ),
    ).slice(0, 2);
    const referenceAssets = referenceAssetIds.length
      ? await this.assets.find({
          where: { id: In(referenceAssetIds), userId },
        })
      : [];
    if (referenceAssets.length !== referenceAssetIds.length) {
      throw new BadRequestException(
        'Ảnh hoặc video tham chiếu không tồn tại hoặc không thuộc tài khoản',
      );
    }
    const referenceById = new Map(
      referenceAssets.map((asset) => [Number(asset.id), asset]),
    );
    const orderedReferences = referenceAssetIds
      .map((id) => referenceById.get(id))
      .filter((asset): asset is Asset => Boolean(asset));
    const hold = await this.wallets.hold(
      userId,
      quote.id,
      Number(quote.maxPriceVnd),
    );
    quote.consumedAt = new Date();
    await this.quotes.save(quote);

    const options = {
      ...(quote.request?.options || {}),
      referenceUrls: orderedReferences.length
        ? orderedReferences.map((asset) => asset.storedUrl)
        : (body.referenceUrls || []).slice(0, 2),
    };
    let generation = await this.generations.save(
      this.generations.create({
        userId,
        projectId: body.projectId,
        quoteId: quote.id,
        walletHoldId: hold.id,
        modality: quote.modality,
        modelSlug: quote.modelSlug,
        source: 'openrouter',
        modelNameSnapshot:
          String(quote.request?.modelName || '') || quote.modelSlug,
        providerSnapshot: { provider: 'openrouter' },
        status: 'processing',
        prompt,
        options,
        outputUrls: [],
        usage: {},
        estimatedMinVnd: Number(quote.minPriceVnd),
        estimatedMaxVnd: Number(quote.maxPriceVnd),
      }),
    );
    if (orderedReferences.length) {
      await this.generationAssets.save(
        orderedReferences.map((asset, index) =>
          this.generationAssets.create({
            generationId: generation.id,
            assetId: asset.id,
            role: index === 0 ? 'input' : 'reference',
          }),
        ),
      );
    }
    await this.wallets.attachGeneration(hold.id, generation.id);

    try {
      if (quote.modality === 'image')
        generation = await this.createImage(generation, quote);
      if (quote.modality === 'audio')
        generation = await this.createAudio(generation, quote);
      if (quote.modality === 'video')
        generation = await this.createVideo(generation);
      const hydrated = await this.generations.findOneOrFail({
        where: { id: generation.id },
        relations: { model: true, linkedAssets: { asset: true } },
      });
      return this.response(hydrated);
    } catch (error: any) {
      generation.status = 'failed';
      generation.errorMessage = error.message || 'Tạo nội dung thất bại';
      generation.completedAt = new Date();
      await this.generations.save(generation);
      await this.wallets.release(
        hold.id,
        generation.errorMessage || 'Tạo nội dung thất bại',
      );
      throw error;
    }
  }

  private async createImage(generation: AiGeneration, quote: PricingQuote) {
    const opts = generation.options || {};
    const request: Record<string, any> = {
      model: generation.modelSlug,
      prompt: generation.prompt,
    };
    const mapping: Record<string, string> = {
      aspectRatio: 'aspect_ratio',
      resolution: 'resolution',
      size: 'size',
      quality: 'quality',
      outputFormat: 'output_format',
      background: 'background',
      outputCompression: 'output_compression',
      n: 'n',
      seed: 'seed',
    };
    for (const [source, target] of Object.entries(mapping)) {
      if (opts[source] != null && opts[source] !== '')
        request[target] = opts[source];
    }
    if (opts.referenceUrls?.length) {
      request.input_references = opts.referenceUrls.map((url: string) => ({
        image_url: { url },
      }));
    }
    const result = await this.openRouter.generateImage(request);
    const urls: string[] = [];
    for (let index = 0; index < (result.data || []).length; index++) {
      const item = result.data[index];
      const buffer = Buffer.from(item.b64_json, 'base64');
      const uploaded = await this.cloudinary.uploadBuffer(
        buffer,
        `ai-generation/users/${generation.userId}/images`,
        `${generation.id}_${index + 1}`,
      );
      urls.push(uploaded.secure_url);
      await this.saveAsset(
        generation.id,
        generation.userId,
        'image',
        uploaded.secure_url,
        {
          generationId: generation.id,
        },
      );
    }
    const providerGenerationId = String(
      result.id || result.generation_id || '',
    );
    const actualUsd = await this.resolveActualCost(
      providerGenerationId || undefined,
      result.usage?.cost,
    );
    const charge = this.chargeVnd(quote, actualUsd);
    generation.status = 'succeeded';
    generation.outputUrls = urls;
    generation.usage = result.usage || {};
    generation.providerGenerationId = providerGenerationId || undefined;
    generation.actualCostUsd =
      actualUsd != null ? String(actualUsd) : undefined;
    generation.chargedVnd = charge;
    generation.completedAt = new Date();
    await this.generations.save(generation);
    await this.wallets.settle(generation.walletHoldId!, charge, {
      generationId: generation.id,
      modality: 'image',
    });
    return generation;
  }

  private async createAudio(generation: AiGeneration, quote: PricingQuote) {
    const opts = generation.options || {};
    if (!opts.voice) throw new BadRequestException('Vui lòng chọn giọng đọc');
    const response = await this.openRouter.generateSpeech({
      model: generation.modelSlug,
      input: generation.prompt,
      voice: opts.voice,
      response_format: 'mp3',
      speed: Number(opts.speed || 1),
    });
    const providerGenerationId = String(
      response.headers['x-generation-id'] || '',
    );
    const url = await this.cloudinary.uploadAudioBuffer(
      Buffer.from(response.data),
      `ai-generation/users/${generation.userId}/audio`,
      generation.id,
    );
    await this.saveAsset(generation.id, generation.userId, 'audio', url, {
      generationId: generation.id,
    });
    const actualUsd = await this.resolveActualCost(
      providerGenerationId || undefined,
      undefined,
    );
    const charge = this.chargeVnd(quote, actualUsd);
    generation.status = 'succeeded';
    generation.providerGenerationId = providerGenerationId || undefined;
    generation.outputUrls = [url];
    generation.actualCostUsd =
      actualUsd != null ? String(actualUsd) : undefined;
    generation.chargedVnd = charge;
    generation.completedAt = new Date();
    await this.generations.save(generation);
    await this.wallets.settle(generation.walletHoldId!, charge, {
      generationId: generation.id,
      modality: 'audio',
    });
    return generation;
  }

  private async createVideo(generation: AiGeneration) {
    const opts = generation.options || {};
    const request: Record<string, any> = {
      model: generation.modelSlug,
      prompt: generation.prompt,
    };
    if (opts.duration != null) request.duration = Number(opts.duration);
    if (opts.resolution) request.resolution = opts.resolution;
    if (opts.aspectRatio) request.aspect_ratio = opts.aspectRatio;
    if (opts.generateAudio != null)
      request.generate_audio = !!opts.generateAudio;
    if (opts.seed != null) request.seed = Number(opts.seed);
    const references = opts.referenceUrls || [];
    if (references.length) {
      request.frame_images = references
        .slice(0, 2)
        .map((url: string, index: number) => ({
          type: 'image_url',
          image_url: { url },
          frame_type: index === 0 ? 'first_frame' : 'last_frame',
        }));
    }
    const callbackUrl = this.config.get<string>('OPENROUTER_VIDEO_WEBHOOK_URL');
    if (callbackUrl) request.callback_url = callbackUrl;
    const job = await this.openRouter.submitVideo(request);
    generation.status = job.status || 'pending';
    generation.externalJobId = job.id;
    generation.providerGenerationId = job.generation_id;
    generation.options = { ...opts, pollingUrl: job.polling_url };
    await this.generations.save(generation);
    return generation;
  }

  async list(userId: number, modality?: string) {
    const where: any = { userId };
    if (modality) where.modality = modality;
    const items = await this.generations.find({
      where,
      relations: { model: true, linkedAssets: { asset: true } },
      order: { createdAt: 'DESC' },
      take: 100,
    });
    return {
      items: items.map((item) => this.response(item)),
      total: items.length,
    };
  }

  async findOne(userId: number, id: string) {
    let generation = await this.generations.findOne({
      where: { id },
      relations: { model: true, linkedAssets: { asset: true } },
    });
    if (!generation) throw new NotFoundException('Không tìm thấy generation');
    if (Number(generation.userId) !== Number(userId))
      throw new ForbiddenException();
    if (
      generation.modality === 'video' &&
      ['pending', 'queued', 'processing', 'running'].includes(generation.status)
    ) {
      await this.reconcileVideo(generation);
      generation = await this.generations.findOneOrFail({
        where: { id },
        relations: { model: true, linkedAssets: { asset: true } },
      });
    }
    return this.response(generation);
  }

  private async reconcileVideo(generation: AiGeneration, suppliedJob?: any) {
    const job =
      suppliedJob ||
      (await this.openRouter.getVideoJob(
        generation.options?.pollingUrl || `/videos/${generation.externalJobId}`,
      ));
    const state = job.status;
    if (state === 'completed' || state === 'succeeded') {
      const sourceUrl = job.unsigned_urls?.[0];
      const buffer = await this.openRouter.downloadVideo(
        generation.externalJobId!,
        sourceUrl,
      );
      const uploaded = await this.cloudinary.uploadVideoBuffer(
        buffer,
        `ai-generation/users/${generation.userId}/videos`,
        generation.id,
      );
      await this.saveAsset(
        generation.id,
        generation.userId,
        'video',
        uploaded.secure_url,
        {
          generationId: generation.id,
          thumbnailUrl: uploaded.thumbnail_url,
        },
      );
      const quote = await this.quotes.findOneOrFail({
        where: { id: generation.quoteId },
      });
      const actualUsd = await this.resolveActualCost(
        generation.providerGenerationId,
        job.usage?.cost ?? job.usage?.total_cost,
      );
      const charge = this.chargeVnd(quote, actualUsd);
      generation.status = 'succeeded';
      generation.outputUrls = [uploaded.secure_url];
      generation.usage = job.usage || {};
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
      generation.errorMessage =
        typeof job.error === 'string'
          ? job.error
          : job.error?.message || `Video ${state}`;
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
  }

  verifyWebhook(signature: string | undefined, rawBody: Buffer | undefined) {
    const secret = this.config.get<string>('OPENROUTER_WEBHOOK_SECRET');
    if (!secret) return;
    if (!signature || !rawBody)
      throw new ForbiddenException('Thiếu chữ ký webhook');
    const values = Object.fromEntries(
      signature.split(',').map((part) => part.split('=')),
    );
    const timestamp = Number(values.t);
    if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300)
      throw new ForbiddenException('Webhook đã hết hạn');
    const expected = createHmac('sha256', secret)
      .update(`${timestamp},`)
      .update(rawBody)
      .digest('hex');
    const supplied = values.v1 || '';
    if (
      expected.length !== supplied.length ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
    ) {
      throw new ForbiddenException('Chữ ký webhook không hợp lệ');
    }
  }

  async handleVideoWebhook(body: any, signature?: string, rawBody?: Buffer) {
    this.verifyWebhook(signature, rawBody);
    const payload = body.data || body;
    const jobId = payload.id || payload.job_id;
    if (!jobId) throw new BadRequestException('Webhook thiếu job id');
    const generation = await this.generations.findOne({
      where: { externalJobId: String(jobId) },
    });
    if (!generation || ['succeeded', 'failed'].includes(generation.status))
      return { received: true };
    await this.reconcileVideo(generation, payload);
    return { received: true };
  }

  response(item: AiGeneration) {
    const linkedAssets = item.linkedAssets || [];
    const linkedInputAssets = linkedAssets
      .filter((link) => ['input', 'reference'].includes(link.role) && link.asset)
      .map((link) => ({
        id: Number(link.asset.id),
        role: link.role,
        type: link.asset.assetType,
        url: link.asset.storedUrl,
        thumbnailUrl: link.asset.thumbnailUrl,
      }));
    const inputAssets = linkedInputAssets.length
      ? linkedInputAssets
      : (item.options?.referenceUrls || []).map((url: string, index: number) => ({
          id: null,
          role: index === 0 ? 'input' : 'reference',
          type: 'image',
          url,
          thumbnailUrl: null,
        }));
    const outputAsset = linkedAssets.find(
      (link) => link.role === 'output' && link.asset,
    )?.asset;
    const displayPriceVnd =
      item.chargedVnd == null
        ? Number(item.estimatedMaxVnd)
        : Number(item.chargedVnd);
    return {
      id: item.id,
      modality: item.modality,
      modelSlug: item.modelSlug,
      modelName: item.modelNameSnapshot || item.model?.name || item.modelSlug,
      source: item.source,
      status: item.status,
      prompt: item.prompt,
      options: item.options,
      inputAssets,
      outputUrls: item.outputUrls || [],
      thumbnailUrl:
        outputAsset?.thumbnailUrl ||
        String((outputAsset?.metadata as Record<string, any>)?.thumbnailUrl || '') ||
        inputAssets[0]?.thumbnailUrl ||
        inputAssets[0]?.url ||
        (item.modality === 'image' ? item.outputUrls?.[0] : null),
      displayQuality:
        item.options?.resolution || item.options?.quality || item.options?.mode || null,
      displayPriceVnd,
      usage: item.usage || {},
      estimatedMinVnd: Number(item.estimatedMinVnd),
      estimatedMaxVnd: Number(item.estimatedMaxVnd),
      chargedVnd: item.chargedVnd == null ? null : Number(item.chargedVnd),
      errorMessage: item.errorMessage,
      createdAt: item.createdAt,
      completedAt: item.completedAt,
    };
  }
}
