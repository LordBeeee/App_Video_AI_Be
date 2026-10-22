import { BadRequestException } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { KLING_VIDEO_MODELS } from '../catalog/kling-video';
import { SEEDANCE_VIDEO_MODELS } from '../catalog/seedance-video';
import { VEO_VIDEO_MODELS } from '../catalog/veo-video';
import { seedanceOutputDimensions } from './seedance-pricing';

describe('PricingService option validation', () => {
  const service = new PricingService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  const validate = (
    modality: 'image' | 'video',
    capabilities: Record<string, any>,
    options: Record<string, any>,
  ) => (service as any).validateOptions(modality, { capabilities }, options);

  it('limits Veo to a first frame and optional last frame', () => {
    const model = VEO_VIDEO_MODELS[0];
    const validateVeo = (options: Record<string, any>) =>
      (service as any).validateOptions('video', model, options);
    expect(() => validateVeo({ referenceAssetIds: [1, 2], duration: 6 })).not.toThrow();
    expect(() => validateVeo({ referenceAssetIds: [1, 2, 3], duration: 8 })).toThrow(BadRequestException);
    expect(() => validateVeo({ referenceAssetIds: [1], referenceMode: 'refer_image', duration: 8 })).toThrow(BadRequestException);
  });

  it('accepts values inside image enum and range capabilities', () => {
    expect(() =>
      validate(
        'image',
        {
          resolution: { type: 'enum', values: ['1K', '2K'] },
          n: { type: 'range', min: 1, max: 1 },
          seed: { type: 'boolean' },
        },
        { resolution: '2K', n: 1, seed: 1234 },
      ),
    ).not.toThrow();
  });

  it('rejects unsupported image options and out-of-range counts', () => {
    const capabilities = { n: { type: 'range', min: 1, max: 1 } };

    expect(() => validate('image', capabilities, { quality: 'auto' })).toThrow(
      BadRequestException,
    );
    expect(() => validate('image', capabilities, { n: 2 })).toThrow(
      BadRequestException,
    );
  });

  it('validates video size and seed support', () => {
    expect(() =>
      validate(
        'video',
        { sizes: ['1280x720'], seed: false },
        { size: '1920x1080' },
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      validate('video', { sizes: ['1280x720'], seed: false }, { seed: 42 }),
    ).toThrow(BadRequestException);
  });

  it('does not allow size together with resolution or aspect ratio', () => {
    expect(() =>
      validate(
        'video',
        {
          sizes: ['1280x720'],
          resolutions: ['720p'],
          aspectRatios: ['16:9'],
        },
        { size: '1280x720', resolution: '720p' },
      ),
    ).toThrow(BadRequestException);
  });

  it('validates custom shot count, descriptions and total duration', () => {
    const caps = KLING_VIDEO_MODELS[1].capabilities;
    const valid = {
      multiShot: true,
      customShots: true,
      duration: 5,
      shots: [
        { prompt: 'Wide shot', duration: 2 },
        { prompt: 'Close-up', duration: 3 },
      ],
    };
    expect(() => validate('video', caps, valid)).not.toThrow();
    expect(() => validate('video', caps, { ...valid, duration: 6 })).toThrow(
      BadRequestException,
    );
    expect(() =>
      validate('video', caps, {
        ...valid,
        shots: [{ prompt: '', duration: 5 }],
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      validate('video', caps, { ...valid, multiShot: false }),
    ).toThrow(BadRequestException);
  });

  it('limits Elements to Kling 3.0 models and three unique assets', () => {
    const validateElements = (modelId: string, ids: unknown) =>
      (service as any).validateOptions(
        'video',
        {
          id: modelId,
          capabilities: KLING_VIDEO_MODELS[1].capabilities,
        },
        { elementAssetIds: ids },
      );
    expect(() => validateElements('kling/kling-3.0', [1, 2, 3])).not.toThrow();
    expect(() => validateElements('kling/kling-3.0', [1, 2, 3, 4])).toThrow(
      BadRequestException,
    );
    expect(() => validateElements('kling/kling-3.0', [1, 1])).toThrow(
      BadRequestException,
    );
    expect(() => validateElements('kling/kling-3.0-omni', [1])).not.toThrow();
    expect(() => validateElements('kling/kling-3.0-turbo', [1])).toThrow(
      BadRequestException,
    );
  });

  it('validates Omni video input combinations before quoting', () => {
    const validateOmni = (options: Record<string, any>) =>
      (service as any).validateOptions('video', KLING_VIDEO_MODELS[2], options);
    expect(() => validateOmni({ referenceInputs: [] })).not.toThrow();
    expect(() => validateOmni({ referenceInputs: [
      { assetId: 1, type: 'first_frame' },
      { assetId: 2, type: 'refer_image' },
    ] })).not.toThrow();
    expect(() => validateOmni({ referenceInputs: [
      { assetId: 1, type: 'last_frame' },
    ] })).toThrow(BadRequestException);
    expect(() => validateOmni({ referenceInputs: [
      { assetId: 1, type: 'feature_video' },
    ], multiShot: false })).toThrow(BadRequestException);
    expect(() => validateOmni({ referenceInputs: [
      { assetId: 1, type: 'base_video' },
    ], audioMode: 'original', multiShot: false })).not.toThrow();
  });

  it('quotes Kling video from API units, not creator Credits', () => {
    const priced = new PricingService(
      {} as never,
      {} as never,
      {} as never,
      { get: () => '0.14' } as never,
      {} as never,
    );
    const turbo = KLING_VIDEO_MODELS[0];
    const standard = KLING_VIDEO_MODELS[1];
    expect(
      (priced as any).videoCost(turbo, { duration: 5, resolution: '720p' }),
    ).toBeCloseTo(0.56);
    expect(
      (priced as any).videoCost(standard, {
        duration: 5,
        resolution: '1080p',
        generateAudio: true,
      }),
    ).toBeCloseTo(0.84);
    expect(
      (priced as any).videoCost(standard, { duration: 5, resolution: '720p' }),
    ).toBeCloseTo(0.42);
    expect(
      (priced as any).videoCost(standard, { duration: 5, resolution: '4k' }),
    ).toBeCloseTo(2.1);
    expect((priced as any).videoCost(KLING_VIDEO_MODELS[2], {
      duration: 5,
      resolution: '1080p',
      referenceInputs: [{ assetId: 1, type: 'base_video' }],
    })).toBeCloseTo(0.84);
  });

  it('quotes Seedance from output tokens and requires selected frame assets', () => {
    const model = SEEDANCE_VIDEO_MODELS.find((item) => item.id === 'seedance/seedance-2.5')!;
    expect(() => (service as any).validateOptions('video', model, {
      duration: 5, resolution: '720p', referenceAssetIds: [1],
    })).not.toThrow();
    expect(() => (service as any).validateOptions('video', model, {
      duration: 5, resolution: '720p', referenceAssetIds: [1], aspectRatio: '16:9',
    })).toThrow(BadRequestException);
    expect((service as any).seedanceTokenRate(model, { resolution: '720p' }))
      .toBe(10.7);
  });

  it('validates Seedance Omni task-specific inputs and settings', () => {
    const model = SEEDANCE_VIDEO_MODELS.find((item) => item.id === 'seedance/seedance-2.5-omni')!;
    const validate = (options: Record<string, any>) =>
      (service as any).validateOptions('video', model, {
        resolution: '720p', duration: 5, aspectRatio: 'adaptive', ...options,
      });
    const image = { assetId: 1, type: 'reference_image' };
    const video = { assetId: 2, type: 'reference_video' };
    const audio = { assetId: 3, type: 'reference_audio' };
    expect(() => validate({ omniTaskType: 'reference', referenceInputs: [image], aspectRatio: '16:9' })).not.toThrow();
    expect(() => validate({ omniTaskType: 'reference', referenceInputs: [video] })).not.toThrow();
    expect(() => validate({ omniTaskType: 'reference', referenceInputs: [image, audio] })).not.toThrow();
    expect(() => validate({ omniTaskType: 'reference', referenceInputs: [audio] })).toThrow(BadRequestException);
    expect(() => validate({ omniTaskType: 'reference', referenceInputs: [{ assetId: 1, type: 'first_frame' }] })).toThrow(BadRequestException);
    expect(() => validate({ omniTaskType: 'edit', referenceInputs: [image], duration: -1 })).toThrow(BadRequestException);
    expect(() => validate({ omniTaskType: 'edit', referenceInputs: [video], duration: -1 })).not.toThrow();
    expect(() => validate({ omniTaskType: 'edit', referenceInputs: [video], duration: -1, aspectRatio: '16:9' })).toThrow(BadRequestException);
    expect(() => validate({ omniTaskType: 'extend', referenceInputs: [video] })).not.toThrow();
  });

  it('validates Seedance 2.0 limits and selects the video-input token rate', () => {
    const frame = SEEDANCE_VIDEO_MODELS.find((item) => item.id === 'seedance/seedance-2.0')!;
    const omni = SEEDANCE_VIDEO_MODELS.find((item) => item.id === 'seedance/seedance-2.0-omni')!;
    const validate = (model: any, options: Record<string, any>) =>
      (service as any).validateOptions('video', model, {
        duration: 5, resolution: '720p', ...options,
      });
    expect(() => validate(frame, { referenceAssetIds: [1], aspectRatio: '16:9' })).not.toThrow();
    expect(() => validate(omni, { omniTaskType: 'edit', referenceInputs: [
      { assetId: 1, type: 'reference_video' },
    ], aspectRatio: '16:9' })).not.toThrow();
    expect(() => validate(omni, { omniTaskType: 'reference', referenceInputs: [
      ...Array.from({ length: 10 }, (_, i) => ({ assetId: i + 1, type: 'reference_image' })),
    ] })).toThrow(BadRequestException);
    expect((service as any).seedanceTokenRate(omni, { resolution: '720p', referenceInputs: [
      { assetId: 1, type: 'reference_video' },
    ] })).toBe(4.3);
    expect((service as any).seedanceTokenRate(omni, { resolution: '720p', referenceInputs: [
      { assetId: 1, type: 'reference_image' },
    ] })).toBe(7);
    expect((service as any).seedanceTokenRate(frame, { resolution: '4k' })).toBe(4);
  });

  it('quotes a 5s 720p 16:9 Seedance 2.0 video using BytePlus output dimensions', async () => {
    const model = SEEDANCE_VIDEO_MODELS[0];
    const pricing = new PricingService(
      { create: (value: any) => ({ id: 'quote-1', ...value }), save: async () => undefined } as never,
      { find: async () => model } as never,
      { getUsdVndRate: async () => ({ rate: 25_000, source: 'test' }) } as never,
      { get: (key: string) => key === 'AI_MARKUP_RATE' ? '0.05' : undefined } as never,
      { find: async () => [{ id: 1, assetType: 'image', width: 1280, height: 720 }] } as never,
    );
    const quote = await pricing.createQuote(1, {
      modality: 'video', modelSlug: model.id, prompt: 'test',
      options: { duration: 5, resolution: '720p', aspectRatio: '16:9', referenceAssetIds: [1] },
    });
    expect(quote.details.estimatedTokens).toBe(108_000);
    expect(quote.providerCostUsd.min).toBeCloseTo(0.756);
    expect(quote.minPriceVnd).toBe(19_845);
    expect(quote.maxPriceVnd).toBe(19_845);
  });

  it('uses the source image ratio for adaptive Seedance quotes', () => {
    expect(seedanceOutputDimensions('dreamina-seedance-2-0-260128', '720p', 'adaptive', 9 / 16))
      .toEqual({ width: 720, height: 1280, ratio: '9:16' });
    expect(seedanceOutputDimensions('dreamina-seedance-2-5-260628', '480p', '16:9'))
      .toEqual({ width: 854, height: 480, ratio: '16:9' });
  });

  it('uses actual reference duration and the documented short-video minimum estimate', async () => {
    const model = SEEDANCE_VIDEO_MODELS[1];
    const assets = { find: async () => [{
      id: 1, assetType: 'video', width: 1280, height: 720,
      durationSeconds: 2, metadata: { mediaDurationSeconds: 2 },
    }] };
    const pricing = new PricingService(
      {} as never, {} as never, {} as never, {} as never, assets as never,
    );
    const result = await (pricing as any).seedanceCost(1, model, {
      duration: 5, resolution: '720p', aspectRatio: '16:9',
      referenceInputs: [{ assetId: 1, type: 'reference_video' }],
    });
    expect(result.inputVideoSeconds).toBe(2);
    expect(result.estimatedTokens).toBe(194_400);
    expect(result.costUsd).toBeCloseTo(0.83592);
  });

  it('limits Kling 3.0 prompts to 3072 characters when quoting', async () => {
    const standard = KLING_VIDEO_MODELS[1];
    expect(standard.capabilities.maxPromptCharacters).toBe(3072);
    const pricing = new PricingService(
      {} as never,
      { find: async () => standard } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(
      pricing.createQuote(1, {
        modality: 'video',
        modelSlug: standard.id,
        prompt: 'x'.repeat(3073),
        options: { duration: 5, resolution: '720p' },
      }),
    ).rejects.toThrow('Prompt vượt giới hạn ký tự');
  });

  it('accepts a quote when generation trims surrounding prompt whitespace', async () => {
    let savedQuote: any;
    const quotes = {
      create: (value: any) => ({ ...value, id: 'quote-1' }),
      save: async (value: any) => {
        savedQuote = value;
      },
      findOne: async () => savedQuote,
    };
    const pricing = new PricingService(
      quotes as never,
      { find: async () => KLING_VIDEO_MODELS[0] } as never,
      {
        getUsdVndRate: async () => ({ rate: 25_000, source: 'test' }),
      } as never,
      {
        get: (key: string) => (key === 'KLING_USD_PER_API_UNIT' ? '0.14' : '0'),
      } as never,
      {} as never,
    );

    await pricing.createQuote(1, {
      modality: 'video',
      modelSlug: KLING_VIDEO_MODELS[0].id,
      prompt: '  move forward  ',
      options: { duration: 5, resolution: '720p' },
    });

    expect(savedQuote.request.promptLength).toBe('move forward'.length);
    await expect(
      pricing.getValidQuote(1, 'quote-1', 'move forward'),
    ).resolves.toBe(savedQuote);
  });
});
