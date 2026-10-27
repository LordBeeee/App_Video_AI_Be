import { VideoReconciliationService } from './video-reconciliation.service';
import type { AiGeneration } from './ai-generation.entity';

describe('VideoReconciliationService', () => {
  const generation = () =>
    ({
      id: 'generation-1',
      userId: 7,
      modelSlug: 'kling/kling-3.0',
      externalJobId: 'job-1',
      walletHoldId: 'hold-1',
      quoteId: 'quote-1',
      source: 'kling',
      status: 'processing',
    }) as AiGeneration;

  function setup(job: Record<string, unknown>) {
    const generations = {
      update: jest.fn(() => Promise.resolve({ affected: 1 })),
      findOne: jest.fn(),
    };
    const quotes = {
      findOneOrFail: jest.fn(() =>
        Promise.resolve({
          maxPriceVnd: 100_000,
          providerCostMaxUsd: '3.2',
          usdVndRate: 25_000,
          markupRate: 0.2,
          request: { units: { usdPerMillionTokens: 10.7 } },
        }),
      ),
    };
    const kling = {
      getJob: jest.fn(() => Promise.resolve(job)),
      download: jest.fn(() => Promise.resolve(Buffer.from('video'))),
    };
    const seedance = {
      getJob: jest.fn(() => Promise.resolve(job)),
      download: jest.fn(() => Promise.resolve(Buffer.from('video'))),
    };
    const veo = { getJob: jest.fn(() => Promise.resolve(job)) };
    const cloudinary = {
      findVideo: jest.fn(() => Promise.resolve(null)),
      uploadVideoBuffer: jest.fn(() =>
        Promise.resolve({
          secure_url: 'https://example.com/video.mp4',
          thumbnail_url: 'https://example.com/thumbnail.jpg',
          bytes: 12_345_678,
        }),
      ),
      uploadBuffer: jest.fn(() =>
        Promise.resolve({ secure_url: 'https://example.com/last.jpg', bytes: 234_567 }),
      ),
    };
    const assets = {
      findVideoOutput: jest.fn(() => Promise.resolve(null)),
      saveOutput: jest.fn(() => Promise.resolve({ storedUrl: 'https://example.com/video.mp4' })),
    };
    const queryRunner = {
      connect: jest.fn(() => Promise.resolve()),
      query: jest.fn((sql: string) => Promise.resolve(sql.includes('try_advisory_lock') ? [{ claimed: true }] : [])),
      release: jest.fn(() => Promise.resolve()),
    };
    const dataSource = { createQueryRunner: jest.fn(() => queryRunner) };
    const wallets = {
      settle: jest.fn(() => Promise.resolve(undefined)),
      release: jest.fn(() => Promise.resolve(undefined)),
    };
    const service = new VideoReconciliationService(
      generations as never,
      quotes as never,
      kling as never,
      cloudinary as never,
      assets as never,
      wallets as never,
      {} as never,
      seedance as never,
      veo as never,
      dataSource as never,
    );
    const reconcile = service.reconcile.bind(service);
    service.reconcile = (item: AiGeneration) => {
      generations.findOne.mockResolvedValue(item as never);
      return reconcile(item);
    };
    return { service, generations, kling, seedance, veo, cloudinary, assets, wallets, queryRunner };
  }

  it('includes submitted videos in scheduled reconciliation', async () => {
    const query = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    const { service, generations } = setup({ status: 'submitted' });
    (generations as any).createQueryBuilder = jest.fn().mockReturnValue(query);

    await (service as any).reconcilePending();

    expect(query.andWhere).toHaveBeenCalledWith(
      'generation.status IN (:...statuses)',
      expect.objectContaining({ statuses: expect.arrayContaining(['submitted']) }),
    );
  });

  it('finishes a submitted Kling video when Kling reports succeeded', async () => {
    const { service, kling, wallets } = setup({
      status: 'succeeded', url: 'https://provider.example/video.mp4',
    });
    const item = { ...generation(), status: 'submitted' } as AiGeneration;

    await service.reconcile(item);

    expect(kling.getJob).toHaveBeenCalledWith(item.modelSlug, item.externalJobId);
    expect(item.status).toBe('succeeded');
    expect(wallets.settle).toHaveBeenCalledTimes(1);
  });

  it('stores a completed Veo video using the existing output and wallet flow', async () => {
    const { service, veo, cloudinary, assets, wallets } = setup({
      status: 'succeeded', buffer: Buffer.from('veo-video'),
    });
    const item = { ...generation(), source: 'veo', modelSlug: 'google/veo-3.1-fast' } as AiGeneration;
    await service.reconcile(item);
    expect(veo.getJob).toHaveBeenCalledWith('job-1', 'veo-3.1-fast-generate-001');
    expect(cloudinary.uploadVideoBuffer).toHaveBeenCalledWith(
      Buffer.from('veo-video'), 'ai-generation/users/7/videos', 'generation-1',
    );
    expect(assets.saveOutput).toHaveBeenCalledTimes(1);
    expect(wallets.settle).toHaveBeenCalledTimes(1);
    expect(item.status).toBe('succeeded');
  });

  it('saves the output and settles no more than the quoted maximum', async () => {
    const { service, generations, assets, wallets } = setup({
      status: 'succeeded',
      url: 'https://provider.example/video.mp4',
      costUsd: 5,
      units: 10,
    });
    const item = generation();
    item.linkedAssets = [{ id: 'existing-link' }] as AiGeneration['linkedAssets'];

    await service.reconcile(item);

    expect(item.status).toBe('succeeded');
    expect(item.chargedVnd).toBe(100_000);
    expect(assets.saveOutput).toHaveBeenCalledTimes(1);
    expect(assets.saveOutput).toHaveBeenCalledWith(
      'generation-1', 7, 'video', 'https://example.com/video.mp4',
      expect.objectContaining({ fileSizeBytes: 12_345_678 }),
    );
    expect(generations.update).toHaveBeenCalledWith('generation-1', {
      status: 'succeeded',
      outputUrls: ['https://example.com/video.mp4'],
      usage: { units: 10 },
      actualCostUsd: '5',
      chargedVnd: 100_000,
      completedAt: expect.any(Date),
    });
    expect(wallets.settle).toHaveBeenCalledWith('hold-1', 100_000, {
      generationId: 'generation-1',
      modality: 'video',
    });
    expect(wallets.release).not.toHaveBeenCalled();
  });

  it('releases the wallet hold when Kling fails', async () => {
    const { service, generations, assets, wallets } = setup({
      status: 'failed',
      error: 'Provider rejected the job',
    });
    const item = generation();

    await service.reconcile(item);

    expect(item.status).toBe('failed');
    expect(item.errorMessage).toBe('Provider rejected the job');
    expect(generations.update).toHaveBeenCalledWith('generation-1', {
      status: 'failed',
      errorMessage: 'Provider rejected the job',
      completedAt: expect.any(Date),
    });
    expect(assets.saveOutput).not.toHaveBeenCalled();
    expect(wallets.release).toHaveBeenCalledWith(
      'hold-1',
      'Provider rejected the job',
    );
    expect(wallets.settle).not.toHaveBeenCalled();
  });

  it('keeps the job pending and retries when saving to Cloudinary fails temporarily', async () => {
    const { service, cloudinary, assets, wallets } = setup({
      status: 'succeeded', url: 'https://provider.example/video.mp4',
    });
    const item = generation();
    cloudinary.uploadVideoBuffer.mockRejectedValueOnce(new Error('Cloudinary: upload timed out'));
    await expect(service.reconcile(item)).rejects.toThrow('Cloudinary: upload timed out');
    expect(item.status).toBe('processing');
    expect(assets.saveOutput).not.toHaveBeenCalled();
    expect(wallets.release).not.toHaveBeenCalled();
    expect(wallets.settle).not.toHaveBeenCalled();

    await service.reconcile(item);
    expect(item.status).toBe('succeeded');
    expect(wallets.settle).toHaveBeenCalledTimes(1);
  });

  it('reuses the stored video when a later step fails and reconciliation retries', async () => {
    const { service, cloudinary, assets, kling, wallets } = setup({
      status: 'succeeded', url: 'https://provider.example/video.mp4',
    });
    const item = generation();
    const quotes = (service as any).quotes;
    quotes.findOneOrFail.mockRejectedValueOnce(new Error('temporary database error'));

    await expect(service.reconcile(item)).rejects.toThrow('temporary database error');
    expect(assets.saveOutput).toHaveBeenCalledTimes(1);
    assets.findVideoOutput.mockResolvedValueOnce({ storedUrl: 'https://example.com/video.mp4' } as never);

    await service.reconcile(item);
    expect(assets.saveOutput).toHaveBeenCalledTimes(1);
    expect(cloudinary.uploadVideoBuffer).toHaveBeenCalledTimes(1);
    expect(kling.download).toHaveBeenCalledTimes(1);
    expect(wallets.settle).toHaveBeenCalledTimes(1);
  });

  it('recovers a completed Cloudinary upload after database saving fails', async () => {
    const { service, cloudinary, assets, kling } = setup({
      status: 'succeeded', url: 'https://provider.example/video.mp4',
    });
    const item = generation();
    assets.saveOutput.mockRejectedValueOnce(new Error('temporary database error'));

    await expect(service.reconcile(item)).rejects.toThrow('temporary database error');
    cloudinary.findVideo.mockResolvedValueOnce({
      secure_url: 'https://example.com/video.mp4', thumbnail_url: 'https://example.com/thumbnail.jpg',
    } as never);
    await service.reconcile(item);

    expect(cloudinary.uploadVideoBuffer).toHaveBeenCalledTimes(1);
    expect(kling.download).toHaveBeenCalledTimes(1);
    expect(assets.saveOutput).toHaveBeenCalledTimes(2);
    expect(item.outputUrls).toEqual(['https://example.com/video.mp4']);
  });

  it('does not process a video claimed by another backend instance', async () => {
    const { service, queryRunner, kling, cloudinary, assets } = setup({
      status: 'succeeded', url: 'https://provider.example/video.mp4',
    });
    queryRunner.query.mockResolvedValueOnce([{ claimed: false }] as never);

    await service.reconcile(generation());

    expect(kling.getJob).not.toHaveBeenCalled();
    expect(cloudinary.uploadVideoBuffer).not.toHaveBeenCalled();
    expect(assets.saveOutput).not.toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('settles Seedance using actual completion tokens', async () => {
    const { service, seedance, kling, wallets } = setup({
      status: 'succeeded', url: 'https://provider.example/video.mp4', units: 100_000,
    });
    const item = generation();
    item.source = 'seedance';
    await service.reconcile(item);
    expect(seedance.getJob).toHaveBeenCalledWith('job-1');
    expect(kling.getJob).not.toHaveBeenCalled();
    expect(item.actualCostUsd).toBe('1.07');
    expect(wallets.settle).toHaveBeenCalledWith('hold-1', 32_100, expect.anything());
  });

  it('stores Seedance last frame as a downloadable output asset', async () => {
    const { service, seedance, cloudinary, assets } = setup({
      status: 'succeeded',
      url: 'https://provider.example/video.mp4',
      lastFrameUrl: 'https://provider.example/last.jpg',
      units: 100_000,
    });
    const item = generation();
    item.source = 'seedance';

    await service.reconcile(item);

    expect(seedance.download).toHaveBeenCalledWith('https://provider.example/last.jpg');
    expect(cloudinary.uploadBuffer).toHaveBeenCalledWith(
      Buffer.from('video'),
      'ai-generation/users/7/images',
      'generation-1_last_frame',
    );
    expect(assets.saveOutput).toHaveBeenCalledWith(
      'generation-1', 7, 'image', 'https://example.com/last.jpg',
      { generationId: 'generation-1', mimeType: 'image/jpeg', fileSizeBytes: 234_567 }, 'last_frame',
    );
    expect(item.status).toBe('succeeded');
  });
});
