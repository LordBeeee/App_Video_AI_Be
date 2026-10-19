import { BadRequestException } from '@nestjs/common';
import { GenerationsService } from './generations.service';

describe('GenerationsService Kling Ref validation', () => {
  const quote = {
    id: 'quote-1',
    modality: 'video',
    modelSlug: 'kling/kling-3.0',
    request: { options: { elementAssetIds: [2], duration: 5 } },
  };
  const frame = {
    id: 1,
    assetType: 'image',
    mimeType: 'image/png',
    storedUrl: 'https://example.com/frame.png',
  };
  const assets = { find: jest.fn() };
  const wallets = { hold: jest.fn() };
  const service = new GenerationsService(
    {} as never,
    {} as never,
    {} as never,
    assets as never,
    { getValidQuote: jest.fn().mockResolvedValue(quote) } as never,
    {
      find: jest
        .fn()
        .mockResolvedValue({
          capabilities: { maxReferenceImages: 2, maxPromptCharacters: 3072 },
        }),
    } as never,
    wallets as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => {
    assets.find.mockReset();
    wallets.hold.mockReset();
  });

  it('rejects an Element outside the user account before reserving payment', async () => {
    assets.find.mockResolvedValueOnce([frame]).mockResolvedValueOnce([]);
    await expect(
      service.create(7, {
        quoteId: 'quote-1',
        prompt: 'The hero waves',
        referenceAssetIds: [1],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(wallets.hold).not.toHaveBeenCalled();
  });

  it('rejects an Element that is still processing before reserving payment', async () => {
    assets.find.mockResolvedValueOnce([frame]).mockResolvedValueOnce([
      {
        id: 2,
        sourceType: 'reference',
        assetRole: 'element',
        metadata: {
          provider: 'Kling AI',
          referenceType: 'image',
          status: 'processing',
        },
      },
    ]);
    await expect(
      service.create(7, {
        quoteId: 'quote-1',
        prompt: 'The hero waves',
        referenceAssetIds: [1],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(wallets.hold).not.toHaveBeenCalled();
  });
});
