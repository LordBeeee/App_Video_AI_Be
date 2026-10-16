import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Asset } from '../../assets/entities/asset.entity';
import { AiGenerationAsset } from './ai-generation-asset.entity';

@Injectable()
export class GenerationAssetsService {
  constructor(
    @InjectRepository(Asset) private readonly assets: Repository<Asset>,
    @InjectRepository(AiGenerationAsset)
    private readonly links: Repository<AiGenerationAsset>,
  ) {}

  async saveOutput(
    generationId: string,
    userId: number,
    modality: string,
    url: string,
    metadata: Record<string, any> = {},
  ) {
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
            ? 'image/png'
            : modality === 'audio'
              ? 'audio/mpeg'
              : 'video/mp4',
        fileSizeBytes: null,
        durationSeconds: null,
        fps: null,
        width: null,
        height: null,
        isFavorite: false,
        metadata,
      }),
    );
    await this.links.save(
      this.links.create({ generationId, assetId: asset.id, role: 'output' }),
    );
    return asset;
  }
}
