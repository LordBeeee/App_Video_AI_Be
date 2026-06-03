// import { Module } from '@nestjs/common';
// import { ConfigModule } from '@nestjs/config';
// import { TypeOrmModule } from '@nestjs/typeorm';
// import { AppController } from './app.controller';
// import { AppService } from './app.service';
// import { UserModule } from './modules/user/user.module';
// import { AuthModule } from './modules/auth/auth.module';
// import { AiModelsModule } from './modules/ai-models/ai-models.module';
// import { CloudinaryModule } from './common/cloudinary/cloudinary.module';
// import { KlingModule } from './common/kling/kling.module';
// import { VideoGenerationsModule } from './modules/video-generations/video-generations.module';

// @Module({
//   imports: [
//     ConfigModule.forRoot({
//       isGlobal: true,
//     }),

//     TypeOrmModule.forRoot({
//       type: 'postgres',
//       host: process.env.DB_HOST,
//       port: Number(process.env.DB_PORT),
//       username: process.env.DB_USERNAME,
//       password: process.env.DB_PASSWORD,
//       database: process.env.DB_DATABASE,
//       ssl:
//       process.env.DB_SSL === 'true'
//         ? { rejectUnauthorized: false }
//         : false,
//       autoLoadEntities: true,
//       synchronize: false,
//     }),

//     UserModule,
//     AuthModule,
//     AiModelsModule,
//     CloudinaryModule,
//     KlingModule,
//     VideoGenerationsModule,
//   ],
//   controllers: [AppController],
//   providers: [AppService],
// })
// export class AppModule {}

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
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
    ConfigModule.forRoot({ isGlobal: true }),

    // Rate limiting toàn bộ app
    ThrottlerModule.forRoot([{
      ttl: 60_000, // 1 phút
      limit: 60,   // 60 request/phút cho các route thường
    }]),

    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
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
  providers: [
    AppService,
    // Apply ThrottlerGuard cho toàn bộ app
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}