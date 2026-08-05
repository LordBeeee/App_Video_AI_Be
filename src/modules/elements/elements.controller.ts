import {
  Controller, Post, Get, Delete, Patch, Param, Body, Req,
  UseGuards, UseInterceptors, UploadedFiles, BadRequestException,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ElementsService } from './elements.service';
import { CreateElementDto } from './dto/create-element.dto';

@Controller('elements')
@UseGuards(JwtAuthGuard)
export class ElementsController {
  constructor(private readonly elementsService: ElementsService) {}

  @Post('create')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'frontalImage', maxCount: 1 },
        { name: 'referImages', maxCount: 3 },
        { name: 'video', maxCount: 1 },
      ],
      { storage: memoryStorage() },
    ),
  )
  async create(
    @Req() req: any,
    @Body() body: any,
    @UploadedFiles()
    files: {
      frontalImage?: Express.Multer.File[];
      referImages?: Express.Multer.File[];
      video?: Express.Multer.File[];
    },
  ) {
    let referImageAssetIds: number[] | undefined;
    if (body.referImageAssetIds) {
      try {
        referImageAssetIds = JSON.parse(body.referImageAssetIds);
      } catch {
        throw new BadRequestException('referImageAssetIds không hợp lệ, phải là JSON array');
      }
    }

    if (!body.referenceType || !['image_refer', 'video_refer'].includes(body.referenceType)) {
      throw new BadRequestException('referenceType phải là image_refer hoặc video_refer');
    }

    const dto: CreateElementDto = {
      providerId: Number(body.providerId),
      referenceType: body.referenceType,
      elementName: body.elementName,
      elementDescription: body.elementDescription,
      elementVoiceId: body.elementVoiceId || undefined,
      frontalImageAssetId: body.frontalImageAssetId ? Number(body.frontalImageAssetId) : undefined,
      referImageAssetIds,
      videoAssetId: body.videoAssetId ? Number(body.videoAssetId) : undefined,
    };

    return this.elementsService.create(req.user.id, dto, {
      frontalImage: files?.frontalImage?.[0],
      referImages: files?.referImages,
      video: files?.video?.[0],
    });
  }

  @Get('history')
  getHistory(@Req() req: any) {
    return this.elementsService.getHistory(req.user.id);
  }

  @Get('task/:taskId/status')
  getKlingTaskStatus(@Param('taskId') taskId: string) {
    return this.elementsService.getKlingTaskStatus(taskId);
  }

  @Get(':id/status')
  getStatus(@Param('id') id: string) {
    return this.elementsService.getStatus(+id);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.elementsService.remove(req.user.id, +id);
  }

  @Patch(':id/favorite')
  setFavorite(
    @Req() req: any,
    @Param('id') id: string,
    @Body('isFavorite') isFavorite: boolean,
  ) {
    return this.elementsService.setFavorite(req.user.id, +id, isFavorite);
  }
}