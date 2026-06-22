// import {
//   Injectable,
//   BadRequestException,
//   Logger,
// } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import { VideoGeneration } from './entities/video-generation.entity';
// import { Asset } from '../assets/entities/asset.entity';
// import { Project } from '../projects/entities/project.entity';
// import { AiModelsService } from '../ai-models/ai-models.service';
// import { CloudinaryService } from '../../common/cloudinary/cloudinary.service';
// import { KlingService } from '../../common/kling/kling.service';
// import { CreateMotionControlVideoDto, CreateVideoDto } from './dto/create-video.dto';

// @Injectable()
// export class VideoGenerationsService {
//   private readonly logger = new Logger(VideoGenerationsService.name);

//   constructor(
//     @InjectRepository(VideoGeneration)
//     private videoGenerationRepo: Repository<VideoGeneration>,

//     @InjectRepository(Asset)
//     private assetRepo: Repository<Asset>,

//     @InjectRepository(Project)
//     private projectRepo: Repository<Project>,

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

//     // 2. Validate multi-shot params
//     if (dto.multiShot) {
//       if (!dto.shotType) {
//         throw new BadRequestException('shotType là bắt buộc khi multiShot=true');
//       }
//       if (dto.shotType === 'customize') {
//         if (!dto.multiPrompt || dto.multiPrompt.length === 0) {
//           throw new BadRequestException('multiPrompt là bắt buộc khi shotType=customize');
//         }
//         const totalShotDuration = dto.multiPrompt.reduce(
//           (sum, s) => sum + Number(s.duration),
//           0,
//         );
//         const videoDuration = Number(dto.duration || 5);
//         if (totalShotDuration !== videoDuration) {
//           throw new BadRequestException(
//             `Tổng duration của shots (${totalShotDuration}s) phải bằng duration video (${videoDuration}s)`,
//           );
//         }
//       } else if (dto.shotType === 'intelligence') {
//         // intelligence mode: prompt bắt buộc
//         if (!dto.prompt?.trim()) {
//           throw new BadRequestException('prompt là bắt buộc khi shotType=intelligence');
//         }
//       }
//     } else {
//       // Normal mode: prompt bắt buộc
//       if (!dto.prompt?.trim()) {
//         throw new BadRequestException('prompt là bắt buộc');
//       }
//     }

//     // 3. Tạo project mới
//     // Lấy title hiển thị phù hợp
//     const titleSource =
//       dto.multiShot && dto.shotType === 'customize'
//         ? dto.multiPrompt![0].prompt          // Shot đầu tiên
//         : dto.prompt;

//     const project = await this.projectRepo.save(
//       this.projectRepo.create({
//         userId,
//         title: titleSource.slice(0, 100),
//         workflowMode: 'video_only',
//         status: 'video_generating',
//         promptStepStatus: 'skipped',
//         imageStepStatus: 'skipped',
//         videoStepStatus: 'processing',
//         metadata: {},
//       }),
//     );

//     const projectId = project.id;
//     const sceneNumber = dto.sceneNumber ?? 1;
//     const baseFolder = `ai-generation/users/${userId}/projects/${projectId}/scenes/scene-${sceneNumber}/images`;

//     // 4. Upload start image
//     this.logger.log('Uploading start image...');
//     const startUpload = await this.cloudinaryService.uploadBuffer(
//       startImageFile.buffer,
//       `${baseFolder}/begin`,
//       `begin_${Date.now()}`,
//     );

//     const beginAsset = await this.assetRepo.save(
//       this.assetRepo.create({
//         userId,
//         projectId,
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

//     // 5. Upload end image nếu có
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
//           projectId,
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

//     // 6. Gọi Kling tạo task
//     const klingModelName = model.code;
//     this.logger.log(
//       `[Kling] Creating task - model: ${klingModelName}, multiShot: ${dto.multiShot}, shotType: ${dto.shotType}`,
//     );

//     const klingCreate = await this.klingService.createImageToVideo({
//       modelName:     klingModelName,
//       imageUrl:      beginAsset.storedUrl,
//       imageTailUrl:  endAsset?.storedUrl,
//       prompt:        dto.prompt,
//       sound:         dto.sound || 'off',
//       negativePrompt: dto.negativePrompt,
//       duration:      dto.duration || '5',
//       mode:          dto.mode || 'pro',
//       // Multi-shot params
//       multiShot:     dto.multiShot,
//       shotType:      dto.shotType,
//       multiPrompt:   dto.multiPrompt,
//     });

