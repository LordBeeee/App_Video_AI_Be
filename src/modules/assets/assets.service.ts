import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Asset } from './entities/asset.entity';
import { VideoGeneration } from '../video-generations/entities/video-generation.entity';
import { CloudinaryService } from '../../common/cloudinary/cloudinary.service';

const TAB_TO_SOURCE_TYPE: Record<string, string> = {
  creative: 'generated',
  upload: 'uploaded',
};

const LIBRARY_ASSET_TYPES = ['image', 'video', 'audio'];

@Injectable()
export class AssetsService {
  constructor(
    @InjectRepository(Asset) private readonly assetRepo: Repository<Asset>,
    @InjectRepository(VideoGeneration)
    private readonly videoGenerationRepo: Repository<VideoGeneration>,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  async uploadToLibrary(userId: number, file: Express.Multer.File) {
    const isVideo = file.mimetype.startsWith('video/');
    const isImage = file.mimetype.startsWith('image/');
    if (!isVideo && !isImage) {
      throw new BadRequestException('Chỉ hỗ trợ upload ảnh hoặc video');
    }

    const folder = `ai-generation/users/${userId}/library/${isVideo ? 'videos' : 'images'}`;
    const publicId = `${isVideo ? 'video' : 'image'}_${Date.now()}`;

    let storedUrl: string;
    if (isVideo) {
      const result = await this.cloudinaryService.uploadVideoBuffer(file.buffer, folder, publicId);
      storedUrl = result.secure_url;
    } else {
      const result = await this.cloudinaryService.uploadBuffer(file.buffer, folder, publicId);
      storedUrl = result.secure_url;
    }

    const asset = this.assetRepo.create({
      userId,
      projectId: null,
      sceneId: null,
      assetType: isVideo ? 'video' : 'image',
      sourceType: 'uploaded',
      storedUrl,
      originalUrl: storedUrl,
      storageProvider: 'cloudinary',
      mimeType: file.mimetype,
      fileSizeBytes: file.size,
      metadata: {},
    });

    return this.assetRepo.save(asset);
  }

  async findLibrary(
    userId: number,
    opts: { tab: string; type: string; favoritesOnly: boolean },
  ) {
    const sourceType = TAB_TO_SOURCE_TYPE[opts.tab] ?? 'generated';

    const qb = this.assetRepo
      .createQueryBuilder('asset')
      .where('asset.userId = :userId', { userId })
      .andWhere('asset.sourceType = :sourceType', { sourceType })
      .andWhere('asset.assetType IN (:...allowedTypes)', { allowedTypes: LIBRARY_ASSET_TYPES });

    if (opts.type !== 'all') {
      qb.andWhere('asset.assetType = :assetType', { assetType: opts.type });
    }
    if (opts.favoritesOnly) {
      qb.andWhere('asset.isFavorite = true');
    }

    qb.orderBy('asset.createdAt', 'DESC');

    const items = await qb.getMany();

    // Enrich: chỉ áp dụng cho tab Creative + asset loại video
    if (opts.tab === 'creative') {
      const videoAssetIds = items
        .filter((i) => i.assetType === 'video')
        .map((i) => i.id);

      if (videoAssetIds.length > 0) {
        const generations = await this.videoGenerationRepo
          .createQueryBuilder('vg')
          .leftJoinAndSelect('vg.model', 'model')
          .leftJoinAndSelect('vg.imageBeginAsset', 'beginAsset')
          .leftJoinAndSelect('vg.imageEndAsset', 'endAsset')
          .where('vg.outputAssetId IN (:...ids)', { ids: videoAssetIds })
          .getMany();

        const byOutputAssetId = new Map(
          generations.map((g) => [g.outputAssetId, g]),
        );

        for (const item of items as any[]) {
          const gen = byOutputAssetId.get(item.id);
          if (!gen) continue;

          item.prompt = gen.motionPrompt;
          item.model = gen.model?.name ?? null;
          item.mode = gen.generationMode;
          item.frames = [gen.imageBeginAsset?.storedUrl, gen.imageEndAsset?.storedUrl].filter(Boolean);
          // Ảnh đại diện video = frame begin, fallback về chính video nếu không có
          item.thumbnailUrl = gen.imageBeginAsset?.storedUrl ?? null;
        }
      }
    }

    return { items, total: items.length };
  }

  async setFavorite(userId: number, assetId: number, isFavorite: boolean) {
    const asset = await this.assetRepo.findOne({ where: { id: assetId } });
    if (!asset) throw new NotFoundException('Không tìm thấy asset');
    if (Number(asset.userId) !== Number(userId)) {
      throw new ForbiddenException('Không có quyền với asset này');
    }
    asset.isFavorite = isFavorite;
    return this.assetRepo.save(asset);
  }
}