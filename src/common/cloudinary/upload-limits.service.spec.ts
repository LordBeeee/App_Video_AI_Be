import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { UploadLimitsService } from './upload-limits.service';

describe('UploadLimitsService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('uses the Cloudinary allowance and the application video ceiling', async () => {
    jest.spyOn(cloudinary.api, 'usage').mockResolvedValue({
      media_limits: {
        image_max_size_bytes: 20 * 1024 * 1024,
        video_max_size_bytes: 2 * 1024 * 1024 * 1024,
      },
    } as never);
    const service = new UploadLimitsService({ get: () => undefined } as unknown as ConfigService);

    expect(await service.getLimits()).toEqual({ image: 20_000_000, video: 200_000_000, audio: 200_000_000 });
    expect(cloudinary.api.usage).toHaveBeenCalledTimes(1);
    await service.getLimits();
    expect(cloudinary.api.usage).toHaveBeenCalledTimes(1);
  });

  it('falls back to safe configured limits when usage is unavailable', async () => {
    jest.spyOn(cloudinary.api, 'usage').mockRejectedValue(new Error('offline'));
    const service = new UploadLimitsService({
      get: (key: string) => key === 'CLOUDINARY_FALLBACK_VIDEO_MB' ? '100' : undefined,
    } as ConfigService);

    expect(await service.getLimits()).toEqual({ image: 10_000_000, video: 100_000_000, audio: 100_000_000 });
  });
});