//     if (klingCreate.code !== 0) {
//       await this.projectRepo.update(projectId, {
//         status: 'failed',
//         videoStepStatus: 'failed',
//       });
//       throw new BadRequestException(`Kling error: ${klingCreate.message}`);
//     }

//     const taskId = klingCreate.data.task_id;

//     // 7. Lưu video_generation
//     // motionPrompt: lưu dạng dễ đọc để hiển thị history
//     const storedPrompt = this.buildStoredPrompt(dto);

//     const videoGen = await this.videoGenerationRepo.save(
//       this.videoGenerationRepo.create({
//         projectId,
//         modelId: dto.modelId,
//         imageBeginAssetId: beginAsset.id,
//         imageEndAssetId:   endAsset?.id ?? undefined,
//         motionPrompt:      storedPrompt,
//         negativePrompt:    dto.negativePrompt,
//         status:            'queued',
//         externalTaskId:    taskId,
//         durationSeconds:   Number(dto.duration || 5),
//         generationMode:    dto.mode || 'pro',
//         cost:              dto.cost ?? 0,
//         params: {
//           resolution: dto.resolution,
//           mode: dto.mode,
//           multiShot: dto.multiShot ?? false,
//           shotType: dto.shotType,
//         },
//         requestPayload: {
//           modelName:    klingModelName,
//           prompt:       dto.prompt,
//           duration:     dto.duration,
//           mode:         dto.mode,
//           sound:        dto.sound,
//           multiShot:    dto.multiShot ?? false,
//           shotType:     dto.shotType,
//           multiPrompt:  dto.multiPrompt,
//         },
//         responsePayload: klingCreate as any,
//         startedAt: new Date(),
//       }),
//     );

//     // 8. Polling ngầm
//     this.pollAndSaveResult(videoGen.id, taskId, userId, projectId).catch(
//       (err) => this.logger.error(`Polling error: ${err.message}`),
//     );

//     return {
//       message: 'Đang tạo video, vui lòng chờ...',
//       videoGenerationId: videoGen.id,
//       projectId,
//       taskId,
//       status: 'queued',
//       beginImageUrl: beginAsset.storedUrl,
//       endImageUrl:   endAsset?.storedUrl ?? null,
//       promptSent:    storedPrompt,
//       modelName:     model.name,
//       generationMode: dto.mode || 'pro',
//       multiShot:     dto.multiShot ?? false,
//       shotType:      dto.shotType,
//       cost:          dto.cost ?? 0,
//     };
//   }

//   /**
//    * Tạo chuỗi prompt để lưu vào DB (dùng hiển thị history)
//    * - Normal: dùng prompt gốc
//    * - Intelligence: dùng prompt gốc (Kling tự phân cảnh)
//    * - Customize: ghép nối các shot
//    */
//   private buildStoredPrompt(dto: CreateVideoDto): string {
//     if (dto.multiShot && dto.shotType === 'customize' && dto.multiPrompt?.length) {
//       return dto.multiPrompt
//         .map((s) => `[Shot ${s.index}] ${s.prompt} (${s.duration}s)`)
//         .join(' | ');
//     }
//     return dto.prompt || '';
//   }

//   private async pollAndSaveResult(
//     videoGenId: number,
//     taskId: string,
//     userId: number,
//     projectId: number,
//   ) {
//     try {
//       await this.videoGenerationRepo.update(videoGenId, { status: 'processing' });
//       const taskResult = await this.klingService.pollUntilDone(taskId, 30000, 40);
//       const videoData = taskResult.task_result?.videos?.[0];

//       if (!videoData) {
//         throw new Error('Kling trả về succeed nhưng không có video URL');
//       }

//       this.logger.log(`Uploading video to Cloudinary...`);
//       const cloudinaryVideoUrl = await this.uploadVideoToCloudinary(
//         videoData.url,
//         userId,
//         projectId,
//         videoGenId,
//       );

