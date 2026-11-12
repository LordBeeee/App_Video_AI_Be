import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { GenerationsService } from './generations.service';

describe('GenerationsService library quota admission', () => {
  it.each(['image', 'audio', 'video'])('rejects a new %s before wallet holds or provider calls when the library is full', async (modality) => {
    const wallets = { hold: jest.fn() };
    const providers = { create: jest.fn(), submit: jest.fn(), submitOmni: jest.fn() };
    const library = { assertStorageAvailable: jest.fn().mockRejectedValue(new ForbiddenException('Thư viện không đủ dung lượng')) };
    const quote = { modality, modelSlug: modality === 'video' ? 'kling/kling-3.0-omni' : 'test', request: { options: {} } };
    const quotes = { save: jest.fn() };
    const generations = { save: jest.fn() };
    const service = new GenerationsService(
      generations as never, {} as never, quotes as never, {} as never,
      { getValidQuote: jest.fn().mockResolvedValue(quote) } as never,
      { find: jest.fn().mockResolvedValue({ provider: 'test', capabilities: {} }) } as never,
      wallets as never, providers as never, providers as never, {} as never,
      {} as never, {} as never, providers as never, providers as never, library as never,
    );
    await expect(service.create(7, { quoteId: 'quote', prompt: 'Create content' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(library.assertStorageAvailable).toHaveBeenCalledWith(7);
    expect(wallets.hold).not.toHaveBeenCalled();
    expect(quotes.save).not.toHaveBeenCalled();
    expect(generations.save).not.toHaveBeenCalled();
    expect(providers.create).not.toHaveBeenCalled();
    expect(providers.submit).not.toHaveBeenCalled();
    expect(providers.submitOmni).not.toHaveBeenCalled();
  });
});

describe('GenerationsService speech generation', () => {
  const setup = (provider: 'google' | 'elevenlabs') => {
    const model = {
      provider, voices: ['voice-a'],
      capabilities: { responseFormat: provider === 'google' ? 'pcm' : 'mp3', speeds: provider === 'google' ? [] : [0.75, 1, 1.1, 1.2] },
    };
    const quote = {
      id: 'quote-1', modality: 'audio', modelSlug: `${provider}/tts`,
      maxPriceVnd: 4000, minPriceVnd: 1, usdVndRate: '25000', markupRate: '0',
      request: { options: { voice: 'voice-a', speed: 1 }, units: { maxOutputTokens: 16384 } },
    };
    let stored: any;
    const generations = {
      create: jest.fn((value) => ({ ...value, id: 'audio-1' })),
      save: jest.fn(async (value) => { stored = value; return value; }),
      findOneOrFail: jest.fn(async () => stored),
    };
    const wallets = {
      hold: jest.fn().mockResolvedValue({ id: 'hold-1' }),
      attachGeneration: jest.fn(), settle: jest.fn(), release: jest.fn(),
    };
    const openRouter = {
      generateSpeech: jest.fn().mockResolvedValue({ data: Buffer.from('audio'), headers: { 'x-generation-id': 'gen-audio' } }),
      getGeneration: jest.fn().mockResolvedValue({ data: { total_cost: 0.01 } }),
    };
    const cloudinary = { uploadAudioBuffer: jest.fn().mockResolvedValue({ secureUrl: 'https://example.com/audio.mp3', durationSeconds: 2, publicId: 'audio-1', fileSizeBytes: 100 }) };
    const outputAssets = { saveOutput: jest.fn() };
    const service = new GenerationsService(
      generations as never, {} as never, { save: jest.fn() } as never, {} as never,
      { getValidQuote: async () => quote } as never, { find: async () => model } as never,
      wallets as never, openRouter as never, {} as never, cloudinary as never,
      outputAssets as never, {} as never, {} as never, {} as never,
      { assertStorageAvailable: jest.fn() } as never,
    );
    return { service, quote, wallets, openRouter, cloudinary, outputAssets, generations };
  };

  it.each(['google', 'elevenlabs'] as const)('uses the existing upload, library and wallet flow for %s', async (provider) => {
    const { service, quote, wallets, openRouter, cloudinary, outputAssets } = setup(provider);
    const result = await service.create(7, { quoteId: quote.id, prompt: 'Xin chào' });
    expect(openRouter.generateSpeech).toHaveBeenCalledWith({
      model: `${provider}/tts`, input: 'Xin chào', voice: 'voice-a',
      response_format: provider === 'google' ? 'pcm' : 'mp3',
      provider: { options: provider === 'google'
        ? { 'google-ai-studio': { maxOutputTokens: 16384 } }
        : { elevenlabs: { voice_settings: { speed: 1 } } } },
    });
    expect(cloudinary.uploadAudioBuffer).toHaveBeenCalledTimes(1);
    expect(outputAssets.saveOutput).toHaveBeenCalledWith('audio-1', 7, 'audio', 'https://example.com/audio.mp3', expect.any(Object));
    expect(wallets.settle).toHaveBeenCalledWith('hold-1', 250, { generationId: 'audio-1', modality: 'audio' });
    expect(wallets.release).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'succeeded', chargedVnd: 250, outputUrls: ['https://example.com/audio.mp3'] });
  });

  it.each(['provider', 'upload'] as const)('releases the hold and records failure if %s fails', async (stage) => {
    const { service, wallets, openRouter, cloudinary, generations } = setup('google');
    (stage === 'provider' ? openRouter.generateSpeech : cloudinary.uploadAudioBuffer)
      .mockRejectedValueOnce(new Error('Speech failed'));
    await expect(service.create(7, { quoteId: 'quote-1', prompt: 'Xin chào' })).rejects.toThrow('Speech failed');
    expect(wallets.release).toHaveBeenCalledWith('hold-1', 'Speech failed');
    expect(wallets.settle).not.toHaveBeenCalled();
    expect(generations.save).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed', errorMessage: 'Speech failed' }));
  });
});

describe('GenerationsService video status', () => {
  it('reads a submitted video without calling the provider', async () => {
    const generation = {
      id: 'generation-1', userId: 7, modality: 'video', status: 'submitted',
      linkedAssets: [], outputUrls: [],
    };
    const generations = {
      findOne: jest.fn().mockResolvedValue(generation),
      findOneOrFail: jest.fn().mockResolvedValue({ ...generation, status: 'succeeded' }),
    };
    const videoReconciliation = { reconcile: jest.fn() };
    const service = new GenerationsService(
      generations as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, videoReconciliation as never,
      {} as never, {} as never,
      { assertStorageAvailable: jest.fn().mockResolvedValue({}) } as never,
    );

    const result = await service.findOne(7, generation.id);

    expect(videoReconciliation.reconcile).not.toHaveBeenCalled();
    expect(result.status).toBe('submitted');
  });
});

describe('GenerationsService video source previews', () => {
  it('includes Element previews when listing an existing generation', async () => {
    const generation = {
      id: 'generation-1', userId: 7, modality: 'video', status: 'succeeded',
      options: { elementAssetIds: [12] }, prompt: 'A character moves',
      linkedAssets: [{ role: 'input', asset: {
        id: 9, assetType: 'video', storedUrl: 'https://example.com/reference.mp4',
      } }], outputUrls: ['https://example.com/output.mp4'],
    };
    const generations = { find: jest.fn().mockResolvedValue([generation]) };
    const assets = { find: jest.fn().mockResolvedValue([{
      id: 12, assetType: 'image', storedUrl: 'https://example.com/element.png',
      thumbnailUrl: 'https://example.com/element-thumb.png',
      metadata: { name: 'Nhân vật chính' },
    }]) };
    const service = new GenerationsService(
      generations as never, {} as never, {} as never, assets as never,
      {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never,
      { assertStorageAvailable: jest.fn().mockResolvedValue({}) } as never,
    );

    const result = await service.list(7, 'video');

    expect(result.items[0].inputAssets).toMatchObject([{
      id: 9, type: 'video', url: 'https://example.com/reference.mp4',
    }]);
    expect(result.items[0].elementAssets).toEqual([{
      id: 12, type: 'image', url: 'https://example.com/element.png',
      thumbnailUrl: 'https://example.com/element-thumb.png', name: 'Nhân vật chính',
    }]);
    expect(assets.find).toHaveBeenCalledWith({
      where: { id: expect.any(Object), userId: 7 },
    });
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
      { assertStorageAvailable: jest.fn().mockResolvedValue({}) } as never,
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
      { assertStorageAvailable: jest.fn().mockResolvedValue({}) } as never,
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
    { assertStorageAvailable: jest.fn().mockResolvedValue({}) } as never,
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
    { assertStorageAvailable: jest.fn().mockResolvedValue({}) } as never,
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
