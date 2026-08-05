import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiElement } from './entities/ai-element.entity';
import { AiElementImage } from './entities/ai-element-image.entity';
import { AiElementVideo } from './entities/ai-element-video.entity';
import { Asset } from '../assets/entities/asset.entity';
import { AiProvider } from '../ai-provider/entities/ai-provider.entity';
import { CloudinaryService } from '../../common/cloudinary/cloudinary.service';
import { KlingService } from '../../common/kling/kling.service';
import { CreateElementDto } from './dto/create-element.dto';

interface ElementFiles {
  frontalImage?: Express.Multer.File;
  referImages?: Express.Multer.File[];
  video?: Express.Multer.File;
}

@Injectable()
export class ElementsService {
  private readonly logger = new Logger(ElementsService.name);

  constructor(
    @InjectRepository(AiElement) private elementRepo: Repository<AiElement>,
    @InjectRepository(AiElementImage) private elementImageRepo: Repository<AiElementImage>,
    @InjectRepository(AiElementVideo) private elementVideoRepo: Repository<AiElementVideo>,
    @InjectRepository(Asset) private assetRepo: Repository<Asset>,
    @InjectRepository(AiProvider) private providerRepo: Repository<AiProvider>,
    private cloudinaryService: CloudinaryService,
    private klingService: KlingService,
  ) {}

  async create(userId: number, dto: CreateElementDto, files: ElementFiles) {
    // 1. Validate provider
    const provider = await this.providerRepo.findOne({ where: { id: dto.providerId } });
    if (!provider) throw new BadRequestException('Provider không tồn tại');

    // 2. Validate field cơ bản
    if (!dto.elementName?.trim()) throw new BadRequestException('Tên Element là bắt buộc');
    if (dto.elementName.length > 20) throw new BadRequestException('Tên Element tối đa 20 ký tự');
    if (!dto.elementDescription?.trim()) throw new BadRequestException('Mô tả là bắt buộc');
    if (dto.elementDescription.length > 100) throw new BadRequestException('Mô tả tối đa 100 ký tự');

    if (dto.referenceType === 'image_refer') {
      const hasFrontal = !!(dto.frontalImageAssetId || files.frontalImage);
      if (!hasFrontal) throw new BadRequestException('Ảnh chính diện là bắt buộc');

      const referCount = (dto.referImageAssetIds?.length ?? 0) + (files.referImages?.length ?? 0);
      if (referCount < 1 || referCount > 3) {
        throw new BadRequestException('Cần 1-3 ảnh tham chiếu bổ sung');
      }
    } else {
      const hasVideo = !!(dto.videoAssetId || files.video);
      if (!hasVideo) throw new BadRequestException('Video tham chiếu là bắt buộc');
      if (dto.elementVoiceId) {
        throw new BadRequestException('Element Voice ID chỉ áp dụng khi loại tham chiếu là ảnh');
      }
    }

    const baseFolder = `ai-generation/users/${userId}/elements`;

    // 3. Resolve assets (reuse có sẵn hoặc upload mới)
    let frontalAsset: Asset | null = null;
    let referAssets: Asset[] = [];
    let videoAsset: Asset | null = null;

    if (dto.referenceType === 'image_refer') {
      frontalAsset = await this.resolveImageAsset(
        userId, dto.frontalImageAssetId, files.frontalImage, `${baseFolder}/frontal`, 'frontal',
      );
      referAssets = await this.resolveMultipleImageAssets(
        userId, dto.referImageAssetIds, files.referImages, `${baseFolder}/refer`,
      );
    } else {
      videoAsset = await this.resolveVideoAsset(
        userId, dto.videoAssetId, files.video, `${baseFolder}/video`,
      );
    }

    // 4. Tạo record ai_elements (status=pending) — chưa gắn project
    const element = await this.elementRepo.save(
      this.elementRepo.create({
        userId,
        providerId: dto.providerId,
        projectId: null,
        elementName: dto.elementName,
        elementDescription: dto.elementDescription,
        referenceType: dto.referenceType,
        elementVoiceId: dto.referenceType === 'image_refer' ? (dto.elementVoiceId || null) : null,
        status: 'pending',
      }),
    );

    // 5. Lưu ai_element_images / ai_element_videos
    if (dto.referenceType === 'image_refer') {
      await this.elementImageRepo.save([
        this.elementImageRepo.create({
          elementId: element.id,
          assetId: frontalAsset!.id,
          imageRole: 'frontal',
          sortOrder: 0,
        }),
        ...referAssets.map((asset, i) =>
          this.elementImageRepo.create({
            elementId: element.id,
            assetId: asset.id,
            imageRole: 'refer',
            sortOrder: i + 1,
          }),
        ),
      ]);
    } else {
      await this.elementVideoRepo.save(
        this.elementVideoRepo.create({ elementId: element.id, assetId: videoAsset!.id }),
      );
    }

    // 6. Gọi Kling API tạo element (bất đồng bộ)
    const klingPayload = {
      elementName: dto.elementName,
      elementDescription: dto.elementDescription,
      referenceType: dto.referenceType,
      frontalImageUrl: frontalAsset?.storedUrl,
      referImageUrls: referAssets.map((a) => a.storedUrl),
      videoUrl: videoAsset?.storedUrl,
      elementVoiceId: dto.referenceType === 'image_refer' ? dto.elementVoiceId : undefined,
    };

    const klingCreate = await this.klingService.createElement(klingPayload);

    if (klingCreate.code !== 0) {
      await this.elementRepo.update(element.id, {
        status: 'failed',
        errorMessage: klingCreate.message,
        responsePayload: klingCreate as any,
      });
      throw new BadRequestException(`Kling error: ${klingCreate.message}`);
    }

    const taskId = klingCreate.data.task_id;

    await this.elementRepo.update(element.id, {
      status: 'processing',
      externalElementId: taskId, // tạm = task_id, sẽ bị ghi đè bằng element_id thật khi succeeded
      requestPayload: klingPayload as any,
      responsePayload: klingCreate as any,
    });

    // 7. Poll ngầm — không block response
    this.pollAndSaveElementResult(element.id, taskId).catch((err) =>
      this.logger.error(`Element polling error: ${err.message}`),
    );

    return {
      message: 'Đang tạo element, vui lòng chờ...',
      elementId: element.id,
      taskId,
      status: 'processing',
      frontalImageUrl: frontalAsset?.storedUrl ?? null,
      referImageUrls: referAssets.map((a) => a.storedUrl),
      videoUrl: videoAsset?.storedUrl ?? null,
    };
  }

