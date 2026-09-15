import {
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In} from 'typeorm';
import { VideoGeneration } from './entities/video-generation.entity';
import { MotionGeneration } from './entities/motion-generation.entity';
import { Asset } from '../assets/entities/asset.entity';
import { Project } from '../projects/entities/project.entity';
import { AiModelsService } from '../ai-models/ai-models.service';
import { CloudinaryService } from '../../common/cloudinary/cloudinary.service';
import { KlingService } from '../../common/kling/kling.service';
import { BytePlusService } from '../../common/byteplus/byteplus.service';
import { CreateMotionControlVideoDto, CreateVideoDto } from './dto/create-video.dto';
import { VideoGenerationElement } from './entities/video-generation-element.entity';
import { AiElement } from '../elements/entities/ai-element.entity';

@Injectable()
export class VideoGenerationsService {
  private readonly logger = new Logger(VideoGenerationsService.name);

  constructor(
    @InjectRepository(VideoGeneration)
    private videoGenerationRepo: Repository<VideoGeneration>,

    @InjectRepository(MotionGeneration)
    private motionGenerationRepo: Repository<MotionGeneration>,

    @InjectRepository(Asset)
    private assetRepo: Repository<Asset>,

    @InjectRepository(Project)
    private projectRepo: Repository<Project>,

    @InjectRepository(VideoGenerationElement)
    private videoGenerationElementRepo: Repository<VideoGenerationElement>,

    @InjectRepository(AiElement)
    private aiElementRepo: Repository<AiElement>,

    private aiModelsService: AiModelsService,
    private cloudinaryService: CloudinaryService,
    private klingService: KlingService,
    private bytePlusService: BytePlusService,
  ) {}