//       const videoAsset = await this.assetRepo.save(
//         this.assetRepo.create({
//           userId,
//           projectId,
//           assetType: 'video',
//           assetRole: 'scene_video',
//           sourceType: 'generated',
//           originalUrl: videoData.url,
//           storedUrl:   cloudinaryVideoUrl,
//           storageProvider: 'cloudinary',
//           metadata: {
//             kling_video_id: videoData.id,
//             duration: videoData.duration,
//           },
//         }),
//       );

//       await this.videoGenerationRepo.update(videoGenId, {
//         status:         'succeeded',
//         outputAssetId:  videoAsset.id,
//         completedAt:    new Date(),
//         resultPayload:  taskResult as any,
//       });

//       await this.projectRepo.update(projectId, {
//         status:          'completed',
//         videoStepStatus: 'succeeded',
//       });

//       this.logger.log(`[VideoGen ${videoGenId}] DONE - ${cloudinaryVideoUrl}`);
//     } catch (err: any) {
//       this.logger.error(`[VideoGen ${videoGenId}] FAILED: ${err.message}`);

//       await this.videoGenerationRepo.update(videoGenId, {
//         status:        'failed',
//         errorMessage:  err.message,
//         completedAt:   new Date(),
//       });

//       await this.projectRepo.update(projectId, {
//         status:          'failed',
//         videoStepStatus: 'failed',
//       });
//     }
//   }

//   async createMotionControlVideo(
//     userId: number,
//     dto: CreateMotionControlVideoDto,
//     characterImageFile: Express.Multer.File,
//     referenceVideoFile: Express.Multer.File,
//   ) {
//     const model = await this.aiModelsService.findOne(dto.modelId);
//     if (!model) throw new BadRequestException('Model không tồn tại');

//     const project = await this.projectRepo.save(
//       this.projectRepo.create({
//         userId,
//         title: (dto.prompt || 'Motion Control').slice(0, 100),
//         workflowMode: 'video_only',
//         status: 'video_generating',
//         promptStepStatus: 'skipped',
//         imageStepStatus: 'skipped',
//         videoStepStatus: 'processing',
//         metadata: {},
//       }),
//     );

//     const projectId = project.id;
//     const sceneNumber = dto.sceneNumber ?? 1;
//     const baseFolder = `ai-generation/users/${userId}/projects/${projectId}/scenes/scene-${sceneNumber}`;

//     this.logger.log('[MotionControl] Uploading character image...');
//     const imageUpload = await this.cloudinaryService.uploadBuffer(
//       characterImageFile.buffer,
//       `${baseFolder}/images/character`,
//       `character_${Date.now()}`,
//     );

//     const characterAsset = await this.assetRepo.save(
//       this.assetRepo.create({
//         userId,
//         projectId,
//         assetType: 'image',
//         assetRole: 'image_begin',
//         sourceType: 'uploaded',
//         originalUrl: imageUpload.secure_url,
//         storedUrl:   imageUpload.secure_url,
//         storageProvider: 'cloudinary',
//         mimeType:    characterImageFile.mimetype,
//         fileSizeBytes: characterImageFile.size,
//         metadata: {
//           cloudinary_public_id: imageUpload.public_id,
//           width:  imageUpload.width,
//           height: imageUpload.height,
//         },
//       }),
//     );

//     const referenceVideoAsset = await this.assetRepo.save(
//       this.assetRepo.create({
//         userId,
//         projectId,
//         assetType: 'video',
//         assetRole: 'scene_video',
//         sourceType: 'uploaded',
//         originalUrl: '',
//         storedUrl:   '',
//         storageProvider: 'cloudinary',
//         mimeType:    referenceVideoFile.mimetype,
//         fileSizeBytes: referenceVideoFile.size,
//         metadata: {},
//       }),
//     );

