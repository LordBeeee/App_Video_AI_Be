import {
  CurrentUser,
  type AuthenticatedUser,
} from '../auth/decorators/current-user.decorator';
import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AssetsService } from './assets.service';
import { UploadLimitsService } from '../../common/cloudinary/upload-limits.service';

@Controller('assets')
@UseGuards(JwtAuthGuard)
export class AssetsController {
  constructor(private readonly assetsService: AssetsService, private readonly uploadLimits: UploadLimitsService) {}

  @Get('upload-limits')
  getUploadLimits() {
    return this.uploadLimits.getLimits();
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('File là bắt buộc');
    return this.assetsService.uploadToLibrary(user.id, file);
  }

  @Get()
  findLibrary(
    @CurrentUser() user: AuthenticatedUser,
    @Query('tab') tab: 'creative' | 'upload' = 'creative',
    @Query('type') type: 'all' | 'image' | 'video' | 'audio' = 'all',
    @Query('favorite') favorite?: string,
  ) {
    return this.assetsService.findLibrary(user.id, {
      tab,
      type,
      favoritesOnly: favorite === 'true',
    });
  }

  @Patch(':id/favorite')
  toggleFavorite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body('isFavorite') isFavorite: boolean,
  ) {
    return this.assetsService.setFavorite(user.id, +id, !!isFavorite);
  }
}
