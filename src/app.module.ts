import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UserModule } from './modules/user/user.module';
import { AuthModule } from './modules/auth/auth.module';
import { AiModelsModule } from './modules/ai-models/ai-models.module';
import { CloudinaryModule } from './common/cloudinary/cloudinary.module';
import { KlingModule } from './common/kling/kling.module';
import { VideoGenerationsModule } from './modules/video-generations/video-generations.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
      // ssl: {
      //   rejectUnauthorized: false,
      // },
      ssl:
      process.env.DB_SSL === 'true'
        ? { rejectUnauthorized: false }
        : false,
      autoLoadEntities: true,
      synchronize: false,
    }),

    UserModule,
    AuthModule,
    AiModelsModule,
    CloudinaryModule,
    KlingModule,
    VideoGenerationsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}