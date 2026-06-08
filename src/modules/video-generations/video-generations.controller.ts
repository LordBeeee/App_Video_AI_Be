// import {
//   Controller,
//   Post,
//   UseGuards,
//   Req,
//   Body,
//   UseInterceptors,
//   UploadedFiles,
//   BadRequestException,
//   Get,
//   Param,
// } from '@nestjs/common';
// import { FileFieldsInterceptor } from '@nestjs/platform-express';
// import { memoryStorage } from 'multer';
// import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
// import { VideoGenerationsService } from './video-generations.service';
// import { CreateMotionControlVideoDto, CreateVideoDto } from './dto/create-video.dto';

// @Controller('video-generations')
// @UseGuards(JwtAuthGuard)
// export class VideoGenerationsController {
//   constructor(private readonly videoGenerationsService: VideoGenerationsService) {}

//   @Post('create')
//   @UseInterceptors(
//     FileFieldsInterceptor(
//       [
//         { name: 'startImage', maxCount: 1 },
//         { name: 'endImage', maxCount: 1 },
//       ],
//       { storage: memoryStorage() },
//     ),
//   )
//   async createVideo(
//     @Req() req: any,
//     @Body() body: any,
//     @UploadedFiles()
//     files: {
//       startImage?: Express.Multer.File[];
//       endImage?: Express.Multer.File[];
//     },
//   ) {
//     const startImage = files?.startImage?.[0];
//     if (!startImage) {
//       throw new BadRequestException('Start image là bắt buộc');
//     }

//     const dto: CreateVideoDto = {
//       modelId: Number(body.modelId),
//       resolution: body.resolution || '720p',
//       prompt: body.prompt,
//       negativePrompt: body.negativePrompt,
//       duration: body.duration || '5',
//       mode: body.mode || 'pro',
//       sound: body.sound || 'off',
//       sceneNumber: body.sceneNumber ? Number(body.sceneNumber) : 1,
//       cost: body.cost ? Math.round(Number(body.cost)) : 0,
//     };

//     return this.videoGenerationsService.createVideo(
//       req.user.id,
//       dto,
//       startImage,
//       files?.endImage?.[0],
//     );
//   }

//   @Post('create-motion-control')
//   @UseInterceptors(
//     FileFieldsInterceptor(
//       [
//         { name: 'characterImage', maxCount: 1 },
//         { name: 'referenceVideo', maxCount: 1 },
//       ],
//       { storage: memoryStorage() },
//     ),
//   )
//   async createMotionControlVideo(
//     @Req() req: any,
//     @Body() body: any,
//     @UploadedFiles()
//     files: {
//       characterImage?: Express.Multer.File[];
//       referenceVideo?: Express.Multer.File[];
//     },
//   ) {
//     const characterImage = files?.characterImage?.[0];
//     const referenceVideo = files?.referenceVideo?.[0];

//     if (!characterImage) throw new BadRequestException('Character image là bắt buộc');
//     if (!referenceVideo) throw new BadRequestException('Reference video là bắt buộc');

//     const dto: CreateMotionControlVideoDto = {
//       modelId: Number(body.modelId),
//       prompt: body.prompt,
//       negativePrompt: body.negativePrompt,
//       characterOrientation: body.characterOrientation || 'image',
//       keepOriginalSound: (body.keepOriginalSound as 'yes' | 'no') ?? 'yes',
//       mode: body.mode || 'pro',
//       sceneNumber: body.sceneNumber ? Number(body.sceneNumber) : 1,
//       cost: body.cost ? Math.round(Number(body.cost)) : 0,
//     };

//     return this.videoGenerationsService.createMotionControlVideo(
//       req.user.id,
//       dto,
//       characterImage,
//       referenceVideo,
//     );
//   }

//   @Get('task/:taskId/status')
//   getTaskStatus(@Param('taskId') taskId: string) {
//     return this.videoGenerationsService.getTaskStatus(taskId);
//   }

//   @Get('history')
//   getHistory(@Req() req: any) {
//     return this.videoGenerationsService.getHistory(req.user.id);
//   }

//   @Get('motion-control/history')
//   getMotionControlHistory(@Req() req: any) {
//     return this.videoGenerationsService.getMotionControlHistory(req.user.id);
//   }

//   @Get('video-gen/history')
//   getVideoGenHistory(@Req() req: any) {
//     return this.videoGenerationsService.getHistoryVideoGen(req.user.id);
//   }

