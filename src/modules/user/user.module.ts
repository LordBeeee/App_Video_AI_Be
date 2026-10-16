import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserService } from './user.service';
import { User } from './entities/user.entity';
import { UserController } from './user.controller';
import { Role } from './entities/role.entity';
import { CloudinaryModule } from '../../common/cloudinary/cloudinary.module';
import { StatisticsService } from './statistics.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, Role]), CloudinaryModule],
  controllers: [UserController],
  providers: [UserService, StatisticsService],
  exports: [UserService],
})
export class UserModule {}
