import { v2 as cloudinary } from 'cloudinary';
import { ConfigService } from '@nestjs/config';
import { CloudinaryService } from './cloudinary.service';

describe('CloudinaryService.findVideo', () => {
  const service = new CloudinaryService({
    getOrThrow: jest.fn().mockReturnValue('test'),
  } as unknown as ConfigService);

  afterEach(() => jest.restoreAllMocks());

  it('treats a nested Cloudinary 404 as a missing video', async () => {
    jest.spyOn(cloudinary.api, 'resource').mockRejectedValueOnce({
      error: { message: 'Resource not found', http_code: 404 },
    });

    await expect(service.findVideo('videos', 'generation-1')).resolves.toBeNull();
  });

  it('preserves the nested Cloudinary error message for other failures', async () => {
    jest.spyOn(cloudinary.api, 'resource').mockRejectedValueOnce({
      error: { message: 'Invalid API key', http_code: 401 },
    });

    await expect(service.findVideo('videos', 'generation-1'))
      .rejects.toThrow('Cloudinary: Invalid API key');
  });
});