  async createVideo(
    userId: number,
    dto: CreateVideoDto,
    startImageFile?: Express.Multer.File,
    endImageFile?: Express.Multer.File,
  ) {
    // 1. Validate model
    const model = await this.aiModelsService.findOne(dto.modelId);
    if (!model) throw new BadRequestException('Model không tồn tại');
    if (model.modelType !== 'video_generation') {
      throw new BadRequestException('Model không phải video generation');
    }

    const isByteplus = model.provider?.code === 'byteplus';

    // ── NEW: resolve elements ─────────────────────────────────────────
    const elements = await this.resolveElements(userId, dto.elementIds, model.supportsElements);
    const elementExternalIds = elements.map((e) => Number(e.externalElementId));

    // 2. Validate multi-shot params (chỉ áp dụng cho Kling; BytePlus không hỗ trợ multi-shot)
    if (!isByteplus && dto.multiShot) {
      if (!dto.shotType) {
        throw new BadRequestException('shotType là bắt buộc khi multiShot=true');
      }
      if (dto.shotType === 'customize') {
        if (!dto.multiPrompt || dto.multiPrompt.length === 0) {
          throw new BadRequestException('multiPrompt là bắt buộc khi shotType=customize');
        }
        const totalShotDuration = dto.multiPrompt.reduce(
          (sum, s) => sum + Number(s.duration),
          0,
        );
        const videoDuration = Number(dto.duration || 5);
        if (totalShotDuration !== videoDuration) {
          throw new BadRequestException(
            `Tổng duration của shots (${totalShotDuration}s) phải bằng duration video (${videoDuration}s)`,
          );
        }
      } else if (dto.shotType === 'intelligence') {
        if (!dto.prompt?.trim()) {
          throw new BadRequestException('prompt là bắt buộc khi shotType=intelligence');
        }
      }
    } else {
      if (!dto.prompt?.trim()) {
        throw new BadRequestException('prompt là bắt buộc');
      }
    }

    // 3. Tạo project mới
    const titleSource =
      !isByteplus && dto.multiShot && dto.shotType === 'customize'
        ? dto.multiPrompt![0].prompt
        : dto.prompt;

    const project = await this.projectRepo.save(
      this.projectRepo.create({
        userId,
        title: titleSource.slice(0, 100),
        workflowMode: 'video_only',
        status: 'video_generating',
        promptStepStatus: 'skipped',
        imageStepStatus: 'skipped',
        videoStepStatus: 'processing',
        metadata: {},
      }),
    );

    const projectId = project.id;
    const sceneNumber = dto.sceneNumber ?? 1;
    const baseFolder = `ai-generation/users/${userId}/projects/${projectId}/scenes/scene-${sceneNumber}/images`;

    // 4. Resolve start image (reuse asset có sẵn hoặc upload mới)
    const beginAsset = await this.resolveImageAsset(
      userId,
      dto.startImageAssetId,
      startImageFile,
      baseFolder,
      'begin',
      'image_begin',
    );
    if (!beginAsset) {
      throw new BadRequestException('Cần cung cấp startImage hoặc startImageAssetId');
    }
    if (!beginAsset.projectId) {
      beginAsset.projectId = projectId;
      await this.assetRepo.save(beginAsset);
    }

    // 5. Resolve end image nếu có
    let endAsset: Asset | null = null;
    if (dto.endImageAssetId || endImageFile) {
      endAsset = await this.resolveImageAsset(
        userId,
        dto.endImageAssetId,
        endImageFile,
        baseFolder,
        'end',
        'image_end',
      );
      if (endAsset && !endAsset.projectId) {
        endAsset.projectId = projectId;
        await this.assetRepo.save(endAsset);
      }
    }

    // 6. Branch theo provider: Kling hay BytePlus
    let externalTaskId: string;
    let responsePayloadRaw: any;

    if (isByteplus) {
      this.logger.log(
        `[BytePlus] Creating task - model: ${model.code}, resolution: ${dto.resolution}, ratio: ${dto.ratio}`,
      );

      const bytePlusCreate = await this.bytePlusService.createVideoTask({
        modelCode:     model.code,
        prompt:        dto.prompt,
        imageUrl:      beginAsset.storedUrl,
        imageTailUrl:  endAsset?.storedUrl,
        resolution:    dto.resolution,
        ratio:         dto.ratio,
        duration:      Number(dto.duration || 5),
        generateAudio: dto.sound === 'on',
      });

      externalTaskId     = bytePlusCreate.id;
      responsePayloadRaw = bytePlusCreate;
    } else {
      const klingModelName = model.code;
      this.logger.log(
        `[Kling] Creating task - model: ${klingModelName}, multiShot: ${dto.multiShot}, shotType: ${dto.shotType}`,
      );

      const klingCreate = await this.klingService.createImageToVideo({
        modelName:     klingModelName,
        imageUrl:      beginAsset.storedUrl,
        imageTailUrl:  endAsset?.storedUrl,
        prompt:        dto.prompt,
        sound:         dto.sound || 'off',
        negativePrompt: dto.negativePrompt,
        duration:      dto.duration || '5',
        mode:          (dto.mode as 'std' | 'pro' | '4k') || 'pro',
        multiShot:     dto.multiShot,
        shotType:      dto.shotType,
        multiPrompt:   dto.multiPrompt,
        elementList:   elementExternalIds.length ? elementExternalIds : undefined,
      });

      if (klingCreate.code !== 0) {
        await this.projectRepo.update(projectId, {
          status: 'failed',
          videoStepStatus: 'failed',
        });
        throw new BadRequestException(`Kling error: ${klingCreate.message}`);
      }

      externalTaskId     = klingCreate.data.task_id;
      responsePayloadRaw = klingCreate;
    }

    // 7. Lưu video_generation
    const storedPrompt = this.buildStoredPrompt(dto, isByteplus);

    const videoGen = await this.videoGenerationRepo.save(
      this.videoGenerationRepo.create({
        projectId,
        modelId: dto.modelId,
        imageBeginAssetId: beginAsset.id,
        imageEndAssetId:   endAsset?.id ?? undefined,
        motionPrompt:      storedPrompt,
        negativePrompt:    dto.negativePrompt,
        status:            'queued',
        externalTaskId,
        durationSeconds:   Number(dto.duration || 5),
        generationMode:    isByteplus ? (dto.resolution || '720p') : (dto.mode || 'std'),
        generationRatio:   isByteplus ? dto.ratio : undefined,
        generationSound:   dto.sound === 'on',
        cost:              dto.cost ?? 0,
        params: {
          resolution: dto.resolution,
          ratio: dto.ratio,
          mode: dto.mode,
          multiShot: dto.multiShot ?? false,
          shotType: dto.shotType,
          elementIds: elements.map((e) => e.id),
        },
        requestPayload: {
          modelName:    model.code,
          prompt:       dto.prompt,
          duration:     dto.duration,
          mode:         dto.mode,
          ratio:        dto.ratio,
          sound:        dto.sound,
          multiShot:    dto.multiShot ?? false,
          shotType:     dto.shotType,
          multiPrompt:  dto.multiPrompt,
          elementList:  elementExternalIds,
        },
        responsePayload: responsePayloadRaw,
        startedAt: new Date(),
      }),
    );

    if (elements.length > 0) {
      await this.videoGenerationElementRepo.save(
        elements.map((el, idx) =>
          this.videoGenerationElementRepo.create({
            videoGenerationId: videoGen.id,
            elementId: el.id,
            tagId: String(idx + 1),
          }),
        ),
      );
    }

    // 8. Polling ngầm — chọn service theo provider
    if (isByteplus) {
      this.pollAndSaveResultByteplus(videoGen.id, externalTaskId, userId, projectId).catch(
        (err) => this.logger.error(`BytePlus polling error: ${err.message}`),
      );
    } else {
      this.pollAndSaveResult(videoGen.id, externalTaskId, userId, projectId).catch(
        (err) => this.logger.error(`Kling polling error: ${err.message}`),
      );
    }

    return {
      message: 'Đang tạo video, vui lòng chờ...',
      videoGenerationId: videoGen.id,
      projectId,
      taskId: externalTaskId,
      status: 'queued',
      beginImageUrl: beginAsset.storedUrl,
      endImageUrl:   endAsset?.storedUrl ?? null,
      promptSent:    storedPrompt,
      modelName:     model.name,
      generationMode: isByteplus ? (dto.resolution || '720p') : (dto.mode || 'pro'),
      multiShot:     !isByteplus && (dto.multiShot ?? false),
      shotType:      dto.shotType,
      cost:          dto.cost ?? 0,
      elementsUsed: elements.map((e) => ({ id: e.id, name: e.elementName })),
    };
  }

