import { BadRequestException } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { KLING_VIDEO_MODELS } from './kling-video';
import { SEEDANCE_VIDEO_MODELS } from './seedance-video';

describe('CatalogService', () => {
  const allowedImageSlugs = [
    'bytedance-seed/seedream-5-0-pro',
    'openai/gpt-image-2',
    'google/gemini-nano-banana-2.1',
  ];

  const createService = () => {
    const openRouter = {
      listImageModels: jest.fn().mockResolvedValue({
        data: [
          {
            id: 'black-forest-labs/flux.3-image',
            name: 'Black Forest Labs: FLUX.3 Image',
          },
          {
            id: 'google/gemini-nano-banana-2.1',
            name: 'Google: Nano Banana 2.1',
          },
          {
            id: 'bytedance-seed/seedream-5-0-pro',
            name: 'ByteDance Seed: Seedream 5.0 Pro',
            supported_parameters: {
              resolution: { type: 'enum', values: ['1K', '2K'] },
              input_references: { type: 'range', min: 0, max: 14 },
              n: { type: 'range', min: 1, max: 1 },
              seed: { type: 'boolean' },
            },
          },
          {
            id: 'openai/gpt-image-2',
            name: 'OpenAI: GPT Image 2',
          },
        ],
      }),
    };
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'OPENROUTER_IMAGE_MODEL_ALLOWLIST')
          return allowedImageSlugs.join(',');
        return undefined;
      }),
    };
    const models = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((value) => value),
      save: jest.fn().mockResolvedValue(undefined),
    };

    return {
      service: new CatalogService(
        openRouter as never,
        config as never,
        models as never,
      ),
      models,
    };
  };

  it('returns direct Kling video models without querying OpenRouter', async () => {
    const { service } = createService();

    const result = await service.list('video');

    expect(result.map((model) => model.id)).toEqual(
      [...KLING_VIDEO_MODELS, ...SEEDANCE_VIDEO_MODELS].map((model) => model.id),
    );
    expect(result.some((model) => model.id === 'runway/gen-4.5')).toBe(false);
  });

  it('returns only configured image models in allowlist order', async () => {
    const { service } = createService();

    const result = await service.list('image');

    expect(result.map((model) => model.id)).toEqual(allowedImageSlugs);
    expect(
      result.some((model) => model.id === 'black-forest-labs/flux.3-image'),
    ).toBe(false);
    expect(result[0].capabilities.input_references.max).toBe(14);
    expect(result[0].capabilities.n).toEqual({
      type: 'range',
      min: 1,
      max: 1,
    });
  });

  it('rejects an image model outside the allowlist', async () => {
    const { service } = createService();

    await expect(
      service.find('image', 'black-forest-labs/flux.3-image'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a video model outside the allowlist', async () => {
    const { service } = createService();

    await expect(
      service.find('video', 'runway/gen-4.5'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps old model records but removes their video availability', async () => {
    const { service, models } = createService();
    const stale = {
      openrouterSlug: 'runway/gen-4.5',
      modalities: ['video'],
      isActive: true,
      syncedAt: null,
    };
    models.find.mockResolvedValueOnce([]).mockResolvedValueOnce([stale]);

    await service.list('video');

    expect(stale.modalities).toEqual([]);
    expect(stale.isActive).toBe(false);
    expect(models.save).toHaveBeenLastCalledWith([stale], { chunk: 100 });
  });

  it('keeps old model records but removes their image availability', async () => {
    const { service, models } = createService();
    const stale = {
      openrouterSlug: 'black-forest-labs/flux.3-image',
      modalities: ['image'],
      isActive: true,
      syncedAt: null,
    };
    models.find.mockResolvedValueOnce([]).mockResolvedValueOnce([stale]);

    await service.list('image');

    expect(stale.modalities).toEqual([]);
    expect(stale.isActive).toBe(false);
    expect(models.save).toHaveBeenLastCalledWith([stale], { chunk: 100 });
  });
});
