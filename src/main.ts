import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.useBodyParser('json', { limit: '1mb' });

  // Bảo vệ HTTP headers
  app.use(helmet());

  // Đọc cookie từ request
  app.use(cookieParser());

  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    credentials: true,
  });

  await app.listen(Number(process.env.PORT) || 3000);
}

void bootstrap();