  private async pollAndSaveElementResult(elementId: number, taskId: string) {
    try {
      const taskResult = await this.klingService.pollElementUntilDone(taskId, 5000, 30);
      const resultElement = taskResult.task_result?.elements?.[0];

      if (!resultElement) {
        throw new Error('Kling trả về succeed nhưng không có element data');
      }

      await this.elementRepo.update(elementId, {
        status: 'succeeded',
        externalElementId: String(resultElement.element_id),
        responsePayload: taskResult as any,
      });

      this.logger.log(`[Element ${elementId}] DONE - Kling elementId: ${resultElement.element_id}`);
    } catch (err: any) {
      this.logger.error(`[Element ${elementId}] FAILED: ${err.message}`);
      await this.elementRepo.update(elementId, {
        status: 'failed',
        errorMessage: err.message,
      });
    }
  }

  private async resolveImageAsset(
    userId: number,
    assetId: number | undefined,
    file: Express.Multer.File | undefined,
    folder: string,
    publicIdPrefix: string,
  ): Promise<Asset | null> {
    if (assetId) {
      const asset = await this.assetRepo.findOne({ where: { id: assetId } });
      if (!asset) throw new BadRequestException(`Không tìm thấy ảnh đã chọn (id=${assetId})`);
      if (Number(asset.userId) !== Number(userId)) {
        throw new BadRequestException('Không có quyền dùng ảnh này');
      }
      return asset;
    }
    if (!file) return null;

    const upload = await this.cloudinaryService.uploadBuffer(
      file.buffer, folder, `${publicIdPrefix}_${Date.now()}`,
    );

    return this.assetRepo.save(
      this.assetRepo.create({
        userId,
        assetType: 'image',
        sourceType: 'uploaded',
        originalUrl: upload.secure_url,
        storedUrl: upload.secure_url,
        storageProvider: 'cloudinary',
        mimeType: file.mimetype,
        fileSizeBytes: file.size,
        metadata: { cloudinary_public_id: upload.public_id, width: upload.width, height: upload.height },
      }),
    );
  }

