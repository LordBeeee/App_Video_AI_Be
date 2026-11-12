require('ts-node/register/transpile-only');
// Run against an isolated in-memory PostgreSQL WASM instance; Cloudinary is stubbed.
const { PGlite } = require(
  process.env.ASSET_DELETION_PG_MODULE || '@electric-sql/pglite',
);
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {
  AssetDeletionService,
} = require('../src/modules/assets/asset-deletion.service');
const {
  CloudinaryService,
} = require('../src/common/cloudinary/cloudinary.service');
const { ConfigService } = require('@nestjs/config');
(async () => {
  const pg = new PGlite();
  let tests = 0;
  const query = async (sql, params = []) => (await pg.query(sql, params)).rows;
  const cloud = new CloudinaryService(
    new ConfigService({
      CLOUDINARY_CLOUD_NAME: 'test',
      CLOUDINARY_API_KEY: 'test',
      CLOUDINARY_API_SECRET: 'test',
    }),
  );
  let cloudError = null,
    cloudCalls = 0;
  cloud.destroyResource = async () => {
    cloudCalls++;
    if (cloudError) throw cloudError;
  };
  const manager = {
    query,
    getRepository: () => ({
      findOne: async ({ where }) => {
        const [r] = await query(
          'SELECT * FROM public.assets WHERE id=$1 AND user_id=$2 FOR UPDATE',
          [where.id, where.userId],
        );
        return r
          ? {
              id: r.id,
              userId: r.user_id,
              projectId: r.project_id,
              sceneId: r.scene_id,
              sourceType: r.source_type,
              storageProvider: r.storage_provider,
              storedUrl: r.stored_url,
              thumbnailUrl: r.thumbnail_url,
              metadata: r.metadata,
            }
          : null;
      },
    }),
  };
  const db = {
    query,
    transaction: async (fn) => {
      await pg.exec('BEGIN');
      try {
        const result = await fn(manager);
        await pg.exec('COMMIT');
        return result;
      } catch (e) {
        await pg.exec('ROLLBACK');
        throw e;
      }
    },
    createQueryRunner: () => {
      const r = {
        isTransactionActive: false,
        connect: async () => {},
        release: async () => {},
        query,
        startTransaction: async () => {
          await pg.exec('BEGIN');
          r.isTransactionActive = true;
        },
        commitTransaction: async () => {
          await pg.exec('COMMIT');
          r.isTransactionActive = false;
        },
        rollbackTransaction: async () => {
          await pg.exec('ROLLBACK');
          r.isTransactionActive = false;
        },
      };
      return r;
    },
  };
  const service = new AssetDeletionService(db, cloud);
  const url = (name, version = '1', type = 'image') =>
    `https://res.cloudinary.com/test/${type}/upload/v${version}/ai-generation/users/1/${name}.${type === 'video' ? 'mp4' : 'png'}`;
  const asset = async (name, opts = {}) =>
    (
      await query(
        `INSERT INTO public.assets(user_id,asset_type,source_type,storage_provider,stored_url,thumbnail_url,metadata) VALUES(1,$1,$2,$3,$4,$5,$6) RETURNING *`,
        [
          opts.type || 'image',
          opts.source || 'uploaded',
          opts.provider || 'cloudinary',
          opts.url || url(name),
          opts.thumbnail || null,
          JSON.stringify(opts.metadata || {}),
        ],
      )
    )[0];
  const generation = async (
    options = {},
    outputs = [],
    status = 'processing',
  ) =>
    (
      await query(
        `INSERT INTO public.ai_generations(user_id,modality,model_slug,status,prompt,options,output_urls) VALUES(1,'image','test',$1,'test',$2,$3) RETURNING id`,
        [status, JSON.stringify(options), JSON.stringify(outputs)],
      )
    )[0].id;
  const check = async (name, fn) => {
    await fn();
    tests++;
    console.log('PASS ' + name);
  };
  try {
    await pg.exec(
      fs
        .readFileSync('database/migrations/0001_fresh_install.sql', 'utf8')
        .replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', ''),
    );
    const migration = fs.readFileSync(
      'migrations/202611030002_asset_deletion_jobs.sql',
      'utf8',
    );
    await pg.exec(migration);
    await pg.exec(migration);
    await pg.exec(
      "INSERT INTO public.roles(name) VALUES('test'); INSERT INTO public.users(role_id,email,password_hash) VALUES(1,'test@local','test')",
    );
    await service['checkSchema']();
    await check('fresh schema and repeat migration', async () => {
      assert.equal(
        (await query('SELECT public.asset_deletion_schema_version() AS v'))[0]
          .v,
        2,
      );
    });
    await check(
      'metadata / legacy / transformed / encoded URLs share one identity',
      async () => {
        for (const variant of [
          url('a', '7'),
          url('a', '8').replace('/v8/', '/c_fill,w_100/v8/'),
          url('a'),
        ])
          assert.deepEqual(
            (
              await query('SELECT public.asset_cloudinary_identity($1) AS i', [
                variant,
              ])
            )[0].i,
            cloud.storageIdentity(url('a')),
          );
        assert.deepEqual(
          (
            await query('SELECT public.asset_cloudinary_identity($1) AS i', [
              url('a%20b'),
            ])
          )[0].i,
          cloud.storageIdentity(url('a%20b')),
        );
      },
    );
    await check(
      'same file with a different version blocks deletion',
      async () => {
        const a = await asset('shared');
        await asset('shared2', { url: url('shared', '2') });
        await assert.rejects(
          () => service.request(1, String(a.id)),
          (e) => e.status === 409,
        );
      },
    );
    await check(
      'active custom source blocks; deleted custom source does not',
      async () => {
        const a = await asset('source');
        const child = await asset('child', {
          source: 'external',
          provider: 'kling',
          url: url('source', '9'),
          metadata: { sourceUrls: [url('source', '3')] },
        });
        await assert.rejects(
          () => service.request(1, String(a.id)),
          (e) => e.status === 409,
        );
        await query(
          `UPDATE public.assets SET metadata=metadata || '{"deleteStatus":"succeed"}' WHERE id=$1`,
          [child.id],
        );
        assert.equal(
          (await service.request(1, String(a.id))).status,
          'completed',
        );
        assert.equal(
          (
            await query(
              'SELECT count(*)::int AS n FROM public.assets WHERE id=$1',
              [a.id],
            )
          )[0].n,
          0,
        );
      },
    );
    await check(
      'active generation with transformed reference blocks deletion',
      async () => {
        const a = await asset('busy');
        await generation({
          referenceUrls: [url('busy', '7').replace('/v7/', '/w_100/v7/')],
        });
        await assert.rejects(
          () => service.request(1, String(a.id)),
          (e) => e.status === 409,
        );
      },
    );
    await check(
      'cloud-first deletion removes output URL variants and cascades links',
      async () => {
        const a = await asset('output');
        const g = await generation(
          {},
          [url('output'), url('output', '8'), url('keep')],
          'succeeded',
        );
        await query(
          "INSERT INTO public.ai_generation_assets(generation_id,asset_id,role) VALUES($1,$2,'output')",
          [g, a.id],
        );
        const before = cloudCalls;
        assert.equal(
          (await service.request(1, String(a.id))).status,
          'completed',
        );
        assert.ok(cloudCalls > before);
        assert.deepEqual(
          (
            await query(
              'SELECT output_urls FROM public.ai_generations WHERE id=$1',
              [g],
            )
          )[0].output_urls,
          [url('keep')],
        );
        assert.equal(
          (
            await query(
              'SELECT count(*)::int AS n FROM public.ai_generation_assets WHERE generation_id=$1',
              [g],
            )
          )[0].n,
          0,
        );
        assert.equal(
          (await service.request(1, String(a.id))).status,
          'completed',
        );
      },
    );
    let pending;
    await check(
      'transient failure retains asset and schedules backoff',
      async () => {
        pending = await asset('retry');
        cloudError = new Error('timeout');
        assert.equal(
          (await service.request(1, String(pending.id))).status,
          'pending',
        );
        const [j] = await query(
          'SELECT status,attempts,next_attempt_at > now() AS delayed FROM public.asset_deletion_jobs WHERE asset_id=$1',
          [pending.id],
        );
        assert.equal(j.attempts, 1);
        assert.equal(j.delayed, true);
      },
    );
    await check(
      'triggers reject new references and duplicate sources while deletion is pending',
      async () => {
        await assert.rejects(
          () => generation({ referenceUrls: [url('retry', '3')] }),
          (e) => e.code === '23514',
        );
        await assert.rejects(
          () => asset('duplicate', { url: url('retry', '4') }),
          (e) => e.code === '23514',
        );
        await assert.rejects(
          () =>
            asset('newvoice', {
              source: 'external',
              provider: 'kling',
              url: 'https://example.com/sample.mp3',
              metadata: { sampleAssetId: pending.id },
            }),
          (e) => e.code === '23514',
        );
      },
    );
    await check('worker retries and physically deletes asset', async () => {
      cloudError = null;
      await query(
        'UPDATE public.asset_deletion_jobs SET next_attempt_at=now() WHERE asset_id=$1',
        [pending.id],
      );
      await service['retry']();
      assert.equal(
        (
          await query(
            'SELECT status FROM public.asset_deletion_jobs WHERE asset_id=$1',
            [pending.id],
          )
        )[0].status,
        'completed',
      );
    });
    await check(
      'permanent Cloudinary failure stops retry and explicit retry recovers',
      async () => {
        const a = await asset('denied');
        cloudError = Object.assign(new Error('denied'), { http_code: 403 });
        assert.equal((await service.request(1, String(a.id))).status, 'failed');
        assert.equal(
          (
            await query('SELECT metadata FROM public.assets WHERE id=$1', [
              a.id,
            ])
          )[0].metadata.deleteStatus,
          'failed',
        );
        cloudError = null;
        assert.equal(
          (await service.request(1, String(a.id))).status,
          'completed',
        );
      },
    );
    await check(
      'DB failure after cloud deletion rolls back cleanup and recovers',
      async () => {
        const a = await asset('db-failure');
        const g = await generation({}, [url('db-failure')], 'succeeded');
        await pg.exec(`CREATE SEQUENCE deletion_test_failure;
        CREATE FUNCTION fail_first_asset_delete() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF nextval('deletion_test_failure') = 1 THEN RAISE EXCEPTION 'temporary DB failure'; END IF; RETURN OLD; END $$;
        CREATE TRIGGER deletion_test_failure BEFORE DELETE ON public.assets FOR EACH ROW EXECUTE FUNCTION fail_first_asset_delete();`);
        assert.equal(
          (await service.request(1, String(a.id))).status,
          'pending',
        );
        assert.deepEqual(
          (
            await query(
              'SELECT output_urls FROM public.ai_generations WHERE id=$1',
              [g],
            )
          )[0].output_urls,
          [url('db-failure')],
        );
        assert.equal(
          (
            await query(
              'SELECT count(*)::int AS n FROM public.assets WHERE id=$1',
              [a.id],
            )
          )[0].n,
          1,
        );
        await query(
          'UPDATE public.asset_deletion_jobs SET next_attempt_at=now() WHERE asset_id=$1',
          [a.id],
        );
        await service['retry']();
        assert.equal(
          (
            await query(
              'SELECT status FROM public.asset_deletion_jobs WHERE asset_id=$1',
              [a.id],
            )
          )[0].status,
          'completed',
        );
        await pg.exec(
          'DROP TRIGGER deletion_test_failure ON public.assets; DROP FUNCTION fail_first_asset_delete(); DROP SEQUENCE deletion_test_failure;',
        );
      },
    );
    await check(
      'stale sample IDs remain blocked after physical deletion',
      async () => {
        await assert.rejects(
          () =>
            asset('stale-voice', {
              source: 'external',
              provider: 'kling',
              url: 'https://example.com/stale.mp3',
              metadata: { sampleAssetId: pending.id },
            }),
          (e) => e.code === '23514',
        );
      },
    );
    await check('another user cannot delete', async () => {
      const a = await asset('private');
      await assert.rejects(
        () => service.request(2, String(a.id)),
        (e) => e.status === 404,
      );
    });
    await check(
      'unchanged historical references can still be updated',
      async () => {
        const g = await generation({}, [url('hist')], 'succeeded');
        await query(
          'UPDATE public.ai_generations SET options=options,status=$1 WHERE id=$2',
          ['succeeded', g],
        );
      },
    );
    console.log(`${tests} PostgreSQL integration checks passed`);
  } finally {
    await pg.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
