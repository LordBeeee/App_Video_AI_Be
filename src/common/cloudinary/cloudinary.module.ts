import { Global, Module } from '@nestjs/common';
import { CloudinaryService } from './cloudinary.service';
import { UploadLimitsService } from './upload-limits.service';

@Global() // Global để các module khác dùng không cần import lại
@Module({
  providers: [CloudinaryService, UploadLimitsService],
  exports: [CloudinaryService, UploadLimitsService],
})
export class CloudinaryModule {}
