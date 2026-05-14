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
import { CreateVideoDto } from './dto/create-video.dto';

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
      { storage: memoryStorage() }, // giữ trong RAM, không lưu disk
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

    const dto: CreateVideoDto = {
      modelId: Number(body.modelId),
      // projectId: Number(body.projectId),
      resolution: body.resolution || '720p',
      prompt: body.prompt,
      negativePrompt: body.negativePrompt,
      duration: body.duration || '5',
      mode: body.mode || 'pro',
      sound: body.sound || 'off',
      sceneNumber: body.sceneNumber ? Number(body.sceneNumber) : 1,
    };

    return this.videoGenerationsService.createVideo(
      req.user.id,
      dto,
      startImage,
      files?.endImage?.[0],
    );
  }

  @Get('task/:taskId/status')
  getTaskStatus(@Param('taskId') taskId: string) {
    return this.videoGenerationsService.getTaskStatus(taskId);
  }

  @Get('history')
  getHistory(@Req() req: any) {
    return this.videoGenerationsService.getHistory(req.user.id)
  }
  
  @Get(':id/status')
    getVideoStatus(@Param('id') id: string) {
    return this.videoGenerationsService.getVideoStatus(+id);
    }
  
}