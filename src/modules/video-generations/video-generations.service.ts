import {
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VideoGeneration } from './entities/video-generation.entity';
import { Asset } from '../assets/entities/asset.entity';
import { Project } from '../projects/entities/project.entity';
import { AiModelsService } from '../ai-models/ai-models.service';
import { CloudinaryService } from '../../common/cloudinary/cloudinary.service';
import { KlingService } from '../../common/kling/kling.service';
import { CreateMotionControlVideoDto, CreateVideoDto } from './dto/create-video.dto';
@Injectable()
export class VideoGenerationsService {
  private readonly logger = new Logger(VideoGenerationsService.name);

  constructor(
    @InjectRepository(VideoGeneration)
    private videoGenerationRepo: Repository<VideoGeneration>,

    @InjectRepository(Asset)
    private assetRepo: Repository<Asset>,

    @InjectRepository(Project)
    private projectRepo: Repository<Project>,

    private aiModelsService: AiModelsService,
    private cloudinaryService: CloudinaryService,
    private klingService: KlingService,
  ) {}

  async createVideo(
    userId: number,
    dto: CreateVideoDto,
    startImageFile: Express.Multer.File,
    endImageFile?: Express.Multer.File,
  ) {
    // 1. Validate model
    const model = await this.aiModelsService.findOne(dto.modelId);
    if (!model) throw new BadRequestException('Model không tồn tại');
    if (model.modelType !== 'video_generation') {
      throw new BadRequestException('Model không phải video generation');
    }

    // 2. Tự tạo project mới
    const project = await this.projectRepo.save(
      this.projectRepo.create({
        userId,
        title: dto.prompt.slice(0, 100),
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

    // 3. Upload start image lên Cloudinary
    this.logger.log('Uploading start image...');
    const startUpload = await this.cloudinaryService.uploadBuffer(
      startImageFile.buffer,
      `${baseFolder}/begin`,
      `begin_${Date.now()}`,
    );

    const beginAsset = await this.assetRepo.save(
      this.assetRepo.create({
        userId,
        projectId,
        assetType: 'image',
        assetRole: 'image_begin',
        sourceType: 'uploaded',
        originalUrl: startUpload.secure_url,
        storedUrl: startUpload.secure_url,
        storageProvider: 'cloudinary',
        mimeType: startImageFile.mimetype,
        fileSizeBytes: startImageFile.size,
        metadata: {
          cloudinary_public_id: startUpload.public_id,
          width: startUpload.width,
          height: startUpload.height,
        },
      }),
    );

    // 4. Upload end image nếu có
    let endAsset: Asset | null = null;
    if (endImageFile) {
      this.logger.log('Uploading end image...');
      const endUpload = await this.cloudinaryService.uploadBuffer(
        endImageFile.buffer,
        `${baseFolder}/end`,
        `end_${Date.now()}`,
      );

      endAsset = await this.assetRepo.save(
        this.assetRepo.create({
          userId,
          projectId,
          assetType: 'image',
          assetRole: 'image_end',
          sourceType: 'uploaded',
          originalUrl: endUpload.secure_url,
          storedUrl: endUpload.secure_url,
          storageProvider: 'cloudinary',
          mimeType: endImageFile.mimetype,
          fileSizeBytes: endImageFile.size,
          metadata: {
            cloudinary_public_id: endUpload.public_id,
            width: endUpload.width,
            height: endUpload.height,
          },
        }),
      );
    }

    // 5. Ghép resolution vào prompt
    const finalPrompt = dto.prompt;

    const klingModelName = model.code;

    // 6. Gọi Kling tạo task
    this.logger.log(`Calling Kling API with model: ${klingModelName}`);
    const klingCreate = await this.klingService.createImageToVideo({
      modelName: klingModelName,
      imageUrl: beginAsset.storedUrl,
      imageTailUrl: endAsset?.storedUrl,
      prompt: finalPrompt,
      sound: dto.sound || 'off',
      negativePrompt: dto.negativePrompt,
      duration: dto.duration || '5',
      mode: dto.mode || 'pro',
    });

    if (klingCreate.code !== 0) {
      // Cập nhật project = failed nếu Kling lỗi
      await this.projectRepo.update(projectId, {
        status: 'failed',
        videoStepStatus: 'failed',
      });
      throw new BadRequestException(`Kling error: ${klingCreate.message}`);
    }

    const taskId = klingCreate.data.task_id;

    // 7. Lưu video_generation với status = queued
    const videoGen = await this.videoGenerationRepo.save(
      this.videoGenerationRepo.create({
        projectId,
        modelId: dto.modelId,
        imageBeginAssetId: beginAsset.id,
        imageEndAssetId: endAsset?.id ?? undefined,
        motionPrompt: finalPrompt,
        negativePrompt: dto.negativePrompt,
        status: 'queued',
        externalTaskId: taskId,
        durationSeconds: Number(dto.duration || 5),
        params: { resolution: dto.resolution, mode: dto.mode },
        requestPayload: {
          modelName: klingModelName,
          prompt: finalPrompt,
          duration: dto.duration,
          mode: dto.mode,
          sound: dto.sound,
        },
        responsePayload: klingCreate as any,
        startedAt: new Date(),
      }),
    );

    // 8. Polling ngầm - không block response
    this.pollAndSaveResult(videoGen.id, taskId, userId, projectId).catch(
      (err) => this.logger.error(`Polling error: ${err.message}`),
    );

    return {
      message: 'Đang tạo video, vui lòng chờ...',
      videoGenerationId: videoGen.id,
      projectId,
      taskId,
      status: 'queued',
      beginImageUrl: beginAsset.storedUrl,
      endImageUrl: endAsset?.storedUrl ?? null,
      promptSent: finalPrompt,
      modelName: model.name,
    };
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
      // const taskResult = await this.klingService.pollUntilDone(taskId);
      const videoData = taskResult.task_result?.videos?.[0];

      if (!videoData) {
        throw new Error('Kling trả về succeed nhưng không có video URL');
      }

      // Download video từ Kling → upload lên Cloudinary
      this.logger.log(`Uploading video to Cloudinary...`);
      const cloudinaryVideoUrl = await this.uploadVideoToCloudinary(
        videoData.url,
        userId,
        projectId,
        videoGenId,
      );

      // Lưu video asset với URL Cloudinary
      const videoAsset = await this.assetRepo.save(
        this.assetRepo.create({
          userId,
          projectId,
          assetType: 'video',
          assetRole: 'scene_video',
          sourceType: 'generated',
          originalUrl: videoData.url,        // URL gốc Kling
          storedUrl: cloudinaryVideoUrl,     // URL Cloudinary
          storageProvider: 'cloudinary',
          metadata: {
            kling_video_id: videoData.id,
            duration: videoData.duration,
          },
        }),
      );

      await this.videoGenerationRepo.update(videoGenId, {
        status: 'succeeded',
        outputAssetId: videoAsset.id,
        completedAt: new Date(),
        resultPayload: taskResult as any,
      });

      await this.projectRepo.update(projectId, {
        status: 'completed',
        videoStepStatus: 'succeeded',
      });

      this.logger.log(`[VideoGen ${videoGenId}] DONE - cloudinaryUrl: ${cloudinaryVideoUrl}`);
    } catch (err: any) {
      this.logger.error(`[VideoGen ${videoGenId}] FAILED: ${err.message}`);

      await this.videoGenerationRepo.update(videoGenId, {
        status: 'failed',
        errorMessage: err.message,
        completedAt: new Date(),
      });

      await this.projectRepo.update(projectId, {
        status: 'failed',
        videoStepStatus: 'failed',
      });
    }
  }
  // async createMotionControlVideo(
  //   userId: number,
  //   dto: CreateMotionControlVideoDto,
  //   characterImageFile: Express.Multer.File,
  //   referenceVideoFile: Express.Multer.File,
  // ) {
  //   // 1. Validate model – chỉ chấp nhận kling models
  //   const model = await this.aiModelsService.findOne(dto.modelId);
  //   if (!model) throw new BadRequestException('Model không tồn tại');
  //   if (model.modelType !== 'video_generation') {
  //     throw new BadRequestException('Model không hỗ trợ video generation');
  //   }

  //   // 2. Tạo project
  //   const project = await this.projectRepo.save(
  //     this.projectRepo.create({
  //       userId,
  //       title: (dto.prompt || 'Motion Control').slice(0, 100),
  //       workflowMode: 'video_only',
  //       status: 'video_generating',
  //       promptStepStatus: 'skipped',
  //       imageStepStatus: 'skipped',
  //       videoStepStatus: 'processing',
  //       metadata: {},
  //     }),
  //   );

  //   const projectId = project.id;
  //   const sceneNumber = dto.sceneNumber ?? 1;
  //   const baseFolder = `ai-generation/users/${userId}/projects/${projectId}/scenes/scene-${sceneNumber}`;

  //   // 3. Upload character image
  //   this.logger.log('[MotionControl] Uploading character image...');
  //   const imageUpload = await this.cloudinaryService.uploadBuffer(
  //     characterImageFile.buffer,
  //     `${baseFolder}/images/character`,
  //     `character_${Date.now()}`,
  //   );

  //   const characterAsset = await this.assetRepo.save(
  //     this.assetRepo.create({
  //       userId,
  //       projectId,
  //       assetType: 'image',
  //       assetRole: 'image_begin',
  //       sourceType: 'uploaded',
  //       originalUrl: imageUpload.secure_url,
  //       storedUrl: imageUpload.secure_url,
  //       storageProvider: 'cloudinary',
  //       mimeType: characterImageFile.mimetype,
  //       fileSizeBytes: characterImageFile.size,
  //       metadata: {
  //         cloudinary_public_id: imageUpload.public_id,
  //         width: imageUpload.width,
  //         height: imageUpload.height,
  //       },
  //     }),
  //   );

  //   // 4. Upload reference video lên Cloudinary để lấy public URL
  //   this.logger.log('[MotionControl] Uploading reference video...');
  //   const videoUpload = await this.cloudinaryService.uploadVideoBuffer(
  //     referenceVideoFile.buffer,
  //     `${baseFolder}/videos/reference`,
  //     `ref_${Date.now()}`,
  //   );

  //   const referenceVideoAsset = await this.assetRepo.save(
  //     this.assetRepo.create({
  //       userId,
  //       projectId,
  //       assetType: 'video',
  //       assetRole: 'scene_video',
  //       sourceType: 'uploaded',
  //       originalUrl: videoUpload.secure_url,
  //       storedUrl: videoUpload.secure_url,
  //       storageProvider: 'cloudinary',
  //       mimeType: referenceVideoFile.mimetype,
  //       fileSizeBytes: referenceVideoFile.size,
  //       metadata: { cloudinary_public_id: videoUpload.public_id },
  //     }),
  //   );

  //   // 5. Gọi Kling Motion Control API
  //   const klingModelName = model.code; // 'kling-v2-6' hoặc 'kling-v3'
  //   this.logger.log(`[MotionControl] Calling Kling API with model: ${klingModelName}`);

  //   const klingCreate = await this.klingService.createMotionControl({
  //     modelName: klingModelName,
  //     imageUrl: characterAsset.storedUrl,
  //     videoUrl: referenceVideoAsset.storedUrl,
  //     prompt: dto.prompt || '',
  //     // keepOriginalSound: dto.keepOriginalSound !== false ? 'yes' : 'no',
  //     // keepOriginalSound: dto.keepOriginalSound === 'yes',
  //     keepOriginalSound: dto.keepOriginalSound ?? 'yes',
  //     characterOrientation: dto.characterOrientation,
  //     mode: dto.mode || 'pro',
  //   });

  //   if (klingCreate.code !== 0) {
  //     await this.projectRepo.update(projectId, { status: 'failed', videoStepStatus: 'failed' });
  //     throw new BadRequestException(`Kling error: ${klingCreate.message}`);
  //   }

  //   const taskId = klingCreate.data.task_id;

  //   // 6. Lưu video_generation
  //   const videoGen = await this.videoGenerationRepo.save(
  //     this.videoGenerationRepo.create({
  //       projectId,
  //       modelId: dto.modelId,
  //       imageBeginAssetId: characterAsset.id,
  //       motionReferenceAssetId: referenceVideoAsset.id,
  //       motionPrompt: dto.prompt || '',
  //       negativePrompt: dto.negativePrompt,
  //       status: 'queued',
  //       externalTaskId: taskId,
  //       durationSeconds: 5,
  //       generationType: 'motion_control',
  //       characterOrientation: dto.characterOrientation,
  //       // keepOriginalSound: dto.keepOriginalSound !== false,
  //       // keepOriginalSound: dto.keepOriginalSound === 'yes',
  //       keepOriginalSound: dto.keepOriginalSound === 'yes',
  //       generationMode: dto.mode || 'pro',
  //       params: { mode: dto.mode, characterOrientation: dto.characterOrientation },
  //       requestPayload: klingCreate as any,
  //       responsePayload: klingCreate as any,
  //       startedAt: new Date(),
  //     }),
  //   );

  //   // 7. Poll ngầm
  //   this.pollMotionControlResult(videoGen.id, taskId, userId, projectId).catch(
  //     (err) => this.logger.error(`[MotionControl] Polling error: ${err.message}`),
  //   );

  //   return {
  //     message: 'Đang tạo video motion control, vui lòng chờ...',
  //     videoGenerationId: videoGen.id,
  //     projectId,
  //     taskId,
  //     status: 'queued',
  //     characterImageUrl: characterAsset.storedUrl,
  //     referenceVideoUrl: referenceVideoAsset.storedUrl,
  //     promptSent: dto.prompt || '',
  //     modelName: model.name,
  //   };
  // }
  async createMotionControlVideo(
  userId: number,
  dto: CreateMotionControlVideoDto,
  characterImageFile: Express.Multer.File,
  referenceVideoFile: Express.Multer.File,
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

  // ✅ Chỉ upload IMAGE (nhanh), không upload video ở đây
  this.logger.log('[MotionControl] Uploading character image...');
  const imageUpload = await this.cloudinaryService.uploadBuffer(
    characterImageFile.buffer,
    `${baseFolder}/images/character`,
    `character_${Date.now()}`,
  );

  const characterAsset = await this.assetRepo.save(
    this.assetRepo.create({
      userId,
      projectId,
      assetType: 'image',
      assetRole: 'image_begin',
      sourceType: 'uploaded',
      originalUrl: imageUpload.secure_url,
      storedUrl: imageUpload.secure_url,
      storageProvider: 'cloudinary',
      mimeType: characterImageFile.mimetype,
      fileSizeBytes: characterImageFile.size,
      metadata: {
        cloudinary_public_id: imageUpload.public_id,
        width: imageUpload.width,
        height: imageUpload.height,
      },
    }),
  );

  // ✅ Tạo placeholder asset cho video (chưa có URL)
  const referenceVideoAsset = await this.assetRepo.save(
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

  const videoGen = await this.videoGenerationRepo.save(
    this.videoGenerationRepo.create({
      projectId,
      modelId: dto.modelId,
      imageBeginAssetId: characterAsset.id,
      motionReferenceAssetId: referenceVideoAsset.id,
      motionPrompt: dto.prompt || '',
      negativePrompt: dto.negativePrompt,
      status: 'queued',
      externalTaskId: '',         // chưa có taskId
      durationSeconds: 5,
      generationType: 'motion_control',
      characterOrientation: dto.characterOrientation,
      keepOriginalSound: dto.keepOriginalSound === 'yes',
      generationMode: dto.mode || 'pro',
      params: { mode: dto.mode, characterOrientation: dto.characterOrientation },
      requestPayload: {},
      responsePayload: {},
      startedAt: new Date(),
    }),
  );

  // ✅ Toàn bộ upload video + gọi Kling chạy ngầm
  this.runMotionControlInBackground({
    videoGen,
    referenceVideoFile,
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

  // ✅ Trả về ngay, không chờ upload video
  return {
    message: 'Đang xử lý, vui lòng chờ...',
    videoGenerationId: videoGen.id,
    projectId,
    status: 'queued',
    characterImageUrl: characterAsset.storedUrl,
  };
}
  private async pollMotionControlResult(
    videoGenId: number,
    taskId: string,
    userId: number,
    projectId: number,
  ) {
    try {
      await this.videoGenerationRepo.update(videoGenId, { status: 'processing' });
      const taskResult = await this.klingService.pollMotionControlUntilDone(taskId, 30000, 40);
      const videoData = taskResult.task_result?.videos?.[0];

      if (!videoData) throw new Error('Kling trả về succeed nhưng không có video URL');

      this.logger.log(`[MotionControl] Uploading result video to Cloudinary...`);
      const cloudinaryVideoUrl = await this.uploadVideoToCloudinary(
        videoData.url, userId, projectId, videoGenId,
      );

      const videoAsset = await this.assetRepo.save(
        this.assetRepo.create({
          userId,
          projectId,
          assetType: 'video',
          assetRole: 'scene_video',
          sourceType: 'generated',
          originalUrl: videoData.url,
          storedUrl: cloudinaryVideoUrl,
          storageProvider: 'cloudinary',
          metadata: { kling_video_id: videoData.id, duration: videoData.duration },
        }),
      );

      await this.videoGenerationRepo.update(videoGenId, {
        status: 'succeeded',
        outputAssetId: videoAsset.id,
        completedAt: new Date(),
        resultPayload: taskResult as any,
      });

      await this.projectRepo.update(projectId, {
        status: 'completed',
        videoStepStatus: 'succeeded',
      });

      this.logger.log(`[MotionControl ${videoGenId}] DONE - ${cloudinaryVideoUrl}`);
    } catch (err: any) {
      this.logger.error(`[MotionControl ${videoGenId}] FAILED: ${err.message}`);
      await this.videoGenerationRepo.update(videoGenId, {
        status: 'failed',
        errorMessage: err.message,
        completedAt: new Date(),
      });
      await this.projectRepo.update(projectId, { status: 'failed', videoStepStatus: 'failed' });
    }
  }

  // Thêm filter vào getHistory (optional):
  async getMotionControlHistory(userId: number) {
    const list = await this.videoGenerationRepo
      .createQueryBuilder('vg')
      .leftJoinAndSelect('vg.outputAsset', 'outputAsset')
      .leftJoinAndSelect('vg.imageBeginAsset', 'imageBeginAsset')
      .leftJoinAndSelect('vg.motionReferenceAsset', 'motionReferenceAsset')
      .leftJoinAndSelect('vg.model', 'model')
      .innerJoin('projects', 'p', 'p.id = vg.project_id AND p.user_id = :userId', { userId })
      .where('vg.generation_type = :type', { type: 'motion_control' })
      .orderBy('vg.created_at', 'DESC')
      .limit(50)
      .getMany();

    return list.map((vg) => ({
      id: vg.id,
      status: vg.status,
      promptSent: vg.motionPrompt,
      videoUrl: vg.outputAsset?.storedUrl ?? null,
      thumbnailUrl: vg.imageBeginAsset?.storedUrl ?? null,
      characterImageUrl: vg.imageBeginAsset?.storedUrl ?? null,
      referenceVideoUrl: vg.motionReferenceAsset?.storedUrl ?? null,
      modelName: vg.model?.name ?? 'Kling',
      characterOrientation: vg.characterOrientation,
      durationSeconds: vg.durationSeconds,
      createdAt: vg.createdAt,
    }));
  }

  // Helper: download video từ URL → upload lên Cloudinary
  private async uploadVideoToCloudinary(
    videoUrl: string,
    userId: number,
    projectId: number,
    videoGenId: number,
  ): Promise<string> {
    const folder = `ai-generation/users/${userId}/projects/${projectId}/scenes/scene-1/videos`;
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
      id: videoGen.id,
      status: videoGen.status,
      taskId: videoGen.externalTaskId,
      promptSent: videoGen.motionPrompt,
      beginImageUrl: videoGen.imageBeginAsset?.storedUrl ?? null,
      endImageUrl: videoGen.imageEndAsset?.storedUrl ?? null,
      videoUrl: videoGen.outputAsset?.storedUrl ?? null,
      duration: videoGen.durationSeconds,
      errorMessage: videoGen.errorMessage ?? null,
      createdAt: videoGen.createdAt,
      completedAt: videoGen.completedAt ?? null,
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
      .innerJoin('projects', 'p', 'p.id = vg.project_id AND p.user_id = :userId', { userId })
      .orderBy('vg.created_at', 'DESC')
      .limit(50)
      .getMany()

    return list.map((vg) => ({
      id: vg.id,
      status: vg.status,
      promptSent: vg.motionPrompt,
      videoUrl: vg.outputAsset?.storedUrl ?? null,
      thumbnailUrl: vg.imageBeginAsset?.storedUrl ?? null,
      beginImageUrl: vg.imageBeginAsset?.storedUrl ?? null,
      endImageUrl: vg.imageEndAsset?.storedUrl ?? null,
      modelName: vg.model?.name ?? 'Kling',
      durationSeconds: vg.durationSeconds,
      createdAt: vg.createdAt,
    }))
  }
  private async runMotionControlInBackground({
    videoGen,
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
      // Upload video (chậm, nhưng giờ chạy ngầm)
      this.logger.log('[MotionControl] [BG] Uploading reference video...');
      const videoUpload = await this.cloudinaryService.uploadVideoBuffer(
        referenceVideoFile.buffer,
        `${baseFolder}/videos/reference`,
        `ref_${Date.now()}`,
      );

      // Cập nhật asset với URL thực
      await this.assetRepo.update(referenceVideoAsset.id, {
        originalUrl: videoUpload.secure_url,
        storedUrl: videoUpload.secure_url,
        metadata: { cloudinary_public_id: videoUpload.public_id },
      });

      // Gọi Kling
      const klingModelName = model.code;
      this.logger.log(`[MotionControl] [BG] Calling Kling: ${klingModelName}`);

      const klingCreate = await this.klingService.createMotionControl({
        modelName: klingModelName,
        imageUrl: characterAsset.storedUrl,
        videoUrl: videoUpload.secure_url,
        prompt: dto.prompt || '',
        keepOriginalSound: dto.keepOriginalSound ?? 'yes',
        characterOrientation: dto.characterOrientation,
        mode: dto.mode || 'pro',
      });

      if (klingCreate.code !== 0) {
        await this.videoGenerationRepo.update(videoGen.id, {
          status: 'failed',
          errorMessage: klingCreate.message,
          completedAt: new Date(),
        });
        await this.projectRepo.update(projectId, {
          status: 'failed',
          videoStepStatus: 'failed',
        });
        return;
      }

      const taskId = klingCreate.data.task_id;

      await this.videoGenerationRepo.update(videoGen.id, {
        externalTaskId: taskId,
        status: 'processing',
        requestPayload: klingCreate as any,
        responsePayload: klingCreate as any,
      });

      // Poll kết quả
      await this.pollMotionControlResult(videoGen.id, taskId, userId, projectId);
    } catch (err: any) {
      this.logger.error(`[MotionControl BG ${videoGen.id}] FAILED: ${err.message}`);
      await this.videoGenerationRepo.update(videoGen.id, {
        status: 'failed',
        errorMessage: err.message,
        completedAt: new Date(),
      });
      await this.projectRepo.update(projectId, {
        status: 'failed',
        videoStepStatus: 'failed',
      });
    }
  }
}