//     const videoGen = await this.videoGenerationRepo.save(
//       this.videoGenerationRepo.create({
//         projectId,
//         modelId:               dto.modelId,
//         imageBeginAssetId:     characterAsset.id,
//         motionReferenceAssetId: referenceVideoAsset.id,
//         motionPrompt:          dto.prompt || '',
//         negativePrompt:        dto.negativePrompt,
//         status:                'queued',
//         externalTaskId:        '',
//         durationSeconds:       5,
//         generationType:        'motion_control',
//         characterOrientation:  dto.characterOrientation,
//         keepOriginalSound:     dto.keepOriginalSound === 'yes',
//         generationMode:        dto.mode || 'pro',
//         cost:                  dto.cost ?? 0,
//         params: { mode: dto.mode, characterOrientation: dto.characterOrientation },
//         requestPayload:  {},
//         responsePayload: {},
//         startedAt: new Date(),
//       }),
//     );

//     this.runMotionControlInBackground({
//       videoGen,
//       referenceVideoFile,
//       characterAsset,
//       referenceVideoAsset,
//       dto,
//       userId,
//       projectId,
//       baseFolder,
//       model,
//     }).catch((err) =>
//       this.logger.error(`[MotionControl] Background error: ${err.message}`),
//     );

//     return {
//       message: 'Đang xử lý, vui lòng chờ...',
//       videoGenerationId: videoGen.id,
//       projectId,
//       status: 'queued',
//       characterImageUrl: characterAsset.storedUrl,
//       promptSent: dto.prompt || '',
//       modelName: model.name,
//       generationMode: dto.mode || 'pro',
//       cost: dto.cost ?? 0,
//     };
//   }

//   private async pollMotionControlResult(
//     videoGenId: number,
//     taskId: string,
//     userId: number,
//     projectId: number,
//   ) {
//     try {
//       await this.videoGenerationRepo.update(videoGenId, { status: 'processing' });
//       const taskResult = await this.klingService.pollMotionControlUntilDone(taskId, 30000, 40);
//       const videoData = taskResult.task_result?.videos?.[0];

//       if (!videoData) throw new Error('Kling trả về succeed nhưng không có video URL');

//       this.logger.log(`[MotionControl] Uploading result video to Cloudinary...`);
//       const cloudinaryVideoUrl = await this.uploadVideoToCloudinary(
//         videoData.url, userId, projectId, videoGenId,
//       );

//       const videoAsset = await this.assetRepo.save(
//         this.assetRepo.create({
//           userId,
//           projectId,
//           assetType: 'video',
//           assetRole: 'scene_video',
//           sourceType: 'generated',
//           originalUrl: videoData.url,
//           storedUrl:   cloudinaryVideoUrl,
//           storageProvider: 'cloudinary',
//           metadata: { kling_video_id: videoData.id, duration: videoData.duration },
//         }),
//       );

//       await this.videoGenerationRepo.update(videoGenId, {
//         status:        'succeeded',
//         outputAssetId: videoAsset.id,
//         completedAt:   new Date(),
//         resultPayload: taskResult as any,
//       });

//       await this.projectRepo.update(projectId, {
//         status: 'completed',
//         videoStepStatus: 'succeeded',
//       });

//       this.logger.log(`[MotionControl ${videoGenId}] DONE - ${cloudinaryVideoUrl}`);
//     } catch (err: any) {
//       this.logger.error(`[MotionControl ${videoGenId}] FAILED: ${err.message}`);
//       await this.videoGenerationRepo.update(videoGenId, {
//         status:       'failed',
//         errorMessage: err.message,
//         completedAt:  new Date(),
//       });
//       await this.projectRepo.update(projectId, { status: 'failed', videoStepStatus: 'failed' });
//     }
//   }

//   async getMotionControlHistory(userId: number) {
//     const list = await this.videoGenerationRepo
//       .createQueryBuilder('vg')
//       .leftJoinAndSelect('vg.outputAsset', 'outputAsset')
//       .leftJoinAndSelect('vg.imageBeginAsset', 'imageBeginAsset')
//       .leftJoinAndSelect('vg.motionReferenceAsset', 'motionReferenceAsset')
//       .leftJoinAndSelect('vg.model', 'model')
//       .leftJoinAndSelect('model.provider', 'provider')
//       .innerJoin('projects', 'p', 'p.id = vg.project_id AND p.user_id = :userId', { userId })
//       .where('vg.generation_type = :type', { type: 'motion_control' })
//       .orderBy('vg.created_at', 'DESC')
//       .limit(50)
//       .getMany();