  private buildStoredPrompt(dto: CreateVideoDto, isByteplus = false): string {
    if (!isByteplus && dto.multiShot && dto.shotType === 'customize' && dto.multiPrompt?.length) {
      return dto.multiPrompt
        .map((s) => `[Shot ${s.index}] ${s.prompt} (${s.duration}s)`)
        .join(' | ');
    }
    return dto.prompt || '';
  }

  /**
   * Ưu tiên dùng asset có sẵn (assetId) để tránh upload trùng lên Cloudinary.
   * Chỉ upload file mới khi không có assetId.
   */
  private async resolveImageAsset(
    userId: number,
    assetId: number | undefined,
    file: Express.Multer.File | undefined,
    baseFolder: string,
    role: string,
    assetRole: string,
  ): Promise<Asset | null> {
    if (assetId) {
      const asset = await this.assetRepo.findOne({ where: { id: assetId } });
      if (!asset) {
        throw new BadRequestException(`Không tìm thấy ảnh ${role} đã chọn (id=${assetId})`);
      }
      if (Number(asset.userId) !== Number(userId)) {
        throw new BadRequestException(`Không có quyền dùng ảnh ${role} này`);
      }
      return asset;
    }

    if (!file) return null;

    this.logger.log(`Uploading ${role} image...`);
    const upload = await this.cloudinaryService.uploadBuffer(
      file.buffer,
      `${baseFolder}/${role}`,
      `${role}_${Date.now()}`,
    );

    return this.assetRepo.save(
      this.assetRepo.create({
        userId,
        assetType: 'image',
        assetRole,
        sourceType: 'uploaded',
        originalUrl: upload.secure_url,
        storedUrl: upload.secure_url,
        storageProvider: 'cloudinary',
        mimeType: file.mimetype,
        fileSizeBytes: file.size,
        metadata: {
          cloudinary_public_id: upload.public_id,
          width: upload.width,
          height: upload.height,
        },
      }),
    );
  }

