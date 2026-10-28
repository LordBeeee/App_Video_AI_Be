import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Asset } from '../../assets/entities/asset.entity';
import { KlingService } from '../kling.service';

@Injectable()
export class CustomAssetReconciliationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CustomAssetReconciliationService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @InjectRepository(Asset) private readonly assets: Repository<Asset>,
    private readonly kling: KlingService,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit() {
    const intervalMs = Math.max(15_000,
      Number(this.config.get<string>('CUSTOM_ASSET_RECONCILE_INTERVAL_MS')) || 30_000);
    this.timer = setInterval(() => void this.reconcilePending(), intervalMs);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async reconcilePending() {
    if (this.running) return;
    this.running = true;
    try {
      const pending = await this.assets.createQueryBuilder('asset')
        .where("asset.storage_provider = 'kling'")
        .andWhere("asset.asset_role IN ('voice', 'element')")
        .andWhere("(asset.metadata->>'deleteStatus' IN ('submitted', 'processing') OR (asset.metadata->>'status' IN ('submitted', 'processing') AND asset.metadata->>'deleteStatus' IS NULL))")
        .andWhere("(asset.metadata->>'nextCheckAt' IS NULL OR asset.metadata->>'nextCheckAt' <= :now)", { now: new Date().toISOString() })
        .orderBy('asset.created_at', 'ASC')
        .take(20)
        .getMany();
      for (const asset of pending) {
        const lock = this.dataSource.createQueryRunner();
        let claimed = false;
        try {
          await lock.connect();
          const [result] = await lock.query(
            'SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS claimed',
            ['kling-custom-asset', String(asset.id)],
          );
          claimed = !!result?.claimed;
          if (!claimed) continue;
          const fresh = await this.assets.findOne({ where: { id: asset.id } });
          if (fresh) {
            const ageMs = Date.now() - new Date(fresh.createdAt || Date.now()).getTime();
            const delayMs = ageMs < 120_000 ? 30_000 : ageMs < 600_000 ? 60_000 : 120_000;
            fresh.metadata = { ...fresh.metadata, nextCheckAt: new Date(Date.now() + delayMs).toISOString() };
            await this.assets.save(fresh);
            await this.kling.reconcileCustomAsset(fresh);
          }
        } catch (error) {
          this.logger.warn(`Không thể đối soát tài nguyên Kling ${asset.id}: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          if (claimed) await lock.query(
            'SELECT pg_advisory_unlock(hashtext($1), hashtext($2))',
            ['kling-custom-asset', String(asset.id)],
          );
          await lock.release();
        }
      }
    } catch (error) {
      this.logger.warn(`Không thể lấy tài nguyên Kling cần đối soát: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
