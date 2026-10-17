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
        }),
      ),
    };
    const kling = {
      getJob: jest.fn(() => Promise.resolve(job)),
      download: jest.fn(() => Promise.resolve(Buffer.from('video'))),
    };
    const cloudinary = {
      uploadVideoBuffer: jest.fn(() =>
        Promise.resolve({
          secure_url: 'https://example.com/video.mp4',
          thumbnail_url: 'https://example.com/thumbnail.jpg',
        }),
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
    );
    return { service, generations, kling, cloudinary, assets, wallets };
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
    expect(assets.saveOutput).not.toHaveBeenCalled();
    expect(wallets.release).toHaveBeenCalledWith(
      'hold-1',
      'Provider rejected the job',
    );
    expect(wallets.settle).not.toHaveBeenCalled();
  });
});
