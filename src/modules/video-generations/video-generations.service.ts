// import {
//   Injectable,
//   BadRequestException,
//   Logger,
// } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import { VideoGeneration } from './entities/video-generation.entity';
// import { Asset } from '../assets/entities/asset.entity';
// import { AiModelsService } from '../ai-models/ai-models.service';
// import { CloudinaryService } from '../../common/cloudinary/cloudinary.service';
// import { KlingService } from '../../common/kling/kling.service';
// import { CreateVideoDto } from './dto/create-video.dto';
// import { Project } from '../projects/entities/project.entity'

// const RESOLUTION_PROMPT_MAP: Record<string, string> = {
//   '720p': '720p resolution video',
//   '1080p': '1080p Full HD resolution video',
//   '2k': '2K resolution video',
//   '4k': '4K Ultra HD resolution video',
// };

// // const KLING_MODEL_CODE_MAP: Record<string, string> = {
// //   'kling-v2.6': 'kling-v2-6',
// //   'kling-v3': 'kling-v3',
// // };

// @Injectable()
// export class VideoGenerationsService {
//   private readonly logger = new Logger(VideoGenerationsService.name);

//   constructor(
//     @InjectRepository(VideoGeneration)
//     private videoGenerationRepo: Repository<VideoGeneration>,

//     @InjectRepository(Asset)
//     private assetRepo: Repository<Asset>,

//     private aiModelsService: AiModelsService,
//     private cloudinaryService: CloudinaryService,
//     private klingService: KlingService,
//   ) {}

//   async createVideo(
//     userId: number,
//     dto: CreateVideoDto,
//     startImageFile: Express.Multer.File,
//     endImageFile?: Express.Multer.File,
//   ) {
//     // 1. Validate model
//     const model = await this.aiModelsService.findOne(dto.modelId);
//     if (!model) throw new BadRequestException('Model không tồn tại');
//     if (model.modelType !== 'video_generation') {
//       throw new BadRequestException('Model không phải video generation');
//     }

//     // 2. Upload ảnh lên Cloudinary
//     // const baseFolder = `ai-generation/users/${userId}/projects/${dto.projectId}/scenes/scene-0/images`;

//     const sceneNumber = dto.sceneNumber ?? 1
//     const baseFolder = `ai-generation/users/${userId}/projects/${dto.projectId}/scenes/scene-${sceneNumber}/images`

//     this.logger.log('Uploading start image...');
//     const startUpload = await this.cloudinaryService.uploadBuffer(
//       startImageFile.buffer,
//       `${baseFolder}/begin`,
//       `begin_${Date.now()}`,
//     );

//     const beginAsset = await this.assetRepo.save(
//       this.assetRepo.create({
//         userId,
//         projectId: dto.projectId,
//         assetType: 'image',
//         assetRole: 'image_begin',
//         sourceType: 'uploaded',
//         originalUrl: startUpload.secure_url,
//         storedUrl: startUpload.secure_url,
//         storageProvider: 'cloudinary',
//         mimeType: startImageFile.mimetype,
//         fileSizeBytes: startImageFile.size,
//         metadata: {
//           cloudinary_public_id: startUpload.public_id,
//           width: startUpload.width,
//           height: startUpload.height,
//         },
//       }),
//     );

//     let endAsset: Asset | null = null;
//     if (endImageFile) {
//       this.logger.log('Uploading end image...');
//       const endUpload = await this.cloudinaryService.uploadBuffer(
//         endImageFile.buffer,
//         `${baseFolder}/end`,
//         `end_${Date.now()}`,
//       );

//       endAsset = await this.assetRepo.save(
//         this.assetRepo.create({
//           userId,
//           projectId: dto.projectId,
//           assetType: 'image',
//           assetRole: 'image_end',
//           sourceType: 'uploaded',
//           originalUrl: endUpload.secure_url,
//           storedUrl: endUpload.secure_url,
//           storageProvider: 'cloudinary',
//           mimeType: endImageFile.mimetype,
//           fileSizeBytes: endImageFile.size,
//           metadata: {
//             cloudinary_public_id: endUpload.public_id,
//             width: endUpload.width,
//             height: endUpload.height,
//           },
//         }),
//       );
//     }