//     return list.map((vg) => ({
//       id:                  vg.id,
//       status:              vg.status,
//       promptSent:          vg.motionPrompt,
//       videoUrl:            vg.outputAsset?.storedUrl ?? null,
//       thumbnailUrl:        vg.imageBeginAsset?.storedUrl ?? null,
//       characterImageUrl:   vg.imageBeginAsset?.storedUrl ?? null,
//       referenceVideoUrl:   vg.motionReferenceAsset?.storedUrl ?? null,
//       modelName:           vg.model?.name ?? 'Unknown',
//       providerName:        vg.model?.provider?.name ?? 'Unknown',
//       characterOrientation: vg.characterOrientation,
//       durationSeconds:     vg.durationSeconds,
//       generationMode:      vg.generationMode,
//       cost:                vg.cost ?? 0,
//       createdAt:           vg.createdAt,
//     }));
//   }

//   private async uploadVideoToCloudinary(
//     videoUrl: string,
//     userId: number,
//     projectId: number,
//     videoGenId: number,
//   ): Promise<string> {
//     const folder   = `ai-generation/users/${userId}/projects/${projectId}/scenes/scene-1/videos`;
//     const publicId = `video_${videoGenId}_${Date.now()}`;
//     return this.cloudinaryService.uploadVideoFromUrl(videoUrl, folder, publicId);
//   }

//   async getVideoStatus(videoGenId: number) {
//     const videoGen = await this.videoGenerationRepo.findOne({
//       where: { id: videoGenId },
//       relations: ['outputAsset', 'imageBeginAsset', 'imageEndAsset'],
//     });

//     if (!videoGen) throw new BadRequestException('Không tìm thấy video generation');

//     return {
//       id:            videoGen.id,
//       status:        videoGen.status,
//       taskId:        videoGen.externalTaskId,
//       promptSent:    videoGen.motionPrompt,
//       beginImageUrl: videoGen.imageBeginAsset?.storedUrl ?? null,
//       endImageUrl:   videoGen.imageEndAsset?.storedUrl ?? null,
//       videoUrl:      videoGen.outputAsset?.storedUrl ?? null,
//       duration:      videoGen.durationSeconds,
//       errorMessage:  videoGen.errorMessage ?? null,
//       createdAt:     videoGen.createdAt,
//       completedAt:   videoGen.completedAt ?? null,
//     };
//   }

//   async getTaskStatus(taskId: string) {
//     return this.klingService.getTaskStatus(taskId);
//   }

//   async getHistory(userId: number) {
//     const list = await this.videoGenerationRepo
//       .createQueryBuilder('vg')
//       .leftJoinAndSelect('vg.outputAsset', 'outputAsset')
//       .leftJoinAndSelect('vg.imageBeginAsset', 'imageBeginAsset')
//       .leftJoinAndSelect('vg.imageEndAsset', 'imageEndAsset')
//       .leftJoinAndSelect('vg.model', 'model')
//       .leftJoinAndSelect('model.provider', 'provider')
//       .innerJoin('projects', 'p', 'p.id = vg.project_id AND p.user_id = :userId', { userId })
//       .orderBy('vg.created_at', 'DESC')
//       .limit(50)
//       .getMany();

//     return list.map((vg) => ({
//       id:           vg.id,
//       status:       vg.status,
//       promptSent:   vg.motionPrompt,
//       videoUrl:     vg.outputAsset?.storedUrl ?? null,
//       thumbnailUrl: vg.imageBeginAsset?.storedUrl ?? null,
//       beginImageUrl: vg.imageBeginAsset?.storedUrl ?? null,
//       endImageUrl:  vg.imageEndAsset?.storedUrl ?? null,
//       modelName:    vg.model?.name ?? 'Unknown',
//       providerName:   vg.model?.provider?.name ?? 'Unknown',
//       durationSeconds: vg.durationSeconds,
//       createdAt:    vg.createdAt,
//     }));
//   }

