import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AiModel } from './entities/ai-model.entity';
import { OpenRouterService } from './openrouter.service';

export type AiModality = 'image' | 'video' | 'audio' | 'chat';

const DEFAULT_VIDEO_MODEL_ALLOWLIST = [
  'google/veo-3.1',
  'google/veo-3.1-fast',
  'google/veo-3.1-lite',
  'kwaivgi/kling-v3.0-pro',
  'kwaivgi/kling-v3.0-std',
  'kwaivgi/kling-video-o1',
  'bytedance/seedance-2.5',
  'bytedance/seedance-2.0',
  'bytedance/seedance-2.0-fast',
  'bytedance/seedance-2.0-mini',
  'bytedance/seedance-1-5-pro',
];

@Injectable()
export class CatalogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CatalogService.name);
  private readonly cache = new Map<string, { expires: number; data: any[] }>();
  private refreshTimer?: NodeJS.Timeout;

  constructor(
    private readonly openRouter: OpenRouterService,
    private readonly config: ConfigService,
    @InjectRepository(AiModel)
    private readonly models: Repository<AiModel>,
  ) {}

  onModuleInit() {
    if (!this.config.get<string>('OPENROUTER_API_KEY')) return;
    this.refreshTimer = setInterval(
      () => void this.refreshAll(),
      Math.max(
        300_000,
        Number(this.config.get<string>('AI_CATALOG_REFRESH_MS')) ||
          6 * 60 * 60_000,
      ),
    );
    this.refreshTimer.unref();
  }

  onModuleDestroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  private async refreshAll() {
    for (const modality of ['image', 'video', 'audio', 'chat'] as const) {
      try {
        await this.list(modality, true);
      } catch (error) {
        this.logger.warn(
          `Không thể đồng bộ catalog ${modality}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async persist(modality: AiModality, catalog: any[]) {
    const slugs = catalog.map((item) => item.id).filter(Boolean);
    if (!slugs.length) return;
    const existing = await this.models.find({
      where: { openrouterSlug: In(slugs) },
    });
    const bySlug = new Map(existing.map((item) => [item.openrouterSlug, item]));
    const now = new Date();
    const records = catalog.map((item) => {
      const current = bySlug.get(item.id);
      return this.models.create({
        ...(current || {}),
        name: String(item.name || item.id).slice(0, 255),
        author: String(item.id).split('/')[0].slice(0, 100) || null,
        description: item.description || null,
        isActive: true,
        openrouterSlug: item.id,
        modalities: Array.from(
          new Set([
            ...(Array.isArray(current?.modalities) ? current.modalities : []),
            modality,
          ]),
        ),
        capabilities: item.capabilities || {},
        pricing: item.pricing || {},
        syncedAt: now,
      });
    });
    await this.models.save(records, { chunk: 100 });

    if (modality === 'video') {
      const allowed = new Set(slugs);
      const staleVideoModels = (await this.models.find()).filter(
        (item) =>
          item.modalities?.includes('video') &&
          !allowed.has(item.openrouterSlug),
      );

      if (staleVideoModels.length) {
        for (const item of staleVideoModels) {
          item.modalities = item.modalities.filter(
            (value) => value !== 'video',
          );
          item.isActive = item.modalities.length > 0;
          item.syncedAt = now;
        }
        await this.models.save(staleVideoModels, { chunk: 100 });
      }
    }
  }

  async list(modality: AiModality, force = false) {
    const cached = this.cache.get(modality);
    if (!force && cached && cached.expires > Date.now()) return cached.data;

    let data: any[];
    if (modality === 'image') {
      const response = await this.openRouter.listImageModels();
      data = (response.data || []).map((model: any) => ({
        id: model.id,
        name: model.name,
        description: model.description,
        modality,
        capabilities: model.supported_parameters || {},
        inputModalities: model.architecture?.input_modalities || ['text'],
        supportsStreaming: !!model.supports_streaming,
        endpointsPath: model.endpoints,
      }));
    } else if (modality === 'video') {
      const response = await this.openRouter.listVideoModels();
      const configuredAllowlist = (
        this.config.get<string>('OPENROUTER_VIDEO_MODEL_ALLOWLIST') || ''
      )
        .split(',')
        .map((slug) => slug.trim())
        .filter(Boolean);
      const videoModelAllowlist =
        configuredAllowlist.length > 0
          ? configuredAllowlist
          : DEFAULT_VIDEO_MODEL_ALLOWLIST;
      const allowedOrder = new Map(
        videoModelAllowlist.map((slug, index) => [slug, index]),
      );

      data = (response.data || [])
        .filter((model: any) => allowedOrder.has(model.id))
        .sort(
          (left: any, right: any) =>
            (allowedOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
            (allowedOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER),
        )
        .map((model: any) => ({
          id: model.id,
          name: model.name,
          description: model.description,
          modality,
          capabilities: {
            resolutions: model.supported_resolutions || [],
            aspectRatios: model.supported_aspect_ratios || [],
            sizes: model.supported_sizes || [],
            durations: model.supported_durations || [],
            frameImages: model.supported_frame_images || [],
            generateAudio: !!model.generate_audio,
            seed: !!model.seed,
          },
          pricing: model.pricing_skus || {},
          passthrough: model.allowed_passthrough_parameters || [],
        }));
    } else {
      const output = modality === 'audio' ? 'speech' : 'text';
      const response = await this.openRouter.listModels(output);
      data = (response.data || [])
        .filter(
          (model: any) =>
            modality !== 'chat' ||
            model.architecture?.output_modalities?.includes('text'),
        )
        .map((model: any) => ({
          id: model.id,
          name: model.name,
          description: model.description,
          modality,
          contextLength: model.context_length,
          maxOutputTokens: model.top_provider?.max_completion_tokens,
          capabilities: model.supported_parameters || [],
          inputModalities: model.architecture?.input_modalities || ['text'],
          voices: model.supported_voices || [],
          pricing: model.pricing || {},
        }));
    }

    await this.persist(modality, data);
    this.cache.set(modality, { expires: Date.now() + 5 * 60_000, data });
    return data;
  }

  async find(modality: AiModality, modelSlug: string) {
    const model = (await this.list(modality)).find(
      (item) => item.id === modelSlug,
    );
    if (!model)
      throw new BadRequestException(
        'Model không tồn tại hoặc không hỗ trợ loại nội dung này',
      );

    if (modality === 'image' && model.endpointsPath && !model.endpoints) {
      const result = await this.openRouter.getImageModelEndpoints(
        model.endpointsPath,
      );
      model.endpoints = result.endpoints || result.data?.endpoints || [];
    }
    return model;
  }
}
