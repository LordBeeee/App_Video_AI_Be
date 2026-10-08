import { BadRequestException } from '@nestjs/common';
import { CatalogService } from './catalog.service';

describe('CatalogService', () => {
  const allowedSlugs = [
    'google/veo-3.1',
    'kwaivgi/kling-v3.0-pro',
    'bytedance/seedance-2.5',
  ];

  const createService = () => {
    const openRouter = {
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
      get: jest.fn((key: string) =>
        key === 'OPENROUTER_VIDEO_MODEL_ALLOWLIST'
          ? allowedSlugs.join(',')
          : undefined,
      ),
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

    expect(result.map((model) => model.id)).toEqual(allowedSlugs);
    expect(result.some((model) => model.id === 'runway/gen-4.5')).toBe(false);
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
});