    /**
   * Validate + resolve danh sách element user chọn.
   * - Model phải supportsElements = true
   * - Tối đa 3 element, không trùng lặp
   * - Element phải thuộc user, status = 'succeeded' (đã có externalElementId từ Kling)
   * - Trả về đúng thứ tự user đã chọn
   */
  private async resolveElements(
    userId: number,
    elementIds: number[] | undefined,
    modelSupportsElements: boolean,
  ): Promise<AiElement[]> {
    if (!elementIds || elementIds.length === 0) return [];

    if (!modelSupportsElements) {
      throw new BadRequestException('Model đã chọn không hỗ trợ Element');
    }
    if (elementIds.length > 3) {
      throw new BadRequestException('Chỉ được chọn tối đa 3 Element');
    }

    const uniqueIds = [...new Set(elementIds)];
    if (uniqueIds.length !== elementIds.length) {
      throw new BadRequestException('Danh sách Element bị trùng lặp');
    }

    const elements = await this.aiElementRepo.find({ where: { id: In(uniqueIds) } });

    if (elements.length !== uniqueIds.length) {
      throw new BadRequestException('Một hoặc nhiều Element không tồn tại');
    }

    for (const el of elements) {
      if (Number(el.userId) !== Number(userId)) {
        throw new BadRequestException(`Không có quyền dùng Element "${el.elementName}"`);
      }
      if (el.status !== 'succeeded' || !el.externalElementId) {
        throw new BadRequestException(
          `Element "${el.elementName}" chưa sẵn sàng (status: ${el.status})`,
        );
      }
    }

    // giữ đúng thứ tự user chọn (ảnh hưởng tag <<<element_N>>> nếu prompt có dùng)
    return uniqueIds.map((id) => elements.find((e) => e.id === id)!);
  }

  private async pollAndSaveResult(
    videoGenId: number,
    taskId: string,
    userId: number,
    projectId: number,
  ) {
    try {
      await this.videoGenerationRepo.update(videoGenId, { status: 'processing' });
      const taskResult = await this.klingService.pollUntilDone(taskId, 30000, 40);
      const videoData = taskResult.task_result?.videos?.[0];

      if (!videoData) {
        throw new Error('Kling trả về succeed nhưng không có video URL');
      }

      this.logger.log(`Uploading video to Cloudinary...`);
      const cloudinaryVideoUrl = await this.uploadVideoToCloudinary(
        videoData.url,
        userId,
        projectId,
        videoGenId,
      );

      const videoAsset = await this.assetRepo.save(
        this.assetRepo.create({
          userId,
          projectId,
          assetType: 'video',
          assetRole: 'scene_video',
          sourceType: 'generated',
          originalUrl: videoData.url,
          storedUrl:   cloudinaryVideoUrl,
          storageProvider: 'cloudinary',
          durationSeconds: videoData.duration ? Math.round(parseFloat(videoData.duration)) : null,
          metadata: {
            kling_video_id: videoData.id,
            duration: videoData.duration,
          },
        }),
      );

      await this.videoGenerationRepo.update(videoGenId, {
        status:         'succeeded',
        outputAssetId:  videoAsset.id,
        completedAt:    new Date(),
        resultPayload:  taskResult as any,
      });

      await this.projectRepo.update(projectId, {
        status:          'completed',
        videoStepStatus: 'succeeded',
      });

      this.logger.log(`[VideoGen ${videoGenId}] DONE - ${cloudinaryVideoUrl}`);
    } catch (err: any) {
      this.logger.error(`[VideoGen ${videoGenId}] FAILED: ${err.message}`);

      await this.videoGenerationRepo.update(videoGenId, {
        status:        'failed',
        errorMessage:  err.message,
        completedAt:   new Date(),
      });

      await this.projectRepo.update(projectId, {
        status:          'failed',
        videoStepStatus: 'failed',
      });
    }
  }

