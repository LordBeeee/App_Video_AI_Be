import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CloudinaryService } from '../../../common/cloudinary/cloudinary.service';
import { Asset } from '../../assets/entities/asset.entity';
import { WalletService } from '../../wallet/wallet.service';
import { AiGeneration } from './ai-generation.entity';
import { AiGenerationAsset } from './ai-generation-asset.entity';
import { PricingQuote } from '../pricing/pricing-quote.entity';
import { OpenRouterService } from '../openrouter.service';
import { CatalogService } from '../catalog/catalog.service';
import { PricingService } from '../pricing/pricing.service';
import { KlingService } from '../kling.service';
import { GenerationAssetsService } from './generation-assets.service';
import { chargeQuoteVnd } from '../pricing/pricing-calculator';
import { VideoReconciliationService } from './video-reconciliation.service';

interface CreateGenerationBody {
  quoteId: string;
  prompt: string;
  projectId?: number;
  referenceUrls?: string[];
  referenceAssetIds?: number[];
}

@Injectable()
export class GenerationsService {
  constructor(
    @InjectRepository(AiGeneration)
    private readonly generations: Repository<AiGeneration>,
    @InjectRepository(AiGenerationAsset)
    private readonly generationAssets: Repository<AiGenerationAsset>,
    @InjectRepository(PricingQuote)
    private readonly quotes: Repository<PricingQuote>,
    @InjectRepository(Asset) private readonly assets: Repository<Asset>,
    private readonly pricing: PricingService,
    private readonly catalog: CatalogService,
    private readonly wallets: WalletService,
    private readonly openRouter: OpenRouterService,
    private readonly kling: KlingService,
    private readonly cloudinary: CloudinaryService,
    private readonly outputAssets: GenerationAssetsService,
    private readonly videoReconciliation: VideoReconciliationService,
  ) {}

