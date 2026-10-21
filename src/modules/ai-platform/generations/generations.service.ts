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
import { SeedanceService } from '../seedance.service';
import { GenerationAssetsService } from './generation-assets.service';
import { chargeQuoteVnd } from '../pricing/pricing-calculator';
import { VideoReconciliationService } from './video-reconciliation.service';

interface CreateGenerationBody {
  quoteId: string;
  prompt: string;
  projectId?: number;
  referenceUrls?: string[];
  referenceAssetIds?: number[];
  elementAssetIds?: number[];
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
    private readonly seedance: SeedanceService,
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
    const isSeedance = catalogModel.provider === 'seedance';
    if (isSeedance && quote.modelSlug !== 'seedance/seedance-2.5-omni' && JSON.stringify(body.referenceAssetIds || []) !==
      JSON.stringify(quote.request?.options?.referenceAssetIds || [])) {
      throw new BadRequestException('Ảnh đã thay đổi, vui lòng lấy báo giá mới');
    }
    const isOmni = quote.modelSlug === 'kling/kling-3.0-omni';
    const isSeedanceOmni = quote.modelSlug === 'seedance/seedance-2.5-omni';
    const omniInputs: { assetId: number; type: string }[] = isOmni
      ? quote.request?.options?.referenceInputs || []
      : [];
    const seedanceInputs: { assetId: number; type: string }[] = isSeedanceOmni
      ? quote.request?.options?.referenceInputs || [] : [];
    if (isSeedanceOmni && JSON.stringify(body.referenceAssetIds || []) !==
        JSON.stringify(seedanceInputs.map((input) => input.assetId))) {
      throw new BadRequestException('Tài nguyên đã thay đổi, vui lòng lấy báo giá mới');
    }
    if (isOmni && JSON.stringify(body.referenceAssetIds || []) !==
        JSON.stringify(omniInputs.map((input) => input.assetId))) {
      throw new BadRequestException('Tài nguyên đã thay đổi, vui lòng lấy báo giá mới');
    }
    if (isOmni && JSON.stringify(body.elementAssetIds || []) !==
        JSON.stringify(quote.request?.options?.elementAssetIds || [])) {
      throw new BadRequestException('Element đã thay đổi, vui lòng lấy báo giá mới');
    }
    if (
      quote.modality === 'video' &&
      prompt.length >
        Number(catalogModel.capabilities?.maxPromptCharacters || 2500)
    ) {
      throw new BadRequestException(
        'Prompt vượt giới hạn ký tự của model',
      );
    }
    const referenceLimit =
      quote.modality === 'image'
        ? Math.max(
            0,
            Number(catalogModel.capabilities?.input_references?.max) || 0,
          )
        : quote.modality === 'video'
          ? isSeedanceOmni ? 50 : Number(catalogModel.capabilities?.maxReferenceImages || 0)
          : 0;
    const referenceAssetIds = Array.from(
      new Set(
        (isOmni ? omniInputs.map((input) => input.assetId)
          : isSeedanceOmni ? seedanceInputs.map((input) => input.assetId)
          : body.referenceAssetIds || [])
          .map(Number)
          .filter((id) => Number.isSafeInteger(id) && id > 0),
      ),
    );
    const referenceUrls = Array.from(
      new Set(
        (isOmni || isSeedanceOmni ? [] : body.referenceUrls || []).filter((url) => typeof url === 'string'),
      ),
    );
    const suppliedReferenceCount = referenceAssetIds.length
      ? referenceAssetIds.length
      : referenceUrls.length;
    if (quote.modality === 'video' && !isOmni && !isSeedanceOmni && !referenceAssetIds.length) {
      throw new BadRequestException(
        'Vui lòng tải ảnh lên thư viện trước khi tạo video',
      );
    }
    if (suppliedReferenceCount > referenceLimit + (isOmni ? 1 : 0)) {
      throw new BadRequestException(
        `Model chỉ hỗ trợ tối đa ${referenceLimit} ảnh tham chiếu`,
      );
    }
    if (
      quote.modality === 'video' && !isOmni && !isSeedanceOmni &&
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
    if (isSeedanceOmni) {
      let videoSeconds = 0;
      let audioSeconds = 0;
      for (const input of seedanceInputs) {
        const asset = referenceById.get(input.assetId);
        const seconds = Number((asset?.metadata as Record<string, any>)?.mediaDurationSeconds ?? asset?.durationSeconds);
        if (!asset || !asset.storedUrl?.startsWith('https://') ||
          (input.type === 'reference_image' && (asset.assetType !== 'image' ||
            !['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(asset.mimeType || '') ||
            (asset.width != null && (asset.width < 300 || asset.width > 6000)) ||
            (asset.height != null && (asset.height < 300 || asset.height > 6000)) ||
            (asset.width != null && asset.height != null &&
              (asset.width / asset.height < 0.4 || asset.width / asset.height > 2.5)))) ||
          (input.type === 'reference_video' && (asset.assetType !== 'video' ||
            !['video/mp4', 'video/quicktime'].includes(asset.mimeType || '') ||
            !Number.isFinite(seconds) || seconds < (quote.request?.options?.omniTaskType === 'edit' ? 4 : 2) || seconds > 30 ||
            (asset.fileSizeBytes != null && asset.fileSizeBytes > 200_000_000) ||
            (asset.width != null && (asset.width < 300 || asset.width > 6000)) ||
            (asset.height != null && (asset.height < 300 || asset.height > 6000)) ||
            (asset.width != null && asset.height != null &&
              (asset.width / asset.height < 0.4 || asset.width / asset.height > 2.5 ||
                asset.width * asset.height < 407696 || asset.width * asset.height > 8295044)) ||
            (asset.fps != null && (asset.fps < 24 || asset.fps > 60)))) ||
          (input.type === 'reference_audio' && (asset.assetType !== 'audio' ||
            !['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav'].includes(asset.mimeType || '') ||
            !Number.isFinite(seconds) || seconds < 2 || seconds > 30 ||
            (asset.fileSizeBytes != null && asset.fileSizeBytes > 15_000_000)))) {
          throw new BadRequestException('Tài nguyên Seedance Omni không đáp ứng yêu cầu của BytePlus');
        }
        if (input.type === 'reference_video') videoSeconds += seconds;
        if (input.type === 'reference_audio') audioSeconds += seconds;
      }
      if (videoSeconds > 30 || audioSeconds > 30) {
        throw new BadRequestException('Tổng thời lượng video hoặc âm thanh tham chiếu vượt 30 giây');
      }
    }
    const invalidReference = quote.modality === 'video' && !isSeedanceOmni &&
      orderedReferences.some((asset) => {
        const type = isOmni
          ? omniInputs.find((input) => input.assetId === Number(asset.id))?.type
          : 'first_frame';
        if (type?.endsWith('_video')) {
          const seconds = Number(
            (asset.metadata as Record<string, any>)?.mediaDurationSeconds ??
              asset.durationSeconds,
          );
          return asset.assetType !== 'video' ||
            !['video/mp4', 'video/quicktime'].includes(asset.mimeType || '') ||
            !Number.isFinite(seconds) || seconds < 3 || seconds > 15.5 ||
            (asset.fileSizeBytes != null && asset.fileSizeBytes > 200_000_000) ||
            asset.width == null || asset.height == null ||
            asset.width < 700 || asset.height < 700 ||
            asset.width > 4553 || asset.height > 4553 ||
            asset.width * asset.height > 8294400 ||
            asset.width / asset.height < 0.4 || asset.width / asset.height > 2 ||
            asset.fps == null || asset.fps < 24 || asset.fps > 60;
        }
        return asset.assetType !== 'image' ||
          !(isSeedance
            ? ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(asset.mimeType || '')
            : ['image/jpeg', 'image/png'].includes(asset.mimeType || '')) ||
          (asset.width != null && asset.width < 300) ||
          (asset.height != null && asset.height < 300) ||
          (asset.width != null && asset.height != null &&
            (asset.width / asset.height < 0.4 || asset.width / asset.height > 2.5)) ||
          (asset.fileSizeBytes != null &&
            asset.fileSizeBytes > Number(catalogModel.capabilities?.maxImageMb || 10) * 1024 * 1024);
      });
    if (invalidReference) {
      throw new BadRequestException(
        `Ảnh hoặc video tham chiếu không đáp ứng yêu cầu của ${isSeedance ? 'Seedance' : 'Kling'}`,
      );
    }
    if (quote.modality === 'video' && !isOmni && !isSeedanceOmni && suppliedReferenceCount === 0) {
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
      isOmni
    ) {
      const videoElements = elementAssets.filter(
        (asset) =>
          (asset.metadata as Record<string, any>)?.elementType === 'video',
      ).length;
      const imageElements = elementAssets.length - videoElements;
      const hasReferenceVideo = omniInputs.some((input) => input.type.endsWith('_video'));
      const imageCount = omniInputs.filter((input) => !input.type.endsWith('_video')).length;
      const imageLimit = hasReferenceVideo || videoElements ? 4 : 7;
      if (videoElements > (hasReferenceVideo ? 1 : 3) ||
          (hasReferenceVideo && videoElements > 0 && (imageElements > 0 || imageCount > 0)) ||
          imageCount + imageElements > imageLimit) {
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

    const resolvedOmniInputs = omniInputs.map((input) => ({
      type: input.type,
      url: referenceById.get(input.assetId)!.storedUrl,
      id: `${input.type.endsWith('_video') ? 'video' : 'image'}_${input.assetId}`,
    }));
    const resolvedSeedanceInputs = seedanceInputs.map((input) => ({
      type: input.type,
      url: referenceById.get(input.assetId)!.storedUrl,
      assetId: input.assetId,
    }));
    const options = {
      ...(quote.request?.options || {}),
      referenceUrls: orderedReferences.length
        ? orderedReferences.map((asset) => asset.storedUrl)
        : referenceUrls,
      elementIds,
      ...(isOmni ? { referenceInputs: resolvedOmniInputs } : {}),
      ...(isSeedanceOmni ? { referenceInputs: resolvedSeedanceInputs } : {}),
    };
    let generation = await this.generations.save(
      this.generations.create({
        userId,
        projectId: body.projectId,
        quoteId: quote.id,
        walletHoldId: hold.id,
        modality: quote.modality,
        modelSlug: quote.modelSlug,
        source: quote.modality === 'video' ? (isSeedance ? 'seedance' : 'kling') : 'openrouter',
        modelNameSnapshot:
          String(quote.request?.modelName || '') || quote.modelSlug,
        providerSnapshot: {
          provider: quote.modality === 'video' ? (isSeedance ? 'seedance' : 'kling') : 'openrouter',
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
    const { secureUrl: url, durationSeconds } = await this.cloudinary.uploadAudioBuffer(
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
        durationSeconds,
        mediaDurationSeconds: durationSeconds,
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
    const job = model.provider === 'seedance'
      ? model.id === 'seedance/seedance-2.5-omni'
        ? await this.seedance.submitOmni(generation.prompt, opts)
        : await this.seedance.submit(generation.prompt, opts, opts.referenceUrls || [])
      : await this.kling.submit(generation.modelSlug, generation.prompt, opts, opts.referenceUrls || []);
    if (!job.id) throw new BadRequestException('Provider không trả về mã tác vụ');
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
    const lastFrameAsset = linkedAssets.find(
      (link) => link.role === 'last_frame' && link.asset,
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
      lastFrameUrl: lastFrameAsset?.storedUrl || null,
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