//   async getHistoryVideoGen(userId: number) {
//     const list = await this.videoGenerationRepo
//       .createQueryBuilder('vg')
//       .leftJoinAndSelect('vg.outputAsset', 'outputAsset')
//       .leftJoinAndSelect('vg.imageBeginAsset', 'imageBeginAsset')
//       .leftJoinAndSelect('vg.imageEndAsset', 'imageEndAsset')
//       .leftJoinAndSelect('vg.model', 'model')
//       .leftJoinAndSelect('model.provider', 'provider')
//       .innerJoin('projects', 'p', 'p.id = vg.project_id AND p.user_id = :userId', { userId })
//       .where('vg.generation_type = :type', { type: 'standard' })
//       .orderBy('vg.created_at', 'DESC')
//       .limit(50)
//       .getMany();

//     return list.map((vg) => ({
//       id:           vg.id,
//       status:       vg.status,
//       promptSent:   vg.motionPrompt,
//       videoUrl:     vg.outputAsset?.storedUrl ?? null,
//       thumbnailUrl: vg.imageBeginAsset?.storedUrl ?? null,
//       beginImageUrl: vg.imageBeginAsset?.storedUrl ?? null,
//       endImageUrl:  vg.imageEndAsset?.storedUrl ?? null,
//       modelName:    vg.model?.name ?? 'Unknown',
//       providerName:   vg.model?.provider?.name ?? 'Unknown',
//       durationSeconds: vg.durationSeconds,
//       generationMode: vg.generationMode,
//       cost:         vg.cost ?? 0,
//       createdAt:    vg.createdAt,
//     }));
//   }

//   private async runMotionControlInBackground({
//     videoGen,
//     referenceVideoFile,
//     characterAsset,
//     referenceVideoAsset,
//     dto,
//     userId,
//     projectId,
//     baseFolder,
//     model,
//   }: any) {
//     try {
//       this.logger.log('[MotionControl] [BG] Uploading reference video...');
//       const videoUpload = await this.cloudinaryService.uploadVideoBuffer(
//         referenceVideoFile.buffer,
//         `${baseFolder}/videos/reference`,
//         `ref_${Date.now()}`,
//       );

//       await this.assetRepo.update(referenceVideoAsset.id, {
//         originalUrl: videoUpload.secure_url,
//         storedUrl:   videoUpload.secure_url,
//         metadata: { cloudinary_public_id: videoUpload.public_id },
//       });

//       const klingModelName = model.code;
//       this.logger.log(`[MotionControl] [BG] Calling Kling: ${klingModelName}`);

//       const klingCreate = await this.klingService.createMotionControl({
//         modelName:            klingModelName,
//         imageUrl:             characterAsset.storedUrl,
//         videoUrl:             videoUpload.secure_url,
//         prompt:               dto.prompt || '',
//         keepOriginalSound:    dto.keepOriginalSound ?? 'yes',
//         characterOrientation: dto.characterOrientation,
//         mode:                 dto.mode || 'pro',
//       });

//       if (klingCreate.code !== 0) {
//         await this.videoGenerationRepo.update(videoGen.id, {
//           status:       'failed',
//           errorMessage: klingCreate.message,
//           completedAt:  new Date(),
//         });
//         await this.projectRepo.update(projectId, {
//           status:          'failed',
//           videoStepStatus: 'failed',
//         });
//         return;
//       }

//       const taskId = klingCreate.data.task_id;

//       await this.videoGenerationRepo.update(videoGen.id, {
//         externalTaskId:  taskId,
//         status:          'processing',
//         requestPayload:  klingCreate as any,
//         responsePayload: klingCreate as any,
//       });