  private async resolveMultipleImageAssets(
    userId: number,
    assetIds: number[] | undefined,
    files: Express.Multer.File[] | undefined,
    folder: string,
  ): Promise<Asset[]> {
    const result: Asset[] = [];

    for (const id of assetIds ?? []) {
      const asset = await this.assetRepo.findOne({ where: { id } });
      if (!asset) throw new BadRequestException(`Không tìm thấy ảnh tham chiếu đã chọn (id=${id})`);
      if (Number(asset.userId) !== Number(userId)) {
        throw new BadRequestException('Không có quyền dùng ảnh này');
      }
      result.push(asset);
    }

    for (const file of files ?? []) {
      const upload = await this.cloudinaryService.uploadBuffer(
        file.buffer, folder, `refer_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      );
      const asset = await this.assetRepo.save(
        this.assetRepo.create({
          userId,
          assetType: 'image',
          sourceType: 'uploaded',
          originalUrl: upload.secure_url,
          storedUrl: upload.secure_url,
          storageProvider: 'cloudinary',
          mimeType: file.mimetype,
          fileSizeBytes: file.size,
          metadata: { cloudinary_public_id: upload.public_id, width: upload.width, height: upload.height },
        }),
      );
      result.push(asset);
    }

    return result;
  }

  private async resolveVideoAsset(
    userId: number,
    assetId: number | undefined,
    file: Express.Multer.File | undefined,
    folder: string,
  ): Promise<Asset | null> {
    if (assetId) {
      const asset = await this.assetRepo.findOne({ where: { id: assetId } });
      if (!asset) throw new BadRequestException(`Không tìm thấy video đã chọn (id=${assetId})`);
      if (Number(asset.userId) !== Number(userId)) {
        throw new BadRequestException('Không có quyền dùng video này');
      }
      return asset;
    }
    if (!file) return null;

    const upload = await this.cloudinaryService.uploadVideoBuffer(
      file.buffer, folder, `video_${Date.now()}`,
    );

    return this.assetRepo.save(
      this.assetRepo.create({
        userId,
        assetType: 'video',
        sourceType: 'uploaded',
        originalUrl: upload.secure_url,
        storedUrl: upload.secure_url,
        thumbnailUrl: upload.thumbnail_url,
        storageProvider: 'cloudinary',
        mimeType: file.mimetype,
        fileSizeBytes: file.size,
        durationSeconds: upload.duration ? Math.round(upload.duration) : null,
        width: upload.width,
        height: upload.height,
        metadata: { cloudinary_public_id: upload.public_id },
      }),
    );
  }

  async getHistory(userId: number) {
    const elements = await this.elementRepo.find({
      where: { userId },
      relations: ['provider', 'images', 'images.asset', 'video', 'video.asset'],
      order: { createdAt: 'DESC' },
      take: 50,
    });

    return elements.map((el) => {
      const frontal = el.images?.find((i) => i.imageRole === 'frontal');
      const refers = (el.images?.filter((i) => i.imageRole === 'refer') ?? [])
        .sort((a, b) => a.sortOrder - b.sortOrder);

      return {
        id: el.id,
        status: el.status,
        elementName: el.elementName,
        elementDescription: el.elementDescription,
        referenceType: el.referenceType,
        elementVoiceId: el.elementVoiceId,
        externalElementId: el.status === 'succeeded' ? el.externalElementId : null,
        providerName: el.provider?.name ?? 'Unknown',
        frontalImageUrl: frontal?.asset?.storedUrl ?? null,
        referImageUrls: refers.map((r) => r.asset?.storedUrl).filter(Boolean),
        videoUrl: el.video?.asset?.storedUrl ?? null,
        errorMessage: el.errorMessage ?? null,
        isFavorite: el.isFavorite,
        createdAt: el.createdAt,
      };
    });
  }

  async getStatus(id: number) {
    const element = await this.elementRepo.findOne({
      where: { id },
      relations: ['images', 'images.asset', 'video', 'video.asset'],
    });
    if (!element) throw new NotFoundException('Không tìm thấy element');

    const frontal = element.images?.find((i) => i.imageRole === 'frontal');
    const refers = element.images?.filter((i) => i.imageRole === 'refer') ?? [];

    return {
      id: element.id,
      status: element.status,
      elementName: element.elementName,
      referenceType: element.referenceType,
      externalElementId: element.status === 'succeeded' ? element.externalElementId : null,
      frontalImageUrl: frontal?.asset?.storedUrl ?? null,
      referImageUrls: refers.map((r) => r.asset?.storedUrl).filter(Boolean),
      videoUrl: element.video?.asset?.storedUrl ?? null,
      errorMessage: element.errorMessage ?? null,
    };
  }

  async getKlingTaskStatus(taskId: string) {
    return this.klingService.getElementTaskStatus(taskId);
  }

  async remove(userId: number, id: number) {
    const element = await this.elementRepo.findOne({ where: { id } });
    if (!element) throw new NotFoundException('Không tìm thấy element');
    if (Number(element.userId) !== Number(userId)) {
      throw new ForbiddenException('Không có quyền xóa element này');
    }

    if (element.status === 'succeeded' && element.externalElementId) {
      try {
        await this.klingService.deleteElement(element.externalElementId);
      } catch (err: any) {
        this.logger.warn(`[Element ${id}] Xóa trên Kling thất bại: ${err.message} — vẫn xóa record nội bộ`);
      }
    }

    await this.elementRepo.delete(id); // ai_element_images/ai_element_videos tự xóa theo CASCADE
    return { message: 'Đã xóa element' };
  }

  async setFavorite(userId: number, id: number, isFavorite: boolean) {
    const element = await this.elementRepo.findOne({ where: { id } });
    if (!element) throw new NotFoundException('Không tìm thấy element');
    if (Number(element.userId) !== Number(userId)) {
      throw new ForbiddenException('Không có quyền với element này');
    }
    element.isFavorite = isFavorite;
    return this.elementRepo.save(element);
  }
}