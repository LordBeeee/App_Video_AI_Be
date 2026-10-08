import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CloudinaryService } from '../../common/cloudinary/cloudinary.service';
import { AiGenerationAsset } from '../ai-platform/entities/ai-generation-asset.entity';
import { AiGeneration } from '../ai-platform/entities/ai-generation.entity';
import { Asset } from './entities/asset.entity';

const TAB_TO_SOURCE_TYPE: Record<string, string> = {
  creative: 'generated',
  upload: 'uploaded',
};

@Injectable()
export class AssetsService {
  constructor(
    @InjectRepository(Asset) private readonly assetRepo: Repository<Asset>,
    @InjectRepository(AiGenerationAsset)
    private readonly generationAssetRepo: Repository<AiGenerationAsset>,
    @InjectRepository(AiGeneration)
    private readonly generationRepo: Repository<AiGeneration>,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  async uploadToLibrary(userId: number, file: Express.Multer.File) {
    const isVideo = file.mimetype.startsWith('video/');
    const isImage = file.mimetype.startsWith('image/');
    const isAudio = file.mimetype.startsWith('audio/');
    if (!isVideo && !isImage && !isAudio) {
      throw new BadRequestException('Chỉ hỗ trợ upload ảnh, video hoặc audio');
    }

    const assetType = isVideo ? 'video' : isAudio ? 'audio' : 'image';
    const folder = `ai-generation/users/${userId}/library/${assetType}`;
    const publicId = `${assetType}_${Date.now()}`;
    let result: any;
    if (isVideo) {
      result = await this.cloudinaryService.uploadVideoBuffer(
        file.buffer,
        folder,
        publicId,
      );
    } else if (isAudio) {
      const secureUrl = await this.cloudinaryService.uploadAudioBuffer(
        file.buffer,
        folder,
        publicId,
      );
      result = { secure_url: secureUrl };
    } else {
      result = await this.cloudinaryService.uploadBuffer(
        file.buffer,
        folder,
        publicId,
      );
    }

    return this.assetRepo.save(
      this.assetRepo.create({
        userId,
        projectId: null,
        sceneId: null,
        assetType,
        assetRole: null,
        sourceType: 'uploaded',
        storedUrl: result.secure_url,
        originalUrl: result.secure_url,
        storageProvider: 'cloudinary',
        mimeType: file.mimetype,
        fileSizeBytes: file.size,
        durationSeconds: result.duration ? Math.round(result.duration) : null,
        fps: result.frame_rate ? Math.round(result.frame_rate) : null,
        width: result.width ?? null,
        height: result.height ?? null,
        thumbnailUrl: result.thumbnail_url ?? null,
        isFavorite: false,
        metadata: {},
      }),
    );
  }

  async findLibrary(
    userId: number,
    opts: { tab: string; type: string; favoritesOnly: boolean },
  ) {
    const qb = this.assetRepo
      .createQueryBuilder('asset')
      .where('asset.userId = :userId', { userId })
      .andWhere('asset.sourceType = :sourceType', {
        sourceType: TAB_TO_SOURCE_TYPE[opts.tab] ?? 'generated',
      })
      .andWhere('asset.assetType IN (:...allowedTypes)', {
        allowedTypes: ['image', 'video', 'audio'],
      });

    if (opts.type !== 'all') {
      qb.andWhere('asset.assetType = :assetType', { assetType: opts.type });
    }
    if (opts.favoritesOnly) qb.andWhere('asset.isFavorite = true');
    const items = (await qb
      .orderBy('asset.createdAt', 'DESC')
      .getMany()) as Array<Asset & Record<string, any>>;

    if (opts.tab === 'creative' && items.length) {
      const links = await this.generationAssetRepo.find({
        where: { assetId: In(items.map((item) => item.id)), role: 'output' },
      });
      const generations = links.length
        ? await this.generationRepo.find({
            where: { id: In(links.map((link) => link.generationId)) },
          })
        : [];
      const generationById = new Map(
        generations.map((item) => [item.id, item]),
      );
      const linkByAssetId = new Map(
        links.map((item) => [Number(item.assetId), item]),
      );
      const inputLinks = generations.length
        ? await this.generationAssetRepo.find({
            where: {
              generationId: In(generations.map((item) => item.id)),
              role: In(['input', 'reference']),
            },
            relations: { asset: true },
          })
        : [];
      const inputsByGeneration = new Map<string, AiGenerationAsset[]>();
      for (const link of inputLinks) {
        const current = inputsByGeneration.get(link.generationId) || [];
        current.push(link);
        inputsByGeneration.set(link.generationId, current);
      }
      for (const item of items) {
        const link = linkByAssetId.get(Number(item.id));
        const generation = link && generationById.get(link.generationId);
        if (!generation) continue;
        item.prompt = generation.prompt;
        item.model = generation.modelNameSnapshot || generation.modelSlug;
        item.resolution =
          generation.options?.resolution || generation.options?.quality || null;
        item.duration = generation.options?.duration || item.durationSeconds;
        item.priceVnd =
          generation.chargedVnd == null
            ? Number(generation.estimatedMaxVnd)
            : Number(generation.chargedVnd);
        item.frames = (inputsByGeneration.get(generation.id) || []).map(
          (input) => input.asset.storedUrl,
        );
        item.thumbnailUrl ||= item.frames[0] || null;
      }
    }

    return { items, total: items.length };
  }

  async setFavorite(userId: number, assetId: number, isFavorite: boolean) {
    const asset = await this.assetRepo.findOne({ where: { id: assetId } });
    if (!asset) throw new NotFoundException('Không tìm thấy asset');
    if (Number(asset.userId) !== Number(userId)) throw new ForbiddenException();
    asset.isFavorite = isFavorite;
    return this.assetRepo.save(asset);
  }
}