  private async pollAndSaveResultByteplus(
    videoGenId: number,
    taskId: string,
    userId: number,
    projectId: number,
  ) {
    try {
      await this.videoGenerationRepo.update(videoGenId, { status: 'processing' });
      const taskResult = await this.bytePlusService.pollUntilDone(taskId, 30000, 40);
      const videoUrl = taskResult.content?.video_url;

      if (!videoUrl) {
        throw new Error('BytePlus trả về succeeded nhưng không có video URL');
      }

      this.logger.log(`[BytePlus] Uploading video to Cloudinary...`);
      const cloudinaryVideoUrl = await this.uploadVideoToCloudinary(
        videoUrl,
        userId,
        projectId,
        videoGenId,
      );

      const videoAsset = await this.assetRepo.save(
        this.assetRepo.create({
          userId,
          projectId,
          assetType: 'video',
          assetRole: 'scene_video',
          sourceType: 'generated',
          originalUrl: videoUrl,
          storedUrl:   cloudinaryVideoUrl,
          storageProvider: 'cloudinary',
          durationSeconds: taskResult.duration ? Math.round(Number(taskResult.duration)) : null,
          metadata: {
            byteplus_task_id: taskResult.id,
            duration: taskResult.duration,
          },
        }),
      );

      await this.videoGenerationRepo.update(videoGenId, {
        status:         'succeeded',
        outputAssetId:  videoAsset.id,
        completedAt:    new Date(),
        resultPayload:  taskResult as any,
      });

      await this.projectRepo.update(projectId, {
        status:          'completed',
        videoStepStatus: 'succeeded',
      });

      this.logger.log(`[BytePlus VideoGen ${videoGenId}] DONE - ${cloudinaryVideoUrl}`);
    } catch (err: any) {
      this.logger.error(`[BytePlus VideoGen ${videoGenId}] FAILED: ${err.message}`);

      await this.videoGenerationRepo.update(videoGenId, {
        status:        'failed',
        errorMessage:  err.message,
        completedAt:   new Date(),
      });

      await this.projectRepo.update(projectId, {
        status:          'failed',
        videoStepStatus: 'failed',
      });
    }
  }

  async createMotionControlVideo(
    userId: number,
    dto: CreateMotionControlVideoDto,
    characterImageFile?: Express.Multer.File,
    referenceVideoFile?: Express.Multer.File,
  ) {
    const model = await this.aiModelsService.findOne(dto.modelId);
    if (!model) throw new BadRequestException('Model không tồn tại');

    const project = await this.projectRepo.save(
      this.projectRepo.create({
        userId,
        title: (dto.prompt || 'Motion Control').slice(0, 100),
        workflowMode: 'video_only',
        status: 'video_generating',
        promptStepStatus: 'skipped',
        imageStepStatus: 'skipped',
        videoStepStatus: 'processing',
        metadata: {},
      }),
    );

    const projectId = project.id;
    const sceneNumber = dto.sceneNumber ?? 1;
    const baseFolder = `ai-generation/users/${userId}/projects/${projectId}/scenes/scene-${sceneNumber}`;

    // ── Resolve character image (reuse asset có sẵn hoặc upload mới) ────────
    const characterAsset = await this.resolveImageAsset(
      userId,
      dto.characterImageAssetId,
      characterImageFile,
      `${baseFolder}/images`,
      'character',
      'image_begin',
    );
    if (!characterAsset) {
      throw new BadRequestException('Cần cung cấp characterImage hoặc characterImageAssetId');
    }
    if (!characterAsset.projectId) {
      characterAsset.projectId = projectId;
      await this.assetRepo.save(characterAsset);
    }

    // ── Resolve reference video (reuse asset có sẵn hoặc tạo placeholder để upload nền) ──
    let referenceVideoAsset: Asset;
    let needBackgroundUpload = false;

    if (dto.referenceVideoAssetId) {
      const existing = await this.assetRepo.findOne({ where: { id: dto.referenceVideoAssetId } });
      if (!existing) {
        throw new BadRequestException(`Không tìm thấy reference video đã chọn (id=${dto.referenceVideoAssetId})`);
      }
      if (Number(existing.userId) !== Number(userId)) {
        throw new BadRequestException('Không có quyền dùng video này');
      }
      referenceVideoAsset = existing;
      if (!referenceVideoAsset.projectId) {
        referenceVideoAsset.projectId = projectId;
        await this.assetRepo.save(referenceVideoAsset);
      }
    } else if (referenceVideoFile) {
      referenceVideoAsset = await this.assetRepo.save(
        this.assetRepo.create({
          userId,
          projectId,
          assetType: 'video',
          assetRole: 'scene_video',
          sourceType: 'uploaded',
          originalUrl: '',
          storedUrl: '',
          storageProvider: 'cloudinary',
          mimeType: referenceVideoFile.mimetype,
          fileSizeBytes: referenceVideoFile.size,
          metadata: {},
        }),
      );
      needBackgroundUpload = true;
    } else {
      throw new BadRequestException('Cần cung cấp referenceVideo hoặc referenceVideoAssetId');
    }

    // ── Dùng motionGenerationRepo thay vì videoGenerationRepo ──
    const motionGen = await this.motionGenerationRepo.save(
      this.motionGenerationRepo.create({
        projectId,
        modelId:                dto.modelId,
        characterImageAssetId:  characterAsset.id,
        motionReferenceAssetId: referenceVideoAsset.id,
        motionPrompt:           dto.prompt || '',
        negativePrompt:         dto.negativePrompt,
        status:                 'queued',
        externalTaskId:         '',
        durationSeconds:        5,
        characterOrientation:   dto.characterOrientation,
        generationSound:        dto.keepOriginalSound === 'yes',
        generationMode:         dto.mode || 'pro',
        cost:                   dto.cost ?? 0,
        params: { mode: dto.mode, characterOrientation: dto.characterOrientation },
        requestPayload:  {},
        responsePayload: {},
        startedAt: new Date(),
      }),
    );

    this.runMotionControlInBackground({
      motionGen,
      referenceVideoFile: needBackgroundUpload ? referenceVideoFile : undefined,
      characterAsset,
      referenceVideoAsset,
      dto,
      userId,
      projectId,
      baseFolder,
      model,
    }).catch((err) =>
      this.logger.error(`[MotionControl] Background error: ${err.message}`),
    );

    return {
      message: 'Đang xử lý, vui lòng chờ...',
      videoGenerationId: motionGen.id,
      projectId,
      status: 'queued',
      characterImageUrl: characterAsset.storedUrl,
      referenceVideoUrl: referenceVideoAsset.storedUrl || null,
      promptSent: dto.prompt || '',
      modelName: model.name,
      generationMode: dto.mode || 'pro',
      cost: dto.cost ?? 0,
    };
  }

