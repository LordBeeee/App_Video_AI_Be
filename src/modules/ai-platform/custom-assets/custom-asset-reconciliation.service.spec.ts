import { CustomAssetReconciliationService } from './custom-asset-reconciliation.service';

describe('CustomAssetReconciliationService', () => {
  it('reconciles a pending Voice in the background', async () => {
    const asset = {
      id: 7,
      assetRole: 'voice',
      metadata: { taskId: 'voice-task', status: 'processing' },
      createdAt: new Date(),
    };
    const query = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([asset]),
    };
    const assets = {
      createQueryBuilder: jest.fn().mockReturnValue(query),
      findOne: jest.fn().mockResolvedValue(asset),
      save: jest.fn().mockResolvedValue(asset),
    };
    const kling = { reconcileCustomAsset: jest.fn().mockResolvedValue(undefined) };
    const runner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockImplementation((sql: string) => Promise.resolve(
        sql.includes('try_advisory_lock') ? [{ claimed: true }] : [],
      )),
      release: jest.fn().mockResolvedValue(undefined),
    };
    const service = new CustomAssetReconciliationService(
      assets as never, kling as never, {} as never,
      { createQueryRunner: () => runner } as never,
    );

    await (service as any).reconcilePending();

    expect(kling.reconcileCustomAsset).toHaveBeenCalledWith(asset);
    expect(assets.save).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ nextCheckAt: expect.any(String) }),
    }));
    expect(runner.release).toHaveBeenCalledTimes(1);
  });
});
