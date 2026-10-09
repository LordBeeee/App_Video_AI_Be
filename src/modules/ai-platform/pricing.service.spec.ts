import { BadRequestException } from '@nestjs/common';
import { PricingService } from './pricing.service';

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
});
