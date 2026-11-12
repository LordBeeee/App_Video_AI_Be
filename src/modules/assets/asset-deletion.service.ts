import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { CloudinaryService } from '../../common/cloudinary/cloudinary.service';
import { Asset } from './entities/asset.entity';

type CloudTarget = ReturnType<CloudinaryService['storageIdentity']>;
interface DeletionJob {
  targets: CloudTarget[];
  user_id: string;
  stored_url: string;
  status: 'pending' | 'completed' | 'failed';
  attempts: number;
  last_error: string | null;
}

@Injectable()
export class AssetDeletionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AssetDeletionService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private schemaReady = false;
  private schemaWarningLogged = false;
  constructor(
    private readonly db: DataSource,
    private readonly cloud: CloudinaryService,
  ) {}

  async onModuleInit() {
    await this.checkSchema();
    this.timer = setInterval(() => void this.retry(), 30_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async checkSchema() {
    try {
      const [row] = await this.db.query<{ ready: boolean }[]>(`SELECT
        to_regclass('public.asset_deletion_jobs') IS NOT NULL AND
        to_regprocedure('public.asset_deletion_schema_version()') IS NOT NULL AS ready`);
      if (!row.ready) throw new Error('Missing migration');
      const [version] = await this.db.query<{ version: number }[]>(
        'SELECT public.asset_deletion_schema_version() AS version',
      );
      if (version.version !== 2) throw new Error('Outdated migration');
      this.schemaReady = true;
    } catch {
      this.schemaReady = false;
      if (!this.schemaWarningLogged)
        this.logger.error(
          'Chức năng xóa chưa sẵn sàng. Chạy: node --env-file=.env scripts/migrate-asset-deletion.cjs rồi khởi động lại BE.',
        );
      this.schemaWarningLogged = true;
    }
  }

  private async isUsed(
    manager: EntityManager,
    asset: Asset,
    target: CloudTarget,
    url: string,
    primary: boolean,
  ) {
    const [busy] = await manager.query<{ busy: boolean }[]>(
      `SELECT EXISTS (
      SELECT 1 FROM public.ai_generations g
      WHERE g.status NOT IN ('succeeded','failed','cancelled','canceled') AND (
        EXISTS (SELECT 1 FROM public.ai_generation_assets l WHERE l.generation_id = g.id AND l.asset_id = $1) OR
        EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(g.options->'referenceUrls','[]')) u
          WHERE u = $2 OR public.asset_cloudinary_identity(u) = $3::jsonb) OR
        EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(g.options->'referenceInputs','[]')) u
          WHERE u->>'url' = $2 OR public.asset_cloudinary_identity(u->>'url') = $3::jsonb)
      )) AS busy`,
      [primary ? asset.id : null, url, JSON.stringify(target)],
    );
    if (busy.busy) return true;
    const [shared] = await manager.query<{ busy: boolean }[]>(
      `SELECT EXISTS (
      SELECT 1 FROM public.assets a WHERE a.id <> $1 AND COALESCE(a.metadata->>'deleteStatus','') <> 'succeed' AND (
        a.stored_url = $2 OR a.thumbnail_url = $2 OR
        public.asset_cloudinary_identity(a.stored_url,a.metadata) = $3::jsonb OR
        public.asset_cloudinary_identity(a.thumbnail_url) = $3::jsonb OR
        EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(a.metadata->'sourceUrls','[]')) u
          WHERE u = $2 OR public.asset_cloudinary_identity(u) = $3::jsonb) OR
        ($4::boolean AND a.metadata->>'sampleAssetId' = $1::text)
      )) AS busy`,
      [asset.id, url, JSON.stringify(target), primary],
    );
    return shared.busy;
  }

  async request(userId: number, id: string) {
    if (!this.schemaReady) {
      await this.checkSchema();
      if (!this.schemaReady)
        throw new ServiceUnavailableException(
          'Chức năng xóa chưa sẵn sàng. Vui lòng cập nhật migration DB.',
        );
    }
    if (!/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n)
      throw new BadRequestException('ID tài nguyên không hợp lệ');
    await this.db.transaction(async (manager) => {
      const [existing] = await manager.query<Pick<DeletionJob, 'status'>[]>(
        'SELECT status FROM public.asset_deletion_jobs WHERE asset_id = $1 AND user_id = $2',
        [id, userId],
      );
      if (existing) {
        if (existing.status === 'failed') {
          const reset = await manager.query<{ asset_id: string }[]>(
            "UPDATE public.asset_deletion_jobs SET status = 'pending', attempts = 0, last_error = NULL, next_attempt_at = now() WHERE asset_id = $1 AND user_id = $2 AND status = 'failed' RETURNING asset_id",
            [id, userId],
          );
          if (reset.length)
            await manager.query(
              `UPDATE public.assets SET metadata = metadata || '{"deleteStatus":"processing","deleteError":null}'::jsonb WHERE id = $1 AND user_id = $2`,
              [id, userId],
            );
        }
        return;
      }
      const asset = await manager.getRepository(Asset).findOne({
        where: { id: id as unknown as number, userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!asset) throw new NotFoundException('Không tìm thấy tài nguyên');
      if (
        !['uploaded', 'generated'].includes(asset.sourceType) ||
        asset.storageProvider !== 'cloudinary'
      ) {
        throw new BadRequestException(
          'Tài nguyên không hỗ trợ xóa bằng API này',
        );
      }
      let targets: ReturnType<CloudinaryService['storageIdentity']>[];
      try {
        targets = [
          this.cloud.storageIdentity(
            asset.storedUrl,
            (asset.metadata as { cloudinary?: CloudTarget }).cloudinary,
          ),
        ];
      } catch {
        throw new BadRequestException(
          'Không xác định được định danh Cloudinary của tài nguyên',
        );
      }
      if (
        asset.projectId ||
        asset.sceneId ||
        (await this.isUsed(manager, asset, targets[0], asset.storedUrl, true))
      ) {
        throw new ConflictException(
          'Tài nguyên đang được tác vụ tạo nội dung, tài nguyên khác hoặc dự án sử dụng',
        );
      }
      if (
        asset.thumbnailUrl &&
        asset.thumbnailUrl !== asset.storedUrl &&
        asset.thumbnailUrl.startsWith('https://res.cloudinary.com/')
      ) {
        const thumbnail = this.cloud.storageIdentity(asset.thumbnailUrl);
        if (
          !targets.some(
            (target) =>
              target.publicId === thumbnail.publicId &&
              target.resourceType === thumbnail.resourceType &&
              target.deliveryType === thumbnail.deliveryType,
          ) &&
          !(await this.isUsed(
            manager,
            asset,
            thumbnail,
            asset.thumbnailUrl,
            false,
          ))
        )
          targets.push(thumbnail);
      }
      await manager.query(
        `INSERT INTO public.asset_deletion_jobs(asset_id,user_id,targets,stored_url)
        VALUES ($1,$2,$3::jsonb,$4) ON CONFLICT (asset_id) DO NOTHING`,
        [id, userId, JSON.stringify(targets), asset.storedUrl],
      );
      await manager.query(
        `UPDATE public.assets SET metadata = metadata || '{"deleteStatus":"processing"}'::jsonb WHERE id = $1`,
        [id],
      );
    });
    // The durable job is already committed; a temporary worker/connection failure
    // must not make the client think the deletion was rejected.
    await this.process(id).catch((error) =>
      this.logger.warn(`Tác vụ xóa ${id} đang chờ: ${String(error)}`),
    );
    const [job] = await this.db.query<
      Pick<DeletionJob, 'status' | 'last_error'>[]
    >(
      'SELECT status, last_error FROM public.asset_deletion_jobs WHERE asset_id = $1 AND user_id = $2',
      [id, userId],
    );
    return {
      id,
      status: job.status,
      message:
        job.status === 'completed'
          ? 'Đã xóa tài nguyên'
          : job.status === 'failed'
            ? 'Xóa tài nguyên thất bại. Vui lòng kiểm tra cấu hình lưu trữ và thử lại.'
            : 'Đang xóa tài nguyên. Hệ thống sẽ tự động thử lại.',
    };
  }

  private async process(id: string) {
    const runner = this.db.createQueryRunner();
    let claimed = false;
    let deletingCloud = true;
    let jobLoaded = false;
    try {
      await runner.connect();
      const [lock] = (await runner.query(
        "SELECT pg_try_advisory_lock(hashtext('asset-deletion'), hashtext($1)) AS claimed",
        [id],
      )) as { claimed: boolean }[];
      claimed = lock.claimed;
      if (!claimed) return;
      const [job] = (await runner.query(
        "SELECT * FROM public.asset_deletion_jobs WHERE asset_id = $1 AND status = 'pending'",
        [id],
      )) as DeletionJob[];
      if (!job) return;
      jobLoaded = true;
      for (const target of job.targets)
        await this.cloud.destroyResource(target);
      deletingCloud = false;
      await runner.startTransaction();
      await runner.query(
        `UPDATE public.ai_generations SET output_urls = COALESCE(
        (SELECT jsonb_agg(value) FROM jsonb_array_elements(output_urls) WHERE value <> to_jsonb($1::text) AND public.asset_cloudinary_identity(value #>> '{}') IS DISTINCT FROM $2::jsonb), '[]'::jsonb)
        WHERE output_urls ? $1 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(output_urls) u WHERE public.asset_cloudinary_identity(u) = $2::jsonb)`,
        [job.stored_url, JSON.stringify(job.targets[0])],
      );
      await runner.query(
        'DELETE FROM public.assets WHERE id = $1 AND user_id = $2',
        [id, job.user_id],
      );
      await runner.query(
        "UPDATE public.asset_deletion_jobs SET status = 'completed', last_error = NULL, completed_at = now() WHERE asset_id = $1",
        [id],
      );
      await runner.commitTransaction();
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      if (!claimed || !jobLoaded) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const failure = error as { http_code?: number; statusCode?: number };
      const code = Number(failure?.http_code || failure?.statusCode);
      const permanent = deletingCloud && [400, 401, 403, 404].includes(code);
      await runner.startTransaction();
      try {
        await runner.query(
          `UPDATE public.asset_deletion_jobs SET attempts = attempts + 1, last_error = $2,
          status = CASE WHEN $3::boolean THEN 'failed' ELSE 'pending' END,
          next_attempt_at = now() + LEAST(3600, 60 * power(2, LEAST(attempts, 6))) * interval '1 second'
          WHERE asset_id = $1`,
          [id, message, permanent],
        );
        if (permanent)
          await runner.query(
            `UPDATE public.assets SET metadata = metadata || jsonb_build_object('deleteStatus','failed','deleteError',$2::text) WHERE id = $1`,
            [
              id,
              'Không thể xóa file lưu trữ. Vui lòng kiểm tra cấu hình Cloudinary và thử lại.',
            ],
          );
        await runner.commitTransaction();
      } catch (saveError) {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        throw saveError;
      }
      this.logger.warn(
        `Xóa tài nguyên ${id}: ${permanent ? 'cần kiểm tra cấu hình' : 'sẽ được thử lại'}: ${message}`,
      );
    } finally {
      try {
        if (claimed)
          await runner.query(
            "SELECT pg_advisory_unlock(hashtext('asset-deletion'), hashtext($1))",
            [id],
          );
      } finally {
        await runner.release();
      }
    }
  }

  private async retry() {
    if (this.running || !this.schemaReady) return;
    this.running = true;
    try {
      const jobs = await this.db.query<{ asset_id: string }[]>(
        "SELECT asset_id FROM public.asset_deletion_jobs WHERE status = 'pending' AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT 20",
      );
      for (const job of jobs) await this.process(String(job.asset_id));
    } catch (error) {
      this.logger.warn(`Không thể lấy tác vụ xóa: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