  private chargeVnd(quote: PricingQuote, actualCostUsd?: number) {
    return chargeQuoteVnd(
      Number(quote.maxPriceVnd),
      Number(quote.usdVndRate),
      Number(quote.markupRate),
      actualCostUsd,
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
    const catalogModel = await this.catalog.find(
      quote.modality,
      quote.modelSlug,
    );
    if (
      quote.modality === 'video' &&
      prompt.length >
        Number(catalogModel.capabilities?.maxPromptCharacters || 2500)
    ) {
      throw new BadRequestException(
        'Prompt vượt giới hạn ký tự của model Kling',
      );
    }
    const referenceLimit =
      quote.modality === 'image'
        ? Math.max(
            0,
            Number(catalogModel.capabilities?.input_references?.max) || 0,
          )
        : quote.modality === 'video'
          ? Number(catalogModel.capabilities?.maxReferenceImages || 0)
          : 0;
    const referenceAssetIds = Array.from(
      new Set(
        (body.referenceAssetIds || [])
          .map(Number)
          .filter((id) => Number.isSafeInteger(id) && id > 0),
      ),
    );
    const referenceUrls = Array.from(
      new Set(
        (body.referenceUrls || []).filter((url) => typeof url === 'string'),
      ),
    );
    const suppliedReferenceCount = referenceAssetIds.length
      ? referenceAssetIds.length
      : referenceUrls.length;
    if (quote.modality === 'video' && !referenceAssetIds.length) {
      throw new BadRequestException(
        'Vui lòng tải ảnh lên thư viện trước khi tạo video',
      );
    }
    if (suppliedReferenceCount > referenceLimit) {
      throw new BadRequestException(
        `Model chỉ hỗ trợ tối đa ${referenceLimit} ảnh tham chiếu`,
      );
    }
    if (
      quote.modality === 'video' &&
      (quote.request?.options?.referenceMode || 'first_frame') ===
        'first_frame' &&
      suppliedReferenceCount > 2
    ) {
      throw new BadRequestException('Ảnh đầu/cuối chỉ hỗ trợ tối đa 2 ảnh');
    }
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
    if (
      quote.modality === 'video' &&
      orderedReferences.some(
        (asset) =>
          asset.assetType !== 'image' ||
          !['image/jpeg', 'image/png'].includes(asset.mimeType || '') ||
          (asset.width != null && asset.width < 300) ||
          (asset.height != null && asset.height < 300) ||
          (asset.width != null &&
            asset.height != null &&
            (asset.width / asset.height < 0.4 ||
              asset.width / asset.height > 2.5)) ||
          (asset.fileSizeBytes != null &&
            asset.fileSizeBytes >
              Number(catalogModel.capabilities?.maxImageMb || 10) *
                1024 *
                1024),
      )
    ) {
      throw new BadRequestException(
        `Ảnh Kling phải là JPG/PNG, tối thiểu 300px, tỷ lệ 1:2.5–2.5:1 và không quá ${catalogModel.capabilities?.maxImageMb || 10}MB`,
      );
    }
    if (quote.modality === 'video' && suppliedReferenceCount === 0) {
      throw new BadRequestException('Vui lòng tải ít nhất một ảnh');
    }
    const elementAssetIds: number[] =
      quote.request?.options?.elementAssetIds || [];
    if (
      elementAssetIds.length &&
      !['kling/kling-3.0', 'kling/kling-3.0-omni'].includes(quote.modelSlug)
    ) {
      throw new BadRequestException('Model không hỗ trợ Element');
    }
    const elementAssets = elementAssetIds.length
      ? await this.assets.find({ where: { id: In(elementAssetIds), userId } })
      : [];
    const elementById = new Map(
      elementAssets.map((asset) => [Number(asset.id), asset]),
    );
    const elementIds = elementAssetIds.map((id) => {
      const asset = elementById.get(id);
      const meta = asset?.metadata as Record<string, unknown> | undefined;
      if (
        !asset ||
        asset.sourceType !== 'external' ||
        asset.assetRole !== 'element' ||
        asset.storageProvider !== 'kling' ||
        meta?.provider !== 'Kling AI' ||
        !['image', 'video'].includes(String(meta?.elementType || '')) ||
        (quote.modelSlug === 'kling/kling-3.0' &&
          meta?.elementType !== 'image') ||
        meta?.status !== 'succeed' ||
        !meta?.elementId ||
        ['submitting', 'submitted', 'processing', 'succeed'].includes(
          String(meta?.deleteStatus || ''),
        )
      ) {
        throw new BadRequestException(
          'Element không tồn tại hoặc chưa sẵn sàng',
        );
      }
      return String(meta.elementId);
    });
    if (
      quote.modelSlug === 'kling/kling-3.0-omni' &&
      quote.request?.options?.referenceMode === 'refer_image'
    ) {
      const videoElements = elementAssets.filter(
        (asset) =>
          (asset.metadata as Record<string, any>)?.elementType === 'video',
      ).length;
      const imageElements = elementAssets.length - videoElements;
      const imageLimit = videoElements ? 4 : 7;
      if (suppliedReferenceCount + imageElements > imageLimit) {
        throw new BadRequestException(
          `Omni chỉ hỗ trợ tối đa ${imageLimit} ảnh và Element ảnh trong chế độ ảnh tham chiếu`,
        );
      }
    }
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
        : referenceUrls,
      elementIds,
    };
    let generation = await this.generations.save(
      this.generations.create({
        userId,
        projectId: body.projectId,
        quoteId: quote.id,
        walletHoldId: hold.id,
        modality: quote.modality,
        modelSlug: quote.modelSlug,
        source: quote.modality === 'video' ? 'kling' : 'openrouter',
        modelNameSnapshot:
          String(quote.request?.modelName || '') || quote.modelSlug,
        providerSnapshot: {
          provider: quote.modality === 'video' ? 'kling' : 'openrouter',
        },
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
        generation = await this.createImage(generation, quote, catalogModel);
      if (quote.modality === 'audio')
        generation = await this.createAudio(generation, quote);
      if (quote.modality === 'video')
        generation = await this.createVideo(generation, catalogModel);
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

  private async createImage(
    generation: AiGeneration,
    quote: PricingQuote,
    model: any,
  ) {
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
      if (
        model.capabilities?.[target] &&
        opts[source] != null &&
        opts[source] !== ''
      )
        request[target] = opts[source];
    }
    if (model.capabilities?.input_references && opts.referenceUrls?.length) {
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
      await this.outputAssets.saveOutput(
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
    const { secureUrl: url } = await this.cloudinary.uploadAudioBuffer(
      Buffer.from(response.data),
      `ai-generation/users/${generation.userId}/audio`,
      generation.id,
    );
    await this.outputAssets.saveOutput(
      generation.id,
      generation.userId,
      'audio',
      url,
      {
        generationId: generation.id,
      },
    );
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

  private async createVideo(generation: AiGeneration, model: any) {
    const opts = generation.options || {};
    const job = await this.kling.submit(
      generation.modelSlug,
      generation.prompt,
      opts,
      opts.referenceUrls || [],
    );
    if (!job.id) throw new BadRequestException('Kling không trả về mã tác vụ');
    generation.status = job.status || 'pending';
    generation.externalJobId = job.id;
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
      await this.videoReconciliation.reconcile(generation);
      generation = await this.generations.findOneOrFail({
        where: { id },
        relations: { model: true, linkedAssets: { asset: true } },
      });
    }
    return this.response(generation);
  }

  response(item: AiGeneration) {
    const linkedAssets = item.linkedAssets || [];
    const linkedInputAssets = linkedAssets
      .filter(
        (link) => ['input', 'reference'].includes(link.role) && link.asset,
      )
      .map((link) => ({
        id: Number(link.asset.id),
        role: link.role,
        type: link.asset.assetType,
        url: link.asset.storedUrl,
        thumbnailUrl: link.asset.thumbnailUrl,
      }));
    const inputAssets = linkedInputAssets.length
      ? linkedInputAssets
      : (item.options?.referenceUrls || []).map(
          (url: string, index: number) => ({
            id: null,
            role: index === 0 ? 'input' : 'reference',
            type: 'image',
            url,
            thumbnailUrl: null,
          }),
        );
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
        String(
          (outputAsset?.metadata as Record<string, any>)?.thumbnailUrl || '',
        ) ||
        inputAssets[0]?.thumbnailUrl ||
        inputAssets[0]?.url ||
        (item.modality === 'image' ? item.outputUrls?.[0] : null),
      displayQuality:
        item.options?.resolution ||
        item.options?.quality ||
        item.options?.mode ||
        null,
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
