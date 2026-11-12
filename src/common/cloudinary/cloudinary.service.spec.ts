import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryService } from './cloudinary.service';

describe('Cloudinary deletion', () => {
  const service = new CloudinaryService(
    new ConfigService({
      CLOUDINARY_CLOUD_NAME: 'test',
      CLOUDINARY_API_KEY: 'test',
      CLOUDINARY_API_SECRET: 'test',
    }),
  );
  afterEach(() => jest.restoreAllMocks());
  it.each([
    [
      'image/upload/v123/ai-generation/users/1/images/a.png',
      'image',
      'ai-generation/users/1/images/a',
    ],
    [
      'video/upload/v123/ai-generation/users/1/audio/a.mp3',
      'video',
      'ai-generation/users/1/audio/a',
    ],
    [
      'video/upload/so_0/ai-generation/users/1/videos/a.jpg',
      'video',
      'ai-generation/users/1/videos/a',
    ],
  ])(
    'resolves legacy URLs and derived thumbnails: %s',
    (path, resourceType, publicId) => {
      expect(
        service.storageIdentity(`https://res.cloudinary.com/test/${path}`),
      ).toEqual({ publicId, resourceType, deliveryType: 'upload' });
    },
  );
  it('prefers the stored identity for new assets, including custom delivery URLs', () => {
    const stored = {
      publicId: 'users/1/a',
      resourceType: 'image',
      deliveryType: 'upload',
    };
    expect(
      service.storageIdentity('https://media.example.com/a.png', stored),
    ).toEqual(stored);
  });
  it('rejects another cloud and external URLs', () => {
    expect(() =>
      service.storageIdentity(
        'https://res.cloudinary.com/other/image/upload/v1/a.png',
      ),
    ).toThrow();
    expect(() =>
      service.storageIdentity('https://example.com/test/image/upload/v1/a.png'),
    ).toThrow();
  });
  it.each(['ok', 'not found'])(
    'accepts idempotent deletion: %s',
    async (result) => {
      const destroy = jest
        .spyOn(cloudinary.uploader, 'destroy')
        .mockResolvedValue({ result });
      await service.destroyResource({
        publicId: 'audio/a',
        resourceType: 'video',
        deliveryType: 'upload',
      });
      expect(destroy).toHaveBeenCalledWith('audio/a', {
        resource_type: 'video',
        type: 'upload',
        invalidate: true,
        timeout: 30_000,
      });
    },
  );
  it('rejects unconfirmed Cloudinary results', async () => {
    jest
      .spyOn(cloudinary.uploader, 'destroy')
      .mockResolvedValue({ result: 'error' });
    await expect(
      service.destroyResource({
        publicId: 'a',
        resourceType: 'image',
        deliveryType: 'upload',
      }),
    ).rejects.toThrow();
  });
});

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
