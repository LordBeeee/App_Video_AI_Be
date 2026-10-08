import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import { CatalogService, AiModality } from './catalog.service';
import { FxService } from './fx.service';
import { PricingQuote } from './entities/pricing-quote.entity';
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
        allowed?.length &&
        !allowed.map(String).includes(String(value))
      ) {
        throw new BadRequestException(`${label} không được model hỗ trợ`);
      }
    };
    if (modality === 'video') {
      check(options.resolution, caps.resolutions, 'Độ phân giải');
      check(options.aspectRatio, caps.aspectRatios, 'Tỷ lệ');
      check(options.duration, caps.durations, 'Thời lượng');
      if (options.generateAudio && !caps.generateAudio) {
        throw new BadRequestException('Model không hỗ trợ tạo âm thanh');
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
    const prompt = String(request.prompt || '');
    const options = request.options || {};
    const model = await this.catalog.find(request.modality, request.modelSlug);
    this.validateOptions(request.modality, model, options);

    let minUsd = 0;
    let maxUsd = 0;
    let units: Record<string, any> = {};
    if (request.modality === 'image')
      minUsd = maxUsd = this.imageCost(model, options);
    if (request.modality === 'video')
      minUsd = maxUsd = this.videoCost(model, options);
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
      this.config.get<string>('AI_MARKUP_RATE') || '0.20',
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