//     // 3. Ghép resolution vào prompt
//     const resolutionText = RESOLUTION_PROMPT_MAP[dto.resolution] || '';
//     const finalPrompt = resolutionText
//       ? `${resolutionText}, ${dto.prompt}`
//       : dto.prompt;

//     // const klingModelName = KLING_MODEL_CODE_MAP[model.code] || model.code;
//     const klingModelName = model.code;

//     // 4. Gọi Kling tạo task
//     this.logger.log(`Calling Kling API...`);
//     const klingCreate = await this.klingService.createImageToVideo({
//       modelName: klingModelName,
//       imageUrl: beginAsset.storedUrl,
//       imageTailUrl: endAsset?.storedUrl,
//       prompt: finalPrompt,
//       sound: dto.sound || 'off',
//       negativePrompt: dto.negativePrompt,
//       duration: dto.duration || '5',
//       mode: dto.mode || 'std',
//     });

//     if (klingCreate.code !== 0) {
//       throw new BadRequestException(`Kling error: ${klingCreate.message}`);
//     }

//     const taskId = klingCreate.data.task_id;

//     // 5. Lưu video_generation với status = queued
//     const videoGen = await this.videoGenerationRepo.save(
//       this.videoGenerationRepo.create({
//         projectId: dto.projectId,
//         modelId: dto.modelId,
//         imageBeginAssetId: beginAsset.id,
//         imageEndAssetId: endAsset?.id ?? undefined,
//         motionPrompt: finalPrompt,
//         negativePrompt: dto.negativePrompt,
//         status: 'queued',
//         externalTaskId: taskId,
//         durationSeconds: Number(dto.duration || 5),
//         params: { resolution: dto.resolution, mode: dto.mode },
//         requestPayload: {
//           modelName: klingModelName,
//           prompt: finalPrompt,
//           duration: dto.duration,
//           mode: dto.mode,
//         },
//         responsePayload: klingCreate as any,
//         startedAt: new Date(),
//       }),
//     );

//     // 6. Polling ngầm (không block response)
//     //    Chạy background, FE sẽ dùng endpoint riêng để check status
//     this.pollAndSaveResult(videoGen.id, taskId, userId, dto.projectId).catch(
//       (err) => this.logger.error(`Polling error: ${err.message}`),
//     );

//     return {
//       message: 'Đang tạo video, vui lòng chờ...',
//       videoGenerationId: videoGen.id,
//       taskId,
//       status: 'queued',
//       beginImageUrl: beginAsset.storedUrl,
//       endImageUrl: endAsset?.storedUrl ?? null,
//       promptSent: finalPrompt,
//     };
//   }

//   /**
//    * Polling chạy background:
//    * - Poll Kling cho đến khi succeed/failed
//    * - Khi succeed: lưu video asset vào assets, cập nhật video_generation
//    */
//   private async pollAndSaveResult(
//     videoGenId: number,
//     taskId: string,
//     userId: number,
//     projectId: number,
//   ) {
//     try {
//       // Update status = processing
//       await this.videoGenerationRepo.update(videoGenId, {
//         status: 'processing',
//       });

//       // Poll Kling (5s/lần, tối đa 60 lần = 5 phút)
//       const taskResult = await this.klingService.pollUntilDone(taskId);

//       const videoData = taskResult.task_result?.videos?.[0];

//       if (!videoData) {
//         throw new Error('Kling trả về succeed nhưng không có video URL');
//       }

//       // Lưu video asset
//       const videoAsset = await this.assetRepo.save(
//         this.assetRepo.create({
//           userId,
//           projectId,
//           assetType: 'video',
//           assetRole: 'scene_video',
//           sourceType: 'generated',
//           originalUrl: videoData.url,
//           storedUrl: videoData.url, // giữ URL Kling trả về
//           storageProvider: 'external',
//           metadata: {
//             kling_video_id: videoData.id,
//             duration: videoData.duration,
//           },
//         }),
//       );

//       // Cập nhật video_generation = succeeded
//       await this.videoGenerationRepo.update(videoGenId, {
//         status: 'succeeded',
//         outputAssetId: videoAsset.id,
//         completedAt: new Date(),
//         resultPayload: taskResult as any,
//       });

