import { BadRequestException } from '@nestjs/common';
import { GenerationsService } from './generations.service';

describe('GenerationsService video status', () => {
  it('reconciles a submitted video when the user polls it', async () => {
    const generation = {
      id: 'generation-1', userId: 7, modality: 'video', status: 'submitted',
      linkedAssets: [], outputUrls: [],
    };
    const generations = {
      findOne: jest.fn().mockResolvedValue(generation),
      findOneOrFail: jest.fn().mockResolvedValue({ ...generation, status: 'succeeded' }),
    };
    const videoReconciliation = { reconcile: jest.fn().mockResolvedValue(undefined) };
    const service = new GenerationsService(
      generations as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, videoReconciliation as never,
      {} as never, {} as never,
    );

    const result = await service.findOne(7, generation.id);

    expect(videoReconciliation.reconcile).toHaveBeenCalledWith(generation);
    expect(result.status).toBe('succeeded');
  });
});

describe('GenerationsService Seedance quote binding', () => {
  it('routes Seedance 2.0 Omni through the shared Seedance service', async () => {
    const seedance = { submitOmni: jest.fn().mockResolvedValue({ id: 'task-2', status: 'queued' }) };
    const generations = { save: jest.fn(async (value: any) => value) };
    const service = new GenerationsService(
      generations as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never, seedance as never, {} as never,
    );
    const generation = { prompt: 'Extend @video_1', options: { omniTaskType: 'extend' } };
    await (service as any).createVideo(generation, {
      provider: 'seedance', apiModel: 'dreamina-seedance-2-0-260128',
      capabilities: { omniTaskTypes: ['reference', 'edit', 'extend'] },
    });
    expect(seedance.submitOmni).toHaveBeenCalledWith(
      generation.prompt, generation.options, 'dreamina-seedance-2-0-260128',
    );
    expect(generation).toMatchObject({ status: 'queued', externalJobId: 'task-2' });
  });

  it('rejects changed frame assets before holding the wallet', async () => {
    const wallets = { hold: jest.fn() };
    const service = new GenerationsService(
      {} as never, {} as never, {} as never, {} as never,
      { getValidQuote: jest.fn().mockResolvedValue({
        modality: 'video', modelSlug: 'seedance/seedance-2.5',
        request: { options: { referenceAssetIds: [1] } },
      }) } as never,
      { find: jest.fn().mockResolvedValue({ provider: 'seedance' }) } as never,
      wallets as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never,
    );
    await expect(service.create(7, {
      quoteId: 'quote-1', prompt: 'Camera moves', referenceAssetIds: [2],
    })).rejects.toThrow('Ảnh đã thay đổi');
    expect(wallets.hold).not.toHaveBeenCalled();
  });
});

describe('GenerationsService Kling Element validation', () => {
  const quote = {
    id: 'quote-1',
    modality: 'video',
    modelSlug: 'kling/kling-3.0',
    request: { options: { elementAssetIds: [2], duration: 5 } },
  };
  const frame = {
    id: 1,
    assetType: 'image',
    mimeType: 'image/png',
    storedUrl: 'https://example.com/frame.png',
  };
  const assets = { find: jest.fn() };
  const wallets = { hold: jest.fn() };
  const service = new GenerationsService(
    {} as never,
    {} as never,
    {} as never,
    assets as never,
    { getValidQuote: jest.fn().mockResolvedValue(quote) } as never,
    {
      find: jest.fn().mockResolvedValue({
        capabilities: { maxReferenceImages: 2, maxPromptCharacters: 2500 },
      }),
    } as never,
    wallets as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => {
    assets.find.mockReset();
    wallets.hold.mockReset();
  });

  it('rejects prompts longer than the Kling 3.0 product limit', async () => {
    await expect(
      service.create(7, {
        quoteId: 'quote-1',
        prompt: 'x'.repeat(2501),
        referenceAssetIds: [1],
      }),
    ).rejects.toThrow('Prompt vượt giới hạn ký tự');
    expect(wallets.hold).not.toHaveBeenCalled();
  });

  it('rejects an Element outside the user account before reserving payment', async () => {
    assets.find.mockResolvedValueOnce([frame]).mockResolvedValueOnce([]);
    await expect(
      service.create(7, {
        quoteId: 'quote-1',
        prompt: 'The hero waves',
        referenceAssetIds: [1],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(wallets.hold).not.toHaveBeenCalled();
  });

  it.each([
    { width: 299, height: 500 },
    { width: 500, height: 299 },
  ])('rejects a frame smaller than 300 px before reserving payment: %j', async (dimensions) => {
    assets.find.mockResolvedValueOnce([{ ...frame, ...dimensions }]);
    await expect(service.create(7, {
      quoteId: 'quote-1', prompt: 'The hero waves', referenceAssetIds: [1],
    })).rejects.toThrow('Ảnh cần có chiều rộng và chiều cao tối thiểu 300 px.');
    expect(wallets.hold).not.toHaveBeenCalled();
  });

  it('rejects an Element that is still processing before reserving payment', async () => {
    assets.find.mockResolvedValueOnce([frame]).mockResolvedValueOnce([
      {
        id: 2,
        sourceType: 'external',
        storageProvider: 'kling',
        assetRole: 'element',
        metadata: {
          provider: 'Kling AI',
          elementType: 'image',
          status: 'processing',
        },
      },
    ]);
    await expect(
      service.create(7, {
        quoteId: 'quote-1',
        prompt: 'The hero waves',
        referenceAssetIds: [1],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(wallets.hold).not.toHaveBeenCalled();
  });
});

describe('GenerationsService Omni asset checks', () => {
  const quote = {
    id: 'omni-quote',
    modality: 'video',
    modelSlug: 'kling/kling-3.0-omni',
    request: { options: {
      referenceInputs: [{ assetId: 9, type: 'base_video' }],
      elementAssetIds: [],
    } },
  };
  const assets = { find: jest.fn() };
  const wallets = { hold: jest.fn() };
  const service = new GenerationsService(
    {} as never, {} as never, {} as never, assets as never,
    { getValidQuote: jest.fn().mockResolvedValue(quote) } as never,
    { find: jest.fn().mockResolvedValue({ capabilities: {
      maxReferenceImages: 7, maxImageMb: 50, maxPromptCharacters: 3072,
    } }) } as never,
    wallets as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
  );

  beforeEach(() => { assets.find.mockReset(); wallets.hold.mockReset(); });

  it('rejects an expired reference video before reserving payment', async () => {
    assets.find.mockResolvedValue([{ id: 9, assetType: 'video',
      mimeType: 'video/mp4', storedUrl: 'https://example.com/long.mp4',
      metadata: { mediaDurationSeconds: 20 }, width: 1920, height: 1080,
      fps: 30, fileSizeBytes: 1_000_000,
    }]);
    await expect(service.create(7, { quoteId: 'omni-quote',
      prompt: 'change the scene', referenceAssetIds: [9], elementAssetIds: [],
    })).rejects.toThrow('Ảnh hoặc video tham chiếu');
    expect(wallets.hold).not.toHaveBeenCalled();
  });
});
