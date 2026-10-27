import { GenerationAssetsService } from './generation-assets.service';
import { Asset } from '../../assets/entities/asset.entity';
import { AiGenerationAsset } from './ai-generation-asset.entity';

describe('GenerationAssetsService video outputs', () => {
  it('returns the existing video asset on a repeated save', async () => {
    const existing = { id: 42, assetType: 'video', metadata: { generationId: 'generation-1' } };
    const assetRepo = { create: jest.fn(), save: jest.fn() };
    const linkRepo = {
      find: jest.fn().mockResolvedValue([{ asset: existing }]),
      create: jest.fn(), save: jest.fn(),
    };
    const manager = {
      query: jest.fn().mockResolvedValue([{ id: 'generation-1' }]),
      getRepository: jest.fn((entity: unknown) => entity === Asset ? assetRepo : linkRepo),
    };
    const dataSource = { transaction: jest.fn((callback: (value: typeof manager) => unknown) => callback(manager)) };
    const service = new GenerationAssetsService(assetRepo as never, linkRepo as never, dataSource as never);

    const output = await service.saveOutput('generation-1', 7, 'video', 'https://example.com/video.mp4');

    expect(output).toBe(existing);
    expect(manager.query).toHaveBeenCalledWith(
      'SELECT id FROM public.ai_generations WHERE id = $1 FOR UPDATE', ['generation-1'],
    );
    expect(assetRepo.save).not.toHaveBeenCalled();
    expect(linkRepo.save).not.toHaveBeenCalled();
  });
});