  private async pollMotionControlResult(
    motionGenId: number,
    taskId: string,
    userId: number,
    projectId: number,
    characterImageAssetId: number,
  ) {
    try {
      await this.motionGenerationRepo.update(motionGenId, { status: 'processing' });
      const taskResult = await this.klingService.pollMotionControlUntilDone(taskId, 30000, 40);
      const videoData = taskResult.task_result?.videos?.[0];

      if (!videoData) throw new Error('Kling trả về succeed nhưng không có video URL');

      this.logger.log(`[MotionControl] Uploading result video to Cloudinary...`);
      const cloudinaryVideoUrl = await this.uploadVideoToCloudinary(
        videoData.url, userId, projectId, motionGenId,
      );

      const videoAsset = await this.assetRepo.save(
        this.assetRepo.create({
          userId,
          projectId,
          assetType: 'video',
          assetRole: 'scene_video',
          sourceType: 'generated',
          originalUrl: videoData.url,
          storedUrl:   cloudinaryVideoUrl,
          storageProvider: 'cloudinary',
          durationSeconds: videoData.duration ? Math.round(parseFloat(videoData.duration)) : null,
          metadata: { kling_video_id: videoData.id, duration: videoData.duration },
        }),
      );

      await this.motionGenerationRepo.update(motionGenId, {
        status:        'succeeded',
        outputAssetId: videoAsset.id,
        thumbnailAssetId: characterImageAssetId,
        completedAt:   new Date(),
        resultPayload: taskResult as any,
      });

      await this.projectRepo.update(projectId, {
        status: 'completed',
        videoStepStatus: 'succeeded',
      });

      this.logger.log(`[MotionControl ${motionGenId}] DONE - ${cloudinaryVideoUrl}`);
    } catch (err: any) {
      this.logger.error(`[MotionControl ${motionGenId}] FAILED: ${err.message}`);
      await this.motionGenerationRepo.update(motionGenId, {
        status:       'failed',
        errorMessage: err.message,
        completedAt:  new Date(),
      });
      await this.projectRepo.update(projectId, { status: 'failed', videoStepStatus: 'failed' });
    }
  }

