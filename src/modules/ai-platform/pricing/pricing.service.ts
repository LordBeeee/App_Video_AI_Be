import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import { CatalogService, AiModality } from '../catalog/catalog.service';
import { formatKlingShots } from '../catalog/kling-video';
import { FxService } from './fx.service';
import { PricingQuote } from './pricing-quote.entity';
import {
  calculateRetailVnd,
  estimateChatTokens,
  isQuoteExpired,
} from './pricing-calculator';

export interface QuoteRequest {
  modality: AiModality;
  modelSlug: string;
  prompt?: string;
  options?: Record<string, any>;
}

@Injectable()
export class PricingService {
  constructor(
    @InjectRepository(PricingQuote)
    private readonly quotes: Repository<PricingQuote>,
    private readonly catalog: CatalogService,
    private readonly fx: FxService,
    private readonly config: ConfigService,
  ) {}

  hashPrompt(prompt = '') {
    return createHash('sha256').update(prompt).digest('hex');
  }

  private number(value: unknown) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private validateOptions(
    modality: AiModality,
    model: any,
    options: Record<string, any>,
  ) {
    const caps = model.capabilities || {};
    const check = (value: any, allowed: any[], label: string) => {
      if (
        value != null &&
        value !== '' &&
        (!allowed?.length || !allowed.map(String).includes(String(value)))
      ) {
        throw new BadRequestException(`${label} không được model hỗ trợ`);
      }
    };
    const checkImage = (
      optionKey: string,
      capabilityKey: string,
      label: string,
    ) => {
      const value = options[optionKey];
      if (value == null || value === '') return;
      const capability = caps[capabilityKey];
      if (!capability) {
        throw new BadRequestException(`${label} không được model hỗ trợ`);
      }
      if (Array.isArray(capability.values)) {
        check(value, capability.values, label);
      }
      if (capability.type === 'range') {
        const numeric = Number(value);
        if (
          !Number.isFinite(numeric) ||
          (['n', 'seed'].includes(optionKey) && !Number.isInteger(numeric)) ||
          (capability.min != null && numeric < Number(capability.min)) ||
          (capability.max != null && numeric > Number(capability.max))
        ) {
          throw new BadRequestException(`${label} không được model hỗ trợ`);
        }
      }
    };
    if (modality === 'image') {
      checkImage('aspectRatio', 'aspect_ratio', 'Tỷ lệ');
      checkImage('resolution', 'resolution', 'Độ phân giải');
      checkImage('size', 'size', 'Kích thước');
      checkImage('quality', 'quality', 'Chất lượng');
      checkImage('outputFormat', 'output_format', 'Định dạng');
      checkImage('background', 'background', 'Nền');
      checkImage('outputCompression', 'output_compression', 'Độ nén');
      checkImage('n', 'n', 'Số lượng');
      checkImage('seed', 'seed', 'Seed');
    }
    if (modality === 'video') {
      if (model.provider === 'seedance' && !model.capabilities?.omniTaskTypes) {
        const ids = options.referenceAssetIds;
        if (!Array.isArray(ids) || ids.length < 1 || ids.length > 2 ||
          ids.some((id: unknown) => !Number.isSafeInteger(id) || Number(id) < 1) ||
          new Set(ids).size !== ids.length) {
          throw new BadRequestException('Seedance cần 1 ảnh đầu và tối đa 1 ảnh cuối');
        }
        if ((model.id === 'seedance/seedance-2.5' && options.aspectRatio) ||
          options.omniTaskType || options.referenceInputs || options.referenceMode ||
          options.elementAssetIds?.length || options.multiShot || options.customShots ||
          options.audioMode || options.size || options.seed) {
          throw new BadRequestException('Tùy chọn không được Seedance image-to-video hỗ trợ');
        }
      }
      if (model.provider === 'seedance' && model.capabilities?.omniTaskTypes) {
        const inputs = options.referenceInputs;
        const task = options.omniTaskType;
        const isSeedance25 = model.id === 'seedance/seedance-2.5-omni';
        const caps = model.capabilities;
        if (!['reference', 'edit', 'extend'].includes(task) ||
          !Number.isInteger(options.duration) ||
          !Array.isArray(inputs) || inputs.length < 1 ||
          inputs.length > caps.maxReferenceImages + caps.maxReferenceVideos + caps.maxReferenceAudios ||
          inputs.some((input: any) => !input ||
            !Number.isSafeInteger(input.assetId) || input.assetId < 1 ||
            !['reference_image', 'reference_video', 'reference_audio'].includes(input.type)) ||
          new Set(inputs.map((input: any) => input.assetId)).size !== inputs.length ||
          inputs.filter((input: any) => input.type === 'reference_image').length > caps.maxReferenceImages ||
          inputs.filter((input: any) => input.type === 'reference_video').length > caps.maxReferenceVideos ||
          inputs.filter((input: any) => input.type === 'reference_audio').length > caps.maxReferenceAudios ||
          (task === 'reference' && !inputs.some((input: any) =>
            ['reference_image', 'reference_video'].includes(input.type))) ||
          (task !== 'reference' && !inputs.some((input: any) => input.type === 'reference_video')) ||
          (isSeedance25 && task === 'edit' && Number(options.duration) !== -1) ||
          (isSeedance25 && task !== 'reference' && ![undefined, 'adaptive'].includes(options.aspectRatio)) ||
          options.referenceMode || options.elementAssetIds?.length ||
          options.multiShot || options.customShots || options.audioMode ||
          options.size || options.seed) {
          throw new BadRequestException('Tài nguyên hoặc tùy chọn Seedance Omni không hợp lệ');
        }
      }
      const omniInputs = options.referenceInputs;
      if (omniInputs != null && model.id === 'kling/kling-3.0-omni') {
        if (
          model.id !== 'kling/kling-3.0-omni' ||
          !Array.isArray(omniInputs) ||
          omniInputs.length > 8 ||
          omniInputs.some(
            (input: any) =>
              !input ||
              !Number.isSafeInteger(input.assetId) ||
              input.assetId < 1 ||
              ![
                'first_frame',
                'last_frame',
                'refer_image',
                'feature_video',
                'base_video',
              ].includes(input.type),
          ) ||
          new Set(omniInputs.map((input: any) => input.assetId)).size !==
            omniInputs.length
        ) {
          throw new BadRequestException('Tài nguyên tham chiếu Omni không hợp lệ');
        }
        const types = omniInputs.map((input: any) => input.type);
        const videos = types.filter((type: string) => type.endsWith('_video'));
        if (
          videos.length > 1 ||
          types.filter((type: string) => type === 'first_frame').length > 1 ||
          types.filter((type: string) => type === 'last_frame').length > 1 ||
          (types.includes('last_frame') && !types.includes('first_frame')) ||
          (videos.includes('base_video') &&
            (types.includes('first_frame') || types.includes('last_frame'))) ||
          (videos.includes('base_video') && options.multiShot === true) ||
          (videos.includes('feature_video') && options.multiShot !== true) ||
          (videos.length && options.generateAudio === true) ||
          (options.audioMode === 'original' && !videos.includes('base_video'))
        ) {
          throw new BadRequestException('Tổ hợp tham chiếu Omni không được hỗ trợ');
        }
      }
      const elementAssetIds = options.elementAssetIds;
      if (
        elementAssetIds != null &&
        (!['kling/kling-3.0', 'kling/kling-3.0-omni'].includes(model.id) ||
          !Array.isArray(elementAssetIds) ||
          elementAssetIds.length > 3 ||
          elementAssetIds.some(
            (id: unknown) => !Number.isSafeInteger(id) || Number(id) < 1,
          ) ||
          new Set(elementAssetIds).size !== elementAssetIds.length)
      ) {
        throw new BadRequestException(
          'Element chỉ hỗ trợ tối đa 3 mục cho Kling 3.0/3.0 Omni',
        );
      }
      check(options.resolution, caps.resolutions, 'Độ phân giải');
      check(options.aspectRatio, caps.aspectRatios, 'Tỷ lệ');
      check(options.size, caps.sizes, 'Kích thước');
      check(options.duration, caps.durations, 'Thời lượng');
      if (options.size && (options.resolution || options.aspectRatio)) {
        throw new BadRequestException(
          'Kích thước không dùng cùng tỷ lệ hoặc độ phân giải',
        );
      }
      if (options.generateAudio === true && !caps.generateAudio) {
        throw new BadRequestException('Model không hỗ trợ tạo âm thanh');
      }
      if (options.audioMode != null &&
          (model.id !== 'kling/kling-3.0-omni' ||
            !['off', 'native', 'original'].includes(options.audioMode) ||
            (options.audioMode === 'native' && options.generateAudio !== true) ||
            (options.audioMode === 'off' && options.generateAudio === true))) {
        throw new BadRequestException('Chế độ âm thanh không hợp lệ');
      }
      if (options.multiShot === true && !caps.multiShot) {
        throw new BadRequestException('Model không hỗ trợ chế độ nhiều cảnh');
      }
      if (options.customShots === true) {
        const shots = options.shots;
        if (
          options.multiShot !== true ||
          !caps.multiShot ||
          !Array.isArray(shots) ||
          shots.length < 1 ||
          shots.length > 6 ||
          shots.some(
            (shot: any) =>
              !shot ||
              typeof shot.prompt !== 'string' ||
              !shot.prompt.trim() ||
              shot.prompt.trim().length > 512 ||
              shot.prompt.includes(';') ||
              !Number.isInteger(shot.duration) ||
              shot.duration < 1,
          ) ||
          shots.reduce(
            (total: number, shot: any) => total + shot.duration,
            0,
          ) !== Number(options.duration)
        ) {
          throw new BadRequestException(
            'Các shot phải có mô tả và tổng thời gian bằng thời lượng video',
          );
        }
        if (
          formatKlingShots(shots).length >
          Number(caps.maxPromptCharacters || 3072)
        ) {
          throw new BadRequestException(
            'Prompt nhiều cảnh vượt giới hạn ký tự',
          );
        }
      } else if (options.shots?.length) {
        throw new BadRequestException(
          'Chỉ gửi các shot khi bật chế độ tùy chỉnh',
        );
      }
      check(options.referenceMode, caps.referenceModes, 'Chế độ ảnh');
      if (options.seed != null && options.seed !== '' && !caps.seed) {
        throw new BadRequestException('Model không hỗ trợ seed');
      }
      if (
        options.seed != null &&
        options.seed !== '' &&
        !Number.isInteger(Number(options.seed))
      ) {
        throw new BadRequestException('Seed phải là số nguyên');
      }
    }
    if (modality === 'audio' && options.voice && model.voices?.length) {
      check(options.voice, model.voices, 'Giọng đọc');
    }
  }