//   @Get(':id/status')
//   getVideoStatus(@Param('id') id: string) {
//     return this.videoGenerationsService.getVideoStatus(+id);
//   }
// }
import {
  Controller,
  Post,
  UseGuards,
  Req,
  Body,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
  Get,
  Param,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { VideoGenerationsService } from './video-generations.service';
import { CreateMotionControlVideoDto, CreateVideoDto } from './dto/create-video.dto';

@Controller('video-generations')
@UseGuards(JwtAuthGuard)
export class VideoGenerationsController {
  constructor(private readonly videoGenerationsService: VideoGenerationsService) {}

  @Post('create')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'startImage', maxCount: 1 },
        { name: 'endImage', maxCount: 1 },
      ],
      { storage: memoryStorage() },
    ),
  )
  async createVideo(
    @Req() req: any,
    @Body() body: any,
    @UploadedFiles()
    files: {
      startImage?: Express.Multer.File[];
      endImage?: Express.Multer.File[];
    },
  ) {
    const startImage = files?.startImage?.[0];
    if (!startImage) {
      throw new BadRequestException('Start image là bắt buộc');
    }

    const multiShot = body.multiShot === 'true';
    const shotType  = body.shotType as 'customize' | 'intelligence' | undefined;

    // Parse multi_prompt từ JSON string (chỉ khi customize mode)
    let multiPrompt: { index: number; prompt: string; duration: string }[] | undefined;
    if (multiShot && shotType === 'customize' && body.multiPrompt) {
      try {
        multiPrompt = JSON.parse(body.multiPrompt);
      } catch {
        throw new BadRequestException('multiPrompt không hợp lệ, phải là JSON array');
      }

      if (!Array.isArray(multiPrompt) || multiPrompt.length === 0) {
        throw new BadRequestException('multiPrompt phải là array có ít nhất 1 phần tử');
      }
      if (multiPrompt.length > 6) {
        throw new BadRequestException('multiPrompt tối đa 6 storyboard');
      }
    }

    const dto: CreateVideoDto = {
      modelId:       Number(body.modelId),
      resolution:    body.resolution || '720p',
      prompt:        body.prompt || '',
      negativePrompt: body.negativePrompt,
      duration:      body.duration || '5',
      mode:          body.mode || 'pro',
      sound:         body.sound || 'off',
      sceneNumber:   body.sceneNumber ? Number(body.sceneNumber) : 1,
      cost:          body.cost ? Math.round(Number(body.cost)) : 0,
      // multi-shot
      multiShot,
      shotType,
      multiPrompt,
    };

    return this.videoGenerationsService.createVideo(
      req.user.id,
      dto,
      startImage,
      files?.endImage?.[0],
    );
  }

  @Post('create-motion-control')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'characterImage', maxCount: 1 },
        { name: 'referenceVideo', maxCount: 1 },
      ],
      { storage: memoryStorage() },
    ),
  )
  async createMotionControlVideo(
    @Req() req: any,
    @Body() body: any,
    @UploadedFiles()
    files: {
      characterImage?: Express.Multer.File[];
      referenceVideo?: Express.Multer.File[];
    },
  ) {
    const characterImage = files?.characterImage?.[0];
    const referenceVideo = files?.referenceVideo?.[0];

    if (!characterImage) throw new BadRequestException('Character image là bắt buộc');
    if (!referenceVideo) throw new BadRequestException('Reference video là bắt buộc');

    const dto: CreateMotionControlVideoDto = {
      modelId:              Number(body.modelId),
      prompt:               body.prompt,
      negativePrompt:       body.negativePrompt,
      characterOrientation: body.characterOrientation || 'image',
      keepOriginalSound:    (body.keepOriginalSound as 'yes' | 'no') ?? 'yes',
      mode:                 body.mode || 'pro',
      sceneNumber:          body.sceneNumber ? Number(body.sceneNumber) : 1,
      cost:                 body.cost ? Math.round(Number(body.cost)) : 0,
    };

    return this.videoGenerationsService.createMotionControlVideo(
      req.user.id,
      dto,
      characterImage,
      referenceVideo,
    );
  }

  @Get('task/:taskId/status')
  getTaskStatus(@Param('taskId') taskId: string) {
    return this.videoGenerationsService.getTaskStatus(taskId);
  }

  @Get('history')
  getHistory(@Req() req: any) {
    return this.videoGenerationsService.getHistory(req.user.id);
  }

  @Get('motion-control/history')
  getMotionControlHistory(@Req() req: any) {
    return this.videoGenerationsService.getMotionControlHistory(req.user.id);
  }

  @Get('video-gen/history')
  getVideoGenHistory(@Req() req: any) {
    return this.videoGenerationsService.getHistoryVideoGen(req.user.id);
  }

  @Get(':id/status')
  getVideoStatus(@Param('id') id: string) {
    return this.videoGenerationsService.getVideoStatus(+id);
  }
}