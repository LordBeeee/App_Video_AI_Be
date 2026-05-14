import { Global, Module } from '@nestjs/common';
import { CloudinaryService } from './cloudinary.service';

@Global() // Global để các module khác dùng không cần import lại
@Module({
  providers: [CloudinaryService],
  exports: [CloudinaryService],
})
export class CloudinaryModule {}