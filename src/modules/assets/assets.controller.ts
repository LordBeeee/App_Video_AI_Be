import {
  Controller, Get, Post, Patch, Param, Query, Body, Req,
  UseGuards, UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AssetsService } from './assets.service';

@Controller('assets')
@UseGuards(JwtAuthGuard)
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async upload(@Req() req: any, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('File là bắt buộc');
    return this.assetsService.uploadToLibrary(req.user.id, file);
  }

    @Get()
    findLibrary(
    @Req() req: any,
    @Query('tab') tab: 'creative' | 'upload' = 'creative',
    @Query('type') type: 'all' | 'image' | 'video' | 'audio' = 'all',
    @Query('favorite') favorite?: string,
    ) {
    return this.assetsService.findLibrary(req.user.id, {
        tab,
        type,
        favoritesOnly: favorite === 'true',
    });
    }

  @Patch(':id/favorite')
  toggleFavorite(
    @Req() req: any,
    @Param('id') id: string,
    @Body('isFavorite') isFavorite: boolean,
  ) {
    return this.assetsService.setFavorite(req.user.id, +id, !!isFavorite);
  }
}