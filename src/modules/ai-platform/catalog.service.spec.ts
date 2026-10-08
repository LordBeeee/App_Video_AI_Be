import { BadRequestException } from '@nestjs/common';
import { CatalogService } from './catalog.service';

describe('CatalogService', () => {
  const allowedVideoSlugs = [
    'google/veo-3.1',
    'kwaivgi/kling-v3.0-pro',
    'bytedance/seedance-2.5',
  ];
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
          },
          {
            id: 'openai/gpt-image-2',
            name: 'OpenAI: GPT Image 2',
          },
        ],
      }),
      listVideoModels: jest.fn().mockResolvedValue({
        data: [
          {
            id: 'runway/gen-4.5',
            name: 'Runway: Gen-4.5',
            supported_resolutions: ['720p'],
          },
          {
            id: 'bytedance/seedance-2.5',
            name: 'ByteDance: Seedance 2.5',
            supported_resolutions: ['720p'],
          },
          {
            id: 'google/veo-3.1',
            name: 'Google: Veo 3.1',
            supported_resolutions: ['1080p'],
          },
          {
            id: 'kwaivgi/kling-v3.0-pro',
            name: 'Kling: Video v3.0 Pro',
            supported_resolutions: ['720p'],
          },
        ],
      }),
    };
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'OPENROUTER_IMAGE_MODEL_ALLOWLIST')
          return allowedImageSlugs.join(',');
        if (key === 'OPENROUTER_VIDEO_MODEL_ALLOWLIST')
          return allowedVideoSlugs.join(',');
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

  it('returns only configured video models in allowlist order', async () => {
    const { service } = createService();

    const result = await service.list('video');

    expect(result.map((model) => model.id)).toEqual(allowedVideoSlugs);
    expect(result.some((model) => model.id === 'runway/gen-4.5')).toBe(false);
  });

  it('returns only configured image models in allowlist order', async () => {
    const { service } = createService();

    const result = await service.list('image');

    expect(result.map((model) => model.id)).toEqual(allowedImageSlugs);
    expect(
      result.some((model) => model.id === 'black-forest-labs/flux.3-image'),
    ).toBe(false);
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