  private imageCost(model: any, options: Record<string, any>) {
    const endpoints = model.endpoints || [];
    const endpoint =
      endpoints.find((item: any) => item.provider_tag) || endpoints[0];
    const lines = endpoint?.pricing || [];
    const count = Math.max(1, Math.min(10, this.number(options.n) || 1));
    const variant = String(
      options.resolution || options.quality || '',
    ).toLowerCase();
    const matching = lines.find(
      (line: any) =>
        line.billable === 'output_image' &&
        (!line.variant || String(line.variant).toLowerCase() === variant),
    );
    const base =
      matching ||
      lines.find((line: any) => line.billable === 'output_image') ||
      lines[0];
    if (!base) return 0;
    const multiplier = base.unit === 'image' ? count : count;
    return this.number(base.cost_usd) * multiplier;
  }

  private videoCost(model: any, options: Record<string, any>) {
    if (model.provider === 'seedance') {
      const resolution = String(options.resolution || '720p');
      const duration = Number(options.duration === -1
        ? Math.max(...model.capabilities.durations) : options.duration || 5);
      const hasVideo = options.referenceInputs?.some((input: any) => input.type === 'reference_video');
      const inputDuration = hasVideo ? Number(model.capabilities.maxReferenceVideoSeconds || 30) : 0;
      // BytePlus bills output tokens; reserve above the documented estimate.
      const shortSide: Record<string, number> = {
        '480p': 480, '720p': 720, '1080p': 1080, '4k': 2160,
      };
      const side = shortSide[resolution];
      const rate = this.seedanceTokenRate(model, options);
      if (!side || !Number.isFinite(rate)) return 0;
      // Input image ratio may reach 2.5:1; reserve for the largest output canvas.
      return ((duration + inputDuration) * side * side * 2.5 * 24 / 1024) * rate / 1_000_000 * 1.25;
    }
    if (model.provider === 'kling') {
      const resolution = String(
        options.resolution || model.capabilities.resolutions[0],
      );
      const duration = Number(
        options.duration ||
          (model.capabilities.durations.includes(5)
            ? 5
            : model.capabilities.durations[0]),
      );
      const rate = model.pricing.perSecond[resolution];
      const hasVideoInput = model.id === 'kling/kling-3.0-omni' &&
        options.referenceInputs?.some((input: any) =>
          ['feature_video', 'base_video'].includes(input.type));
      const unitsPerSecond = Number(
        rate?.[
          hasVideoInput
            ? 'withVideo'
            : model.capabilities.nativeAudioIncluded
            ? 'includedAudio'
            : options.generateAudio
              ? 'withAudio'
              : 'noAudio'
        ],
      );
      if (!Number.isFinite(unitsPerSecond) || !Number.isFinite(duration))
        return 0;
      const usdPerUnit = Number(
        this.config.get<string>('KLING_USD_PER_API_UNIT') || 0.14,
      );
      if (!(usdPerUnit > 0)) return 0;
      return unitsPerSecond * duration * usdPerUnit;
    }
    const pricing = model.pricing || {};
    const entries = Object.entries(pricing) as [string, any][];
    const resolution = String(options.resolution || '').toLowerCase();
    const audio = !!options.generateAudio;
    const preferred =
      entries.find(([key]) => {
        const normalized = key.toLowerCase();
        return (
          (!resolution || normalized.includes(resolution)) &&
          (!audio || normalized.includes('audio'))
        );
      }) ||
      entries.find(
        ([key]) => resolution && key.toLowerCase().includes(resolution),
      ) ||
      entries.find(([key]) => key.toLowerCase().includes('per-video-second')) ||
      entries[0];
    if (!preferred) return 0;
    const [sku, raw] = preferred;
    const unitCost = this.number(raw);
    return sku.toLowerCase().includes('second')
      ? unitCost * (this.number(options.duration) || 1)
      : unitCost;
  }

