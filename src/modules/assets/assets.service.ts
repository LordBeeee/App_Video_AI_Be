import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CloudinaryService } from '../../common/cloudinary/cloudinary.service';
import { UploadLimitsService } from '../../common/cloudinary/upload-limits.service';
import { AiGenerationAsset } from '../ai-platform/generations/ai-generation-asset.entity';
import { AiGeneration } from '../ai-platform/generations/ai-generation.entity';
import { Asset } from './entities/asset.entity';

const TAB_TO_SOURCE_TYPE: Record<string, string> = {
  creative: 'generated',
  upload: 'uploaded',
};

const LIBRARY_LIMIT_BYTES = 500_000_000;
type StorageMetadata = { cloudinary?: ReturnType<CloudinaryService['storageIdentity']> };

@Injectable()
export class AssetsService {
  constructor(
    @InjectRepository(Asset) private readonly assetRepo: Repository<Asset>,
    @InjectRepository(AiGenerationAsset)
    private readonly generationAssetRepo: Repository<AiGenerationAsset>,
    @InjectRepository(AiGeneration)
    private readonly generationRepo: Repository<AiGeneration>,
    private readonly cloudinaryService: CloudinaryService,
    private readonly uploadLimits: UploadLimitsService,
  ) {}

  async getStorageUsage(userId: number, repository = this.assetRepo) {
    // Include pending/failed deletions and auxiliary files, but not provider
    // references (Element/Voice), which do not create another stored file.
    const items = await repository.find({
      where: { userId, sourceType: In(['uploaded', 'generated']) },
      select: { id: true, storedUrl: true, storageProvider: true, fileSizeBytes: true, metadata: true },
    });
    const files = new Map<string, { size: number | null; items: Asset[] }>();
    for (const item of items) {
      let identity = item.storedUrl;
      if (item.storageProvider === 'cloudinary') {
        try {
          const target = this.cloudinaryService.storageIdentity(item.storedUrl, (item.metadata as StorageMetadata)?.cloudinary);
          identity = JSON.stringify([target.resourceType, target.deliveryType, target.publicId]);
        } catch { /* Legacy URLs still count using their exact stored URL. */ }
      }
      const rawSize = item.fileSizeBytes == null ? NaN : Number(item.fileSizeBytes);
      const size = Number.isSafeInteger(rawSize) && rawSize >= 0 ? rawSize : null;
      const existing = files.get(identity);
      if (existing) {
        existing.items.push(item);
        if (size != null) existing.size = Math.max(existing.size ?? 0, size);
      } else files.set(identity, { size, items: [item] });
    }
    let usedBytes = 0;
    let unknownSizeCount = 0;
    for (const file of files.values()) {
      // Repair legacy missing sizes once, using the storage provider's bytes.
      if (file.size == null && file.items[0].storageProvider === 'cloudinary') {
        try {
          const item = file.items[0];
          file.size = await this.cloudinaryService.getResourceSize(item.storedUrl, (item.metadata as StorageMetadata)?.cloudinary);
          await repository.update({ id: In(file.items.map((item) => item.id)), userId }, { fileSizeBytes: file.size });
        } catch { /* Report unknown sizes; never silently treat them as free. */ }
      }
      if (file.size == null) unknownSizeCount++;
      else usedBytes += file.size;
    }
    return {
      usedBytes,
      limitBytes: LIBRARY_LIMIT_BYTES,
      remainingBytes: Math.max(0, LIBRARY_LIMIT_BYTES - usedBytes),
      unknownSizeCount,
      blocked: usedBytes >= LIBRARY_LIMIT_BYTES || unknownSizeCount > 0,
    };
  }

