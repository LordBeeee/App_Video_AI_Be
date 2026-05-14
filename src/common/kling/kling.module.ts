import { Global, Module } from '@nestjs/common';
import { KlingService } from './kling.service';

@Global()
@Module({
  providers: [KlingService],
  exports: [KlingService],
})
export class KlingModule {}