  private seedanceTokenRate(model: any, options: Record<string, any>) {
    const rate = model.pricing.perMillionTokens[options.resolution || '720p'];
    const hasVideo = options.referenceInputs?.some((input: any) => input.type === 'reference_video');
    return Number(typeof rate === 'number' ? rate : rate?.[hasVideo ? 'withVideo' : 'withoutVideo']);
  }

  private audioCost(model: any, prompt: string) {
    const perCharacter = this.number(
      model.pricing?.prompt || model.pricing?.input || model.pricing?.request,
    );
    return perCharacter * prompt.length;
  }

  private chatCost(model: any, prompt: string, options: Record<string, any>) {
    const { inputTokens, maxOutputTokens } = estimateChatTokens(
      prompt,
      options.maxOutputTokens,
      model.maxOutputTokens,
    );
    const inputCost = inputTokens * this.number(model.pricing?.prompt);
    const outputCost = maxOutputTokens * this.number(model.pricing?.completion);
    return {
      min: inputCost,
      max: inputCost + outputCost,
      inputTokens,
      maxOutputTokens,
    };
  }

  async createQuote(userId: number, request: QuoteRequest) {
    if (!['image', 'video', 'audio', 'chat'].includes(request.modality)) {
      throw new BadRequestException('Loại nội dung không hợp lệ');
    }
    if (!request.modelSlug) throw new BadRequestException('Model là bắt buộc');
    const prompt = String(request.prompt || '').trim();
    const options = request.options || {};
    const model = await this.catalog.find(request.modality, request.modelSlug);
    this.validateOptions(request.modality, model, options);
    if (
      request.modality === 'video' &&
      prompt.length > Number(model.capabilities?.maxPromptCharacters || 2500)
    ) {
      throw new BadRequestException(
        'Prompt vượt giới hạn ký tự của model',
      );
    }
    if (
      request.modality === 'video' &&
      options.customShots === true &&
      prompt !== formatKlingShots(options.shots)
    ) {
      throw new BadRequestException('Nội dung shot không khớp với prompt');
    }

    let minUsd = 0;
    let maxUsd = 0;
    let units: Record<string, any> = {};
    if (request.modality === 'image')
      minUsd = maxUsd = this.imageCost(model, options);
    if (request.modality === 'video')
      minUsd = maxUsd = this.videoCost(model, options);
    if (request.modality === 'video' && model.provider === 'kling') {
      const usdPerUnit = Number(
        this.config.get<string>('KLING_USD_PER_API_UNIT') || 0.14,
      );
      units = {
        estimatedUnits: maxUsd / usdPerUnit,
        usdPerUnit,
        basis: model.pricing.source,
      };
    }
    if (request.modality === 'video' && model.provider === 'seedance') {
      units = {
        usdPerMillionTokens: this.seedanceTokenRate(model, options),
        basis: model.pricing.source,
      };
    }
    if (request.modality === 'audio')
      minUsd = maxUsd = this.audioCost(model, prompt);
    if (request.modality === 'chat') {
      const chat = this.chatCost(model, prompt, options);
      minUsd = chat.min;
      maxUsd = chat.max;
      units = {
        inputTokens: chat.inputTokens,
        maxOutputTokens: chat.maxOutputTokens,
      };
    }
    if (!(maxUsd > 0)) {
      throw new BadRequestException(
        'Model chưa có dữ liệu giá phù hợp với lựa chọn này',
      );
    }

    const fx = await this.fx.getUsdVndRate();
    const markupRate = Number(
      request.modality === 'video' && model.provider === 'kling'
        ? (this.config.get<string>('KLING_VIDEO_MARKUP_RATE') ?? '0')
        : (this.config.get<string>('AI_MARKUP_RATE') ?? '0.20'),
    );
    const minPriceVnd = calculateRetailVnd(minUsd, fx.rate, markupRate);
    const maxPriceVnd = calculateRetailVnd(maxUsd, fx.rate, markupRate);
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const quote = this.quotes.create({
      userId,
      modality: request.modality,
      modelSlug: request.modelSlug,
      request: {
        options,
        modelName: model.name || request.modelSlug,
        promptHash: this.hashPrompt(prompt),
        promptLength: prompt.length,
        units,
        ...(request.modality === 'video' && ['kling', 'seedance'].includes(model.provider)
          ? {
              priceBasis: model.pricing.unitType,
              priceSource: model.pricing.source,
            }
          : {}),
        fxSource: fx.source,
      },
      providerCostMinUsd: String(minUsd),
      providerCostMaxUsd: String(maxUsd),
      usdVndRate: String(fx.rate),
      markupRate: String(markupRate),
      minPriceVnd,
      maxPriceVnd,
      expiresAt,
    });
    await this.quotes.save(quote);
    return this.toResponse(quote);
  }

