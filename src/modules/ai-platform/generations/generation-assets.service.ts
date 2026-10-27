import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Asset } from '../../assets/entities/asset.entity';
import { AiGenerationAsset } from './ai-generation-asset.entity';

@Injectable()
export class GenerationAssetsService {
  constructor(
    @InjectRepository(Asset) private readonly assets: Repository<Asset>,
    @InjectRepository(AiGenerationAsset)
    private readonly links: Repository<AiGenerationAsset>,
    private readonly dataSource: DataSource,
  ) {}

  async findVideoOutput(generationId: string): Promise<Asset | null> {
    const links = await this.links.find({
      where: { generationId, role: 'output' },
      relations: { asset: true },
      order: { createdAt: 'ASC' },
    });
    return links.find((link) => link.asset?.assetType === 'video' &&
      !('duplicateOf' in (link.asset.metadata || {})))?.asset || null;
  }

  async saveOutput(
    generationId: string,
    userId: number,
    modality: string,
    url: string,
    metadata: Record<string, any> = {},
    role: AiGenerationAsset['role'] = 'output',
  ) {
    if (modality === 'video' && role === 'output') {
      return this.dataSource.transaction(async (manager) => {
        await manager.query('SELECT id FROM public.ai_generations WHERE id = $1 FOR UPDATE', [generationId]);
        const existing = await manager.getRepository(AiGenerationAsset).find({
          where: { generationId, role: 'output' },
          relations: { asset: true },
          order: { createdAt: 'ASC' },
        });
        const saved = existing.find((link) => link.asset?.assetType === 'video' &&
          !('duplicateOf' in (link.asset.metadata || {})))?.asset;
        if (saved) return saved;
        const asset = await manager.getRepository(Asset).save(manager.getRepository(Asset).create({
          userId, projectId: null, sceneId: null, assetType: 'video', assetRole: 'output',
          sourceType: 'generated', originalUrl: url, storedUrl: url,
          thumbnailUrl: String(metadata.thumbnailUrl || '') || null,
          storageProvider: 'cloudinary', mimeType: 'video/mp4',
          fileSizeBytes: metadata.fileSizeBytes ?? null,
          durationSeconds: metadata.durationSeconds != null ? Math.round(Number(metadata.durationSeconds)) : null,
          fps: metadata.fps != null ? Math.round(Number(metadata.fps)) : null,
          width: metadata.width ?? null, height: metadata.height ?? null,
          isFavorite: false, metadata: { ...metadata, generationId },
        }));
        await manager.getRepository(AiGenerationAsset).save(
          manager.getRepository(AiGenerationAsset).create({ generationId, assetId: asset.id, role }),
        );
        return asset;
      });
    }
    const asset = await this.assets.save(
      this.assets.create({
        userId,
        projectId: null,
        sceneId: null,
        assetType: modality,
        assetRole: 'output',
        sourceType: 'generated',
        originalUrl: url,
        storedUrl: url,
        thumbnailUrl:
          String(metadata.thumbnailUrl || '') ||
          (modality === 'image' ? url : null),
        storageProvider: 'cloudinary',
        mimeType:
          modality === 'image'
            ? String(metadata.mimeType || 'image/png')
            : modality === 'audio'
              ? 'audio/mpeg'
              : 'video/mp4',
        fileSizeBytes: metadata.fileSizeBytes ?? null,
        durationSeconds: metadata.durationSeconds != null ? Math.round(Number(metadata.durationSeconds)) : null,
        fps: metadata.fps != null ? Math.round(Number(metadata.fps)) : null,
        width: metadata.width ?? null,
        height: metadata.height ?? null,
        isFavorite: false,
        metadata,
      }),
    );
    await this.links.save(
      this.links.create({ generationId, assetId: asset.id, role }),
    );
    return asset;
  }
}