  async assertStorageAvailable(userId: number, incomingBytes = 0, repository = this.assetRepo) {
    const usage = await this.getStorageUsage(userId, repository);
    if (usage.usedBytes >= usage.limitBytes || usage.usedBytes + incomingBytes > usage.limitBytes) {
      throw new ForbiddenException({
        code: 'LIBRARY_STORAGE_LIMIT_EXCEEDED',
        message: 'Thư viện không đủ dung lượng (giới hạn 500 MB). Vui lòng xóa bớt tài nguyên trước khi tải lên hoặc tạo nội dung mới.',
        ...usage,
      });
    }
    if (usage.unknownSizeCount) {
      throw new ServiceUnavailableException({
        code: 'LIBRARY_STORAGE_USAGE_UNAVAILABLE',
        message: 'Chưa xác định được dung lượng một số file trong thư viện. Vui lòng thử lại sau hoặc liên hệ quản trị viên.',
        ...usage,
      });
    }
    return usage;
  }

  async uploadToLibrary(userId: number, file: Express.Multer.File) {
    const isVideo = file.mimetype.startsWith('video/');
    const isImage = file.mimetype.startsWith('image/');
    const isAudio = file.mimetype.startsWith('audio/');
    if (!isVideo && !isImage && !isAudio) {
      throw new BadRequestException('Chỉ hỗ trợ upload ảnh, video hoặc audio');
    }
    const limits = await this.uploadLimits.getLimits();
    const type = isVideo ? 'video' : isAudio ? 'audio' : 'image';
    if (file.size > limits[type]) {
      throw new BadRequestException(`${isVideo ? 'Video' : isAudio ? 'Âm thanh' : 'Ảnh'} tải lên không được vượt quá ${limits[type] / 1_000_000} MB`);
    }

    // Serialize uploads per user across backend instances. No estimated AI
    // reservations: already admitted generations may finish above the limit.
    const runner = this.assetRepo.manager.connection.createQueryRunner();
    let locked = false;
    try {
      await runner.connect();
      const [claim] = await runner.query("SELECT pg_try_advisory_lock(hashtext('library-upload'), hashtext($1)) AS locked", [String(userId)]) as { locked: boolean }[];
      locked = !!claim?.locked;
      if (!locked) throw new ConflictException('Một file khác đang được tải lên. Vui lòng thử lại sau.');
      // Use this connection for all DB work while holding the session lock,
      // so concurrent uploads cannot exhaust the pool waiting for more connections.
      const repository = runner.manager.getRepository(Asset);
      await this.assertStorageAvailable(userId, file.size, repository);
      return await this.storeUpload(userId, file, isVideo, isImage, isAudio, repository);
    } finally {
      try {
        if (locked) await runner.query("SELECT pg_advisory_unlock(hashtext('library-upload'), hashtext($1))", [String(userId)]);
      } finally {
        await runner.release();
      }
    }
  }

  private async storeUpload(userId: number, file: Express.Multer.File, isVideo: boolean, isImage: boolean, isAudio: boolean, repository: Repository<Asset>) {
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
      const audio = await this.cloudinaryService.uploadAudioBuffer(
        file.buffer,
        folder,
        publicId,
      );
      result = { secure_url: audio.secureUrl, public_id: audio.publicId, duration: audio.durationSeconds, bytes: audio.fileSizeBytes };
    } else {
      result = await this.cloudinaryService.uploadBuffer(
        file.buffer,
        folder,
        publicId,
      );
    }

    return repository.save(
      repository.create({
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
        fileSizeBytes: result.bytes ?? file.size,
        durationSeconds: result.duration ? Math.round(result.duration) : null,
        fps: result.frame_rate ? Math.round(result.frame_rate) : null,
        width: result.width ?? null,
        height: result.height ?? null,
        thumbnailUrl: result.thumbnail_url ?? null,
        isFavorite: false,
        metadata: { mediaDurationSeconds: result.duration ?? null, cloudinary: { publicId: result.public_id, resourceType: isImage ? 'image' : 'video', deliveryType: 'upload' } },
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
      })
      .andWhere("NOT jsonb_exists(asset.metadata, 'duplicateOf')");

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