  async getValidQuote(userId: number, quoteId: string, prompt: string) {
    const quote = await this.quotes.findOne({ where: { id: quoteId, userId } });
    if (!quote) throw new BadRequestException('Báo giá không tồn tại');
    if (quote.consumedAt)
      throw new BadRequestException('Báo giá đã được sử dụng');
    if (isQuoteExpired(quote.expiresAt))
      throw new BadRequestException('Báo giá đã hết hạn');
    if (quote.request?.promptHash !== this.hashPrompt(prompt)) {
      throw new BadRequestException(
        'Nội dung đã thay đổi, vui lòng lấy báo giá mới',
      );
    }
    return quote;
  }

  toResponse(quote: PricingQuote) {
    return {
      quoteId: quote.id,
      modality: quote.modality,
      modelSlug: quote.modelSlug,
      minPriceVnd: Number(quote.minPriceVnd),
      maxPriceVnd: Number(quote.maxPriceVnd),
      providerCostUsd: {
        min: Number(quote.providerCostMinUsd),
        max: Number(quote.providerCostMaxUsd),
      },
      usdVndRate: Number(quote.usdVndRate),
      markupRate: Number(quote.markupRate),
      details: quote.request?.units || {},
      expiresAt: quote.expiresAt,
    };
  }
}