  async getMotionControlHistory(userId: number) {
    const list = await this.motionGenerationRepo
      .createQueryBuilder('mg')
      .leftJoinAndSelect('mg.outputAsset', 'outputAsset')
      .leftJoinAndSelect('mg.characterImageAsset', 'characterImageAsset')
      .leftJoinAndSelect('mg.motionReferenceAsset', 'motionReferenceAsset')
      .leftJoinAndSelect('mg.model', 'model')
      .leftJoinAndSelect('model.provider', 'provider')
      .innerJoin('projects', 'p', 'p.id = mg.project_id AND p.user_id = :userId', { userId })
      .orderBy('mg.created_at', 'DESC')
      .limit(50)
      .getMany();

    return list.map((mg) => ({
      id:                  mg.id,
      status:              mg.status,
      promptSent:          mg.motionPrompt,
      videoUrl:            mg.outputAsset?.storedUrl ?? null,
      thumbnailUrl:        mg.characterImageAsset?.storedUrl ?? null,
      characterImageUrl:   mg.characterImageAsset?.storedUrl ?? null,
      referenceVideoUrl:   mg.motionReferenceAsset?.storedUrl ?? null,
      modelName:           mg.model?.name ?? 'Unknown',
      providerName:        mg.model?.provider?.name ?? 'Unknown',
      characterOrientation: mg.characterOrientation,
      durationSeconds:     mg.durationSeconds,
      generationMode:      mg.generationMode,
      cost:                mg.cost ?? 0,
      createdAt:           mg.createdAt,
    }));
  }

  private async uploadVideoToCloudinary(
    videoUrl: string,
    userId: number,
    projectId: number,
    videoGenId: number,
  ): Promise<string> {
    const folder   = `ai-generation/users/${userId}/projects/${projectId}/scenes/scene-1/videos`;
    const publicId = `video_${videoGenId}_${Date.now()}`;
    return this.cloudinaryService.uploadVideoFromUrl(videoUrl, folder, publicId);
  }

  async getVideoStatus(videoGenId: number) {
    const videoGen = await this.videoGenerationRepo.findOne({
      where: { id: videoGenId },
      relations: ['outputAsset', 'imageBeginAsset', 'imageEndAsset'],
    });

    if (!videoGen) throw new BadRequestException('Không tìm thấy video generation');

    return {
      id:            videoGen.id,
      status:        videoGen.status,
      taskId:        videoGen.externalTaskId,
      promptSent:    videoGen.motionPrompt,
      beginImageUrl: videoGen.imageBeginAsset?.storedUrl ?? null,
      endImageUrl:   videoGen.imageEndAsset?.storedUrl ?? null,
      videoUrl:      videoGen.outputAsset?.storedUrl ?? null,
      duration:      videoGen.durationSeconds,
      errorMessage:  videoGen.errorMessage ?? null,
      createdAt:     videoGen.createdAt,
      completedAt:   videoGen.completedAt ?? null,
    };
  }

  async getTaskStatus(taskId: string) {
    return this.klingService.getTaskStatus(taskId);
  }

  async getHistory(userId: number) {
    const list = await this.videoGenerationRepo
      .createQueryBuilder('vg')
      .leftJoinAndSelect('vg.outputAsset', 'outputAsset')
      .leftJoinAndSelect('vg.imageBeginAsset', 'imageBeginAsset')
      .leftJoinAndSelect('vg.imageEndAsset', 'imageEndAsset')
      .leftJoinAndSelect('vg.model', 'model')
      .leftJoinAndSelect('model.provider', 'provider')
      .innerJoin('projects', 'p', 'p.id = vg.project_id AND p.user_id = :userId', { userId })
      .orderBy('vg.created_at', 'DESC')
      .limit(50)
      .getMany();

    return list.map((vg) => ({
      id:           vg.id,
      status:       vg.status,
      promptSent:   vg.motionPrompt,
      videoUrl:     vg.outputAsset?.storedUrl ?? null,
      thumbnailUrl: vg.imageBeginAsset?.storedUrl ?? null,
      beginImageUrl: vg.imageBeginAsset?.storedUrl ?? null,
      endImageUrl:  vg.imageEndAsset?.storedUrl ?? null,
      modelName:    vg.model?.name ?? 'Unknown',
      providerName:   vg.model?.provider?.name ?? 'Unknown',
      durationSeconds: vg.durationSeconds,
      createdAt:    vg.createdAt,
    }));
  }

