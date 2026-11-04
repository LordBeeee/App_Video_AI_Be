import { ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CloudinaryService } from '../../common/cloudinary/cloudinary.service';
import { AssetsService } from './assets.service';

describe('Library storage quota', () => {
  function setup() {
    const items: any[] = [];
    const runner = {
      connect: jest.fn(), release: jest.fn(),
      query: jest.fn().mockResolvedValue([{ locked: true }]),
      manager: { getRepository: (): any => repo },
    };
    const repo = {
      find: jest.fn(async () => items), update: jest.fn(),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => { items.push(value); return value; }),
      manager: { connection: { createQueryRunner: () => runner } },
    };
    const cloud = new CloudinaryService(new ConfigService({ CLOUDINARY_CLOUD_NAME: 'test', CLOUDINARY_API_KEY: 'test', CLOUDINARY_API_SECRET: 'test' }));
    jest.spyOn(cloud, 'getResourceSize').mockResolvedValue(30_000_000);
    jest.spyOn(cloud, 'uploadBuffer').mockResolvedValue({ secure_url: 'https://res.cloudinary.com/test/image/upload/new.png', bytes: 10_000_000, public_id: 'new' } as never);
    const service = new AssetsService(repo as never, {} as never, {} as never, cloud,
      { getLimits: jest.fn().mockResolvedValue({ image: 100_000_000 }) } as never);
    const asset = (id: number, size: number | string | null, extra = {}) => ({
      id, userId: 7, storedUrl: `https://res.cloudinary.com/test/video/upload/v123/video-${id}.mp4`,
      sourceType: 'generated', storageProvider: 'cloudinary', fileSizeBytes: size, metadata: {}, ...extra,
    });
    const file = { mimetype: 'image/png', size: 10_000_000, buffer: Buffer.from('image') } as Express.Multer.File;
    return { service, items, repo, cloud, asset, runner, file };
  }

  it('allows 480 MB, counts a completed 30 MB video, blocks at 510 MB, and reopens after deletion', async () => {
    const { service, items, asset, repo } = setup();
    items.push(asset(1, '480000000'));
    await expect(service.assertStorageAvailable(7)).resolves.toMatchObject({ blocked: false });
    // Existing output saving has no quota rejection; accepted jobs can finish.
    items.push(asset(2, 30_000_000));
    await expect(service.assertStorageAvailable(7)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await service.getStorageUsage(7)).toMatchObject({ usedBytes: 510_000_000, remainingBytes: 0, blocked: true });
    items.pop();
    await expect(service.assertStorageAvailable(7)).resolves.toMatchObject({ remainingBytes: 20_000_000, blocked: false });
    expect(repo.find).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 7 }) }));
  });

  it('counts physical files once, including pending/failed deletion and auxiliary images', async () => {
    const { service, items, asset } = setup();
    items.push(asset(1, 100_000_000, { metadata: { deleteStatus: 'processing' } }));
    items.push(asset(2, 100_000_000, { storedUrl: 'https://res.cloudinary.com/test/video/upload/v999/video-1.mp4', metadata: { duplicateOf: 1 } }));
    items.push(asset(3, 200_000_000, { metadata: { deleteStatus: 'failed' } }));
    items.push(asset(4, 2_000_000, { assetRole: 'last_frame', assetType: 'image' }));
    expect(await service.getStorageUsage(7)).toMatchObject({ usedBytes: 302_000_000 });
  });

  it('blocks at exactly 500 MB and rejects uploads larger than the remaining space before Cloudinary', async () => {
    const { service, items, asset, cloud, file, runner } = setup();
    items.push(asset(1, 495_000_000));
    await expect(service.uploadToLibrary(7, file)).rejects.toBeInstanceOf(ForbiddenException);
    expect(cloud.uploadBuffer).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalled();
    items[0].fileSizeBytes = 500_000_000;
    await expect(service.assertStorageAvailable(7)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows an upload that exactly fits and then blocks new work', async () => {
    const { service, items, asset, file } = setup();
    items.push(asset(1, 490_000_000));
    await service.uploadToLibrary(7, file);
    await expect(service.assertStorageAvailable(7)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('repairs unknown legacy sizes and does not count unresolved files as free space', async () => {
    const { service, items, asset, cloud, repo } = setup();
    items.push(asset(1, null));
    expect(await service.getStorageUsage(7)).toMatchObject({ usedBytes: 30_000_000, unknownSizeCount: 0 });
    expect(repo.update).toHaveBeenCalledWith(expect.objectContaining({ userId: 7 }), { fileSizeBytes: 30_000_000 });
    jest.mocked(cloud.getResourceSize).mockRejectedValue(new Error('Storage unavailable'));
    await expect(service.assertStorageAvailable(7)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects another simultaneous upload and releases its connection', async () => {
    const { service, runner, cloud, file } = setup();
    runner.query.mockResolvedValue([{ locked: false }]);
    await expect(service.uploadToLibrary(7, file)).rejects.toBeInstanceOf(ConflictException);
    expect(cloud.uploadBuffer).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalled();
  });
});
