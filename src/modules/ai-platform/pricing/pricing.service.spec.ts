import { BadRequestException } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { KLING_VIDEO_MODELS } from '../catalog/kling-video';

describe('PricingService option validation', () => {
  const service = new PricingService(
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
    expect(() => validateElements('kling/kling-o1', [1])).toThrow(
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
    expect(
      (priced as any).videoCost(KLING_VIDEO_MODELS[3], {
        duration: 5,
        resolution: '720p',
      }),
    ).toBe(0);
    expect((priced as any).videoCost(KLING_VIDEO_MODELS[2], {
      duration: 5,
      resolution: '1080p',
      referenceInputs: [{ assetId: 1, type: 'base_video' }],
    })).toBeCloseTo(0.84);
  });

  it('limits Kling 3.0 prompts to 2500 characters when quoting', async () => {
    const standard = KLING_VIDEO_MODELS[1];
    expect(standard.capabilities.maxPromptCharacters).toBe(2500);
    const pricing = new PricingService(
      {} as never,
      { find: async () => standard } as never,
      {} as never,
      {} as never,
    );
    await expect(
      pricing.createQuote(1, {
        modality: 'video',
        modelSlug: standard.id,
        prompt: 'x'.repeat(2501),
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