  async getHistoryVideoGen(userId: number) {
    const list = await this.videoGenerationRepo
      .createQueryBuilder('vg')
      .leftJoinAndSelect('vg.outputAsset', 'outputAsset')
      .leftJoinAndSelect('vg.imageBeginAsset', 'imageBeginAsset')
      .leftJoinAndSelect('vg.imageEndAsset', 'imageEndAsset')
      .leftJoinAndSelect('vg.model', 'model')
      .leftJoinAndSelect('model.provider', 'provider')
      .innerJoin('projects', 'p', 'p.id = vg.project_id AND p.user_id = :userId', { userId })
      .orderBy('vg.created_at', 'DESC')
      .limit(50)
      .getMany();

    return list.map((vg) => ({
      id:           vg.id,
      status:       vg.status,
      promptSent:   vg.motionPrompt,
      videoUrl:     vg.outputAsset?.storedUrl ?? null,
      thumbnailUrl: vg.imageBeginAsset?.storedUrl ?? null,
      beginImageUrl: vg.imageBeginAsset?.storedUrl ?? null,
      endImageUrl:  vg.imageEndAsset?.storedUrl ?? null,
      modelName:    vg.model?.name ?? 'Unknown',
      providerName:   vg.model?.provider?.name ?? 'Unknown',
      durationSeconds: vg.durationSeconds,
      generationMode: vg.generationMode,
      cost:         vg.cost ?? 0,
      createdAt:    vg.createdAt,
    }));
  }

  private async runMotionControlInBackground({
    motionGen,
    referenceVideoFile,
    characterAsset,
    referenceVideoAsset,
    dto,
    userId,
    projectId,
    baseFolder,
    model,
  }: any) {
    try {
      let videoUrlForKling = referenceVideoAsset.storedUrl;

      if (referenceVideoFile) {
        this.logger.log('[MotionControl] [BG] Uploading reference video...');
        const videoUpload = await this.cloudinaryService.uploadVideoBuffer(
          referenceVideoFile.buffer,
          `${baseFolder}/videos/reference`,
          `ref_${Date.now()}`,
        );

        await this.assetRepo.update(referenceVideoAsset.id, {
          originalUrl: videoUpload.secure_url,
          storedUrl:   videoUpload.secure_url,
          metadata: { cloudinary_public_id: videoUpload.public_id },
        });

        videoUrlForKling = videoUpload.secure_url;
      }

      const klingModelName = model.code;
      this.logger.log(`[MotionControl] [BG] Calling Kling: ${klingModelName}`);

      const klingCreate = await this.klingService.createMotionControl({
        modelName:            klingModelName,
        imageUrl:             characterAsset.storedUrl,
        videoUrl:             videoUrlForKling,
        prompt:               dto.prompt || '',
        keepOriginalSound:    dto.keepOriginalSound ?? 'yes',
        characterOrientation: dto.characterOrientation,
        mode:                 dto.mode || 'pro',
      });

      if (klingCreate.code !== 0) {
        await this.motionGenerationRepo.update(motionGen.id, {
          status:       'failed',
          errorMessage: klingCreate.message,
          completedAt:  new Date(),
        });
        await this.projectRepo.update(projectId, {
          status:          'failed',
          videoStepStatus: 'failed',
        });
        return;
      }

      const taskId = klingCreate.data.task_id;

      await this.motionGenerationRepo.update(motionGen.id, {
        externalTaskId:  taskId,
        status:          'processing',
        requestPayload:  klingCreate as any,
        responsePayload: klingCreate as any,
      });

      await this.pollMotionControlResult(motionGen.id, taskId, userId, projectId, characterAsset.id);
    } catch (err: any) {
      this.logger.error(`[MotionControl BG ${motionGen.id}] FAILED: ${err.message}`);
      await this.motionGenerationRepo.update(motionGen.id, {
        status:       'failed',
        errorMessage: err.message,
        completedAt:  new Date(),
      });
      await this.projectRepo.update(projectId, {
        status:          'failed',
        videoStepStatus: 'failed',
      });
    }
  }
}