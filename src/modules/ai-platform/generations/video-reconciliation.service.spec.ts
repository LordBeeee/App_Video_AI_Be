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
      save: jest.fn((value: AiGeneration) => Promise.resolve(value)),
    };
    const quotes = {
      findOneOrFail: jest.fn(() =>
        Promise.resolve({
          maxPriceVnd: 100_000,
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
    const cloudinary = {
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
    const assets = { saveOutput: jest.fn(() => Promise.resolve(undefined)) };
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
    );
    return { service, generations, kling, seedance, cloudinary, assets, wallets };
  }

  it('saves the output and settles no more than the quoted maximum', async () => {
    const { service, assets, wallets } = setup({
      status: 'succeeded',
      url: 'https://provider.example/video.mp4',
      costUsd: 5,
      units: 10,
    });
    const item = generation();

    await service.reconcile(item);

    expect(item.status).toBe('succeeded');
    expect(item.chargedVnd).toBe(100_000);
    expect(assets.saveOutput).toHaveBeenCalledTimes(1);
    expect(assets.saveOutput).toHaveBeenCalledWith(
      'generation-1', 7, 'video', 'https://example.com/video.mp4',
      expect.objectContaining({ fileSizeBytes: 12_345_678 }),
    );
    expect(wallets.settle).toHaveBeenCalledWith('hold-1', 100_000, {
      generationId: 'generation-1',
      modality: 'video',
    });
    expect(wallets.release).not.toHaveBeenCalled();
  });

  it('releases the wallet hold when Kling fails', async () => {
    const { service, assets, wallets } = setup({
      status: 'failed',
      error: 'Provider rejected the job',
    });
    const item = generation();

    await service.reconcile(item);

    expect(item.status).toBe('failed');
    expect(item.errorMessage).toBe('Provider rejected the job');
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
