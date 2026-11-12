/* eslint-disable @typescript-eslint/require-await -- async mocks emulate database and network promises. */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AssetDeletionService } from './asset-deletion.service';

describe('AssetDeletionService', () => {
  const target = {
    publicId: 'ai-generation/users/7/library/image/a',
    resourceType: 'image',
    deliveryType: 'upload',
  };
  function setup({
    busy = false,
    shared = false,
    missing = false,
    cloudFailure = false,
    dbFailure = false,
    cloudCode = 0,
  } = {}) {
    const events: string[] = [];
    const manager = {
      getRepository: jest.fn(() => ({
        findOne: jest.fn(async () =>
          missing
            ? null
            : {
                id: 3,
                userId: 7,
                sourceType: 'uploaded',
                storageProvider: 'cloudinary',
                storedUrl:
                  'https://res.cloudinary.com/test/image/upload/v1/a.png',
                metadata: {},
              },
        ),
      })),
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT status')) return [];
        if (sql.includes('FROM public.ai_generations')) return [{ busy }];
        if (sql.includes('SELECT 1 FROM public.assets'))
          return [{ busy: shared }];
        return [];
      }),
    };
    const runner = {
      isTransactionActive: false,
      connect: jest.fn(),
      release: jest.fn(),
      startTransaction: jest.fn(async () => {
        runner.isTransactionActive = true;
      }),
      commitTransaction: jest.fn(async () => {
        runner.isTransactionActive = false;
      }),
      rollbackTransaction: jest.fn(async () => {
        runner.isTransactionActive = false;
      }),
      query: jest.fn(async (sql: string) => {
        if (sql.includes('pg_try_advisory_lock')) return [{ claimed: true }];
        if (sql.includes('SELECT *'))
          return [{ targets: [target], user_id: 7, stored_url: 'url' }];
        if (sql.includes('DELETE FROM public.assets')) {
          events.push('database');
          if (dbFailure) throw new Error('database unavailable');
        }
        return [];
      }),
    };
    const db = {
      transaction: jest.fn(
        (fn: (connection: typeof manager) => Promise<unknown>) => fn(manager),
      ),
      createQueryRunner: jest.fn(() => runner),
      query: jest.fn(async (sql: string) => {
        if (sql.includes('AS ready')) return [{ ready: true }];
        if (sql.includes('AS version')) return [{ version: 2 }];
        return [
          {
            status: cloudCode
              ? 'failed'
              : cloudFailure || dbFailure
                ? 'pending'
                : 'completed',
          },
        ];
      }),
    };
    const cloud = {
      storageIdentity: jest.fn(() => target),
      destroyResource: jest.fn(async () => {
        events.push('cloudinary');
        if (cloudCode)
          throw Object.assign(new Error('Cloudinary access denied'), {
            http_code: cloudCode,
          });
        if (cloudFailure) throw new Error('timeout');
      }),
    };
    return {
      service: new AssetDeletionService(db as never, cloud as never),
      manager,
      runner,
      cloud,
      events,
    };
  }

  it('deletes Cloudinary before DB and cleans generation URLs in the transaction', async () => {
    const { service, runner, events } = setup();
    expect(await service.request(7, '3')).toMatchObject({
      status: 'completed',
    });
    expect(events).toEqual(['cloudinary', 'database']);
    expect(
      runner.query.mock.calls.some(([sql]) =>
        sql.includes('UPDATE public.ai_generations'),
      ),
    ).toBe(true);
    expect(runner.commitTransaction).toHaveBeenCalled();
  });
  it('keeps DB rows and records retry when Cloudinary fails', async () => {
    const { service, runner, events } = setup({ cloudFailure: true });
    expect(await service.request(7, '3')).toMatchObject({ status: 'pending' });
    expect(events).toEqual(['cloudinary']);
    expect(
      runner.query.mock.calls.some(([sql]) =>
        sql.includes('attempts = attempts + 1'),
      ),
    ).toBe(true);
  });
  it('rolls back cleanup and schedules retry if DB fails after Cloudinary deletion', async () => {
    const { service, runner } = setup({ dbFailure: true });
    expect(await service.request(7, '3')).toMatchObject({ status: 'pending' });
    expect(runner.rollbackTransaction).toHaveBeenCalled();
    expect(runner.commitTransaction).toHaveBeenCalledTimes(1); // commits retry scheduling only
  });
  it.each([{ busy: true }, { shared: true }])(
    'rejects assets in use: %j',
    async (options) => {
      const { service, cloud } = setup(options);
      await expect(service.request(7, '3')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(cloud.destroyResource).not.toHaveBeenCalled();
    },
  );
  it('scopes asset lookup to the requesting user', async () => {
    const { service, manager, cloud } = setup({ missing: true });
    await expect(service.request(8, '3')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const repository = manager.getRepository.mock.results[0]
      .value as ReturnType<typeof manager.getRepository>;
    expect(repository.findOne).toHaveBeenCalledWith({
      where: { id: '3', userId: 8 },
      lock: { mode: 'pessimistic_write' },
    });
    expect(cloud.destroyResource).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403])(
    'stops automatic retry for permanent Cloudinary error %s',
    async (cloudCode) => {
      const { service, runner } = setup({ cloudCode });
      expect(await service.request(7, '3')).toMatchObject({ status: 'failed' });
      expect(runner.query).toHaveBeenCalledWith(
        expect.stringContaining('attempts = attempts + 1'),
        ['3', 'Cloudinary access denied', true],
      );
      expect(
        runner.query.mock.calls.some(([sql]) =>
          sql.includes("'deleteStatus','failed'"),
        ),
      ).toBe(true);
    },
  );
  it('does not keep polling when the schema is missing', async () => {
    const { service } = setup();
    const db = { query: jest.fn().mockResolvedValue([{ ready: false }]) };
    const unavailable = new AssetDeletionService(db as never, {} as never);
    await unavailable.onModuleInit();
    await unavailable['retry']();
    expect(db.query).toHaveBeenCalledTimes(1);
    unavailable.onModuleDestroy();
    service.onModuleDestroy();
  });
});
