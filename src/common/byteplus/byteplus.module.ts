import { Global, Module } from '@nestjs/common';
import { BytePlusService } from './byteplus.service';

@Global()
@Module({
  providers: [BytePlusService],
  exports: [BytePlusService],
})
export class BytePlusModule {}