//       await this.pollMotionControlResult(videoGen.id, taskId, userId, projectId);
//     } catch (err: any) {
//       this.logger.error(`[MotionControl BG ${videoGen.id}] FAILED: ${err.message}`);
//       await this.videoGenerationRepo.update(videoGen.id, {
//         status:       'failed',
//         errorMessage: err.message,
//         completedAt:  new Date(),
//       });
//       await this.projectRepo.update(projectId, {
//         status:          'failed',
//         videoStepStatus: 'failed',
//       });
//     }
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
import { MotionGeneration } from './entities/motion-generation.entity';
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

    @InjectRepository(MotionGeneration)
    private motionGenerationRepo: Repository<MotionGeneration>,

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

    // 2. Validate multi-shot params
    if (dto.multiShot) {
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
      dto.multiShot && dto.shotType === 'customize'
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

    // 4. Upload start image
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

    // 5. Upload end image nếu có
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

    // 6. Gọi Kling tạo task
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
      mode:          dto.mode || 'pro',
      multiShot:     dto.multiShot,
      shotType:      dto.shotType,
      multiPrompt:   dto.multiPrompt,
    });

    if (klingCreate.code !== 0) {
      await this.projectRepo.update(projectId, {
        status: 'failed',
        videoStepStatus: 'failed',
      });
      throw new BadRequestException(`Kling error: ${klingCreate.message}`);
    }

    const taskId = klingCreate.data.task_id;

    // 7. Lưu video_generation
    const storedPrompt = this.buildStoredPrompt(dto);

    const videoGen = await this.videoGenerationRepo.save(
      this.videoGenerationRepo.create({
        projectId,
        modelId: dto.modelId,
        imageBeginAssetId: beginAsset.id,
        imageEndAssetId:   endAsset?.id ?? undefined,
        motionPrompt:      storedPrompt,
        negativePrompt:    dto.negativePrompt,
        status:            'queued',
        externalTaskId:    taskId,
        durationSeconds:   Number(dto.duration || 5),
        generationMode:    dto.mode || 'std',
        generationSound:   dto.sound === 'on',
        cost:              dto.cost ?? 0,
        params: {
          resolution: dto.resolution,
          mode: dto.mode,
          multiShot: dto.multiShot ?? false,
          shotType: dto.shotType,
        },
        requestPayload: {
          modelName:    klingModelName,
          prompt:       dto.prompt,
          duration:     dto.duration,
          mode:         dto.mode,
          sound:        dto.sound,
          multiShot:    dto.multiShot ?? false,
          shotType:     dto.shotType,
          multiPrompt:  dto.multiPrompt,
        },
        responsePayload: klingCreate as any,
        startedAt: new Date(),
      }),
    );

    // 8. Polling ngầm
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
      endImageUrl:   endAsset?.storedUrl ?? null,
      promptSent:    storedPrompt,
      modelName:     model.name,
      generationMode: dto.mode || 'pro',
      multiShot:     dto.multiShot ?? false,
      shotType:      dto.shotType,
      cost:          dto.cost ?? 0,
    };
  }

  private buildStoredPrompt(dto: CreateVideoDto): string {
    if (dto.multiShot && dto.shotType === 'customize' && dto.multiPrompt?.length) {
      return dto.multiPrompt
        .map((s) => `[Shot ${s.index}] ${s.prompt} (${s.duration}s)`)
        .join(' | ');
    }
    return dto.prompt || '';
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
        storedUrl:   imageUpload.secure_url,
        storageProvider: 'cloudinary',
        mimeType:    characterImageFile.mimetype,
        fileSizeBytes: characterImageFile.size,
        metadata: {
          cloudinary_public_id: imageUpload.public_id,
          width:  imageUpload.width,
          height: imageUpload.height,
        },
      }),
    );

    const referenceVideoAsset = await this.assetRepo.save(
      this.assetRepo.create({
        userId,
        projectId,
        assetType: 'video',
        assetRole: 'scene_video',
        sourceType: 'uploaded',
        originalUrl: '',
        storedUrl:   '',
        storageProvider: 'cloudinary',
        mimeType:    referenceVideoFile.mimetype,
        fileSizeBytes: referenceVideoFile.size,
        metadata: {},
      }),
    );

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

    return {
      message: 'Đang xử lý, vui lòng chờ...',
      videoGenerationId: motionGen.id,
      projectId,
      status: 'queued',
      characterImageUrl: characterAsset.storedUrl,
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
          metadata: { kling_video_id: videoData.id, duration: videoData.duration },
        }),
      );

      await this.motionGenerationRepo.update(motionGenId, {
        status:        'succeeded',
        outputAssetId: videoAsset.id,
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

      const klingModelName = model.code;
      this.logger.log(`[MotionControl] [BG] Calling Kling: ${klingModelName}`);

      const klingCreate = await this.klingService.createMotionControl({
        modelName:            klingModelName,
        imageUrl:             characterAsset.storedUrl,
        videoUrl:             videoUpload.secure_url,
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

      await this.pollMotionControlResult(motionGen.id, taskId, userId, projectId);
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