//       this.logger.log(
//         `[VideoGen ${videoGenId}] DONE - videoUrl: ${videoData.url}`,
//       );
//     } catch (err: any) {
//       this.logger.error(`[VideoGen ${videoGenId}] FAILED: ${err.message}`);

//       await this.videoGenerationRepo.update(videoGenId, {
//         status: 'failed',
//         errorMessage: err.message,
//         completedAt: new Date(),
//       });
//     }
//   }

//   // FE gọi để check status
//   async getVideoStatus(videoGenId: number) {
//     const videoGen = await this.videoGenerationRepo.findOne({
//       where: { id: videoGenId },
//       relations: ['outputAsset', 'imageBeginAsset', 'imageEndAsset'],
//     });

//     if (!videoGen) throw new BadRequestException('Không tìm thấy video generation');

//     return {
//       id: videoGen.id,
//       status: videoGen.status,
//       taskId: videoGen.externalTaskId,
//       promptSent: videoGen.motionPrompt,
//       beginImageUrl: videoGen.imageBeginAsset?.storedUrl ?? null,
//       endImageUrl: videoGen.imageEndAsset?.storedUrl ?? null,
//       // Chỉ có khi succeeded
//       videoUrl: videoGen.outputAsset?.storedUrl ?? null,
//       duration: videoGen.durationSeconds,
//       errorMessage: videoGen.errorMessage ?? null,
//       createdAt: videoGen.createdAt,
//       completedAt: videoGen.completedAt ?? null,
//     };
//   }

//   async getTaskStatus(taskId: string) {
//     return this.klingService.getTaskStatus(taskId);
//   }
// }
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
import { CreateVideoDto } from './dto/create-video.dto';

const RESOLUTION_PROMPT_MAP: Record<string, string> = {
  '720p': '720p resolution video',
  '1080p': '1080p Full HD resolution video',
  '2k': '2K resolution video',
  '4k': '4K Ultra HD resolution video',
};

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
    const resolutionText = RESOLUTION_PROMPT_MAP[dto.resolution] || '';
    const finalPrompt = resolutionText
      ? `${resolutionText}, ${dto.prompt}`
      : dto.prompt;

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

  // private async pollAndSaveResult(
  //   videoGenId: number,
  //   taskId: string,
  //   userId: number,
  //   projectId: number,
  // ) {
  //   try {
  //     await this.videoGenerationRepo.update(videoGenId, {
  //       status: 'processing',
  //     });

  //     // Poll Kling (5s/lần, tối đa 60 lần = 5 phút)
  //     const taskResult = await this.klingService.pollUntilDone(taskId);

  //     const videoData = taskResult.task_result?.videos?.[0];
  //     if (!videoData) {
  //       throw new Error('Kling trả về succeed nhưng không có video URL');
  //     }

  //     // Lưu video asset
  //     const videoAsset = await this.assetRepo.save(
  //       this.assetRepo.create({
  //         userId,
  //         projectId,
  //         assetType: 'video',
  //         assetRole: 'scene_video',
  //         sourceType: 'generated',
  //         originalUrl: videoData.url,
  //         storedUrl: videoData.url,
  //         storageProvider: 'external',
  //         metadata: {
  //           kling_video_id: videoData.id,
  //           duration: videoData.duration,
  //         },
  //       }),
  //     );

  //     // Cập nhật video_generation = succeeded
  //     await this.videoGenerationRepo.update(videoGenId, {
  //       status: 'succeeded',
  //       outputAssetId: videoAsset.id,
  //       completedAt: new Date(),
  //       resultPayload: taskResult as any,
  //     });

  //     // Cập nhật project = completed
  //     await this.projectRepo.update(projectId, {
  //       status: 'completed',
  //       videoStepStatus: 'succeeded',
  //     });

  //     this.logger.log(`[VideoGen ${videoGenId}] DONE - videoUrl: ${videoData.url}`);
  //   } catch (err: any) {
  //     this.logger.error(`[VideoGen ${videoGenId}] FAILED: ${err.message}`);

  //     await this.videoGenerationRepo.update(videoGenId, {
  //       status: 'failed',
  //       errorMessage: err.message,
  //       completedAt: new Date(),
  //     });

  //     await this.projectRepo.update(projectId, {
  //       status: 'failed',
  //       videoStepStatus: 'failed',
  //     });
  //   }
  // }
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
}