import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as jwt from 'jsonwebtoken';

export interface KlingCreateVideoDto {
  modelName: string;
  imageUrl: string;
  imageTailUrl?: string;
  prompt: string;
  negativePrompt?: string;
  // duration?: '5' | '10';
  duration?: string;
  mode?: 'std' | 'pro';
  sound?: 'on' | 'off';
  externalTaskId?: string;
  callbackUrl?: string;
}

export interface KlingVideo {
  id: string;
  url: string;
  duration: string;
}

export interface KlingTaskResult {
  task_id: string;
  task_status: 'submitted' | 'processing' | 'succeed' | 'failed';
  task_result?: {
    videos?: KlingVideo[];
  };
  task_status_msg?: string;
  created_at: number;
  updated_at: number;
}

export interface KlingApiResponse {
  code: number;
  message: string;
  request_id: string;
  data: KlingTaskResult;
}

@Injectable()
export class KlingService {
  private readonly logger = new Logger(KlingService.name);
  private readonly baseUrl = 'https://api-singapore.klingai.com';

  constructor(private configService: ConfigService) {}

//   private getToken(): string {
//     return this.configService.getOrThrow<string>('KLING_API_TOKEN');
//   }

//   private get headers() {
//     return {
//       Authorization: `Bearer ${this.getToken()}`,
//       'Content-Type': 'application/json',
//     };
//   }
    private generateToken(): string {
    const ak = this.configService.getOrThrow<string>('KLING_ACCESS_KEY');
    const sk = this.configService.getOrThrow<string>('KLING_SECRET_KEY');

    const now = Math.floor(Date.now() / 1000);

    const payload = {
      iss: ak,
      exp: now + 2700, // hết hạn sau 45 phút
      nbf: now - 5,    // có hiệu lực từ 5 giây trước
    };

    return jwt.sign(payload, sk, {
      algorithm: 'HS256',
      header: { alg: 'HS256', typ: 'JWT' },
    });
  }

  private get headers() {
    return {
      Authorization: `Bearer ${this.generateToken()}`,
      'Content-Type': 'application/json',
    };
  }
  // Bước 1: Tạo task
  async createImageToVideo(dto: KlingCreateVideoDto): Promise<KlingApiResponse> {
    const payload: any = {
      model_name: dto.modelName,
      image: dto.imageUrl,
      prompt: dto.prompt,
      duration: dto.duration || '5',
      mode: dto.mode || 'std',
      sound: dto.sound || 'off',
      negative_prompt: dto.negativePrompt || '',
      callback_url: dto.callbackUrl || '',
      external_task_id: dto.externalTaskId || '',
    };

    if (dto.imageTailUrl) {
      payload.image_tail = dto.imageTailUrl;
    }

    this.logger.log(`[Kling] Creating task: ${JSON.stringify(payload)}`);

    const response = await axios.post<KlingApiResponse>(
      `${this.baseUrl}/v1/videos/image2video`,
      payload,
      { headers: this.headers },
    );

    return response.data;
  }

  // Bước 2: Lấy status của 1 task
  async getTaskStatus(taskId: string): Promise<KlingApiResponse> {
    const response = await axios.get<KlingApiResponse>(
      `${this.baseUrl}/v1/videos/image2video/${taskId}`,
      { headers: this.headers },
    );

    return response.data;
  }

  /**
   * Polling cho đến khi task succeed hoặc failed
   * @param taskId
   * @param intervalMs - mỗi bao lâu check 1 lần (default 5s)
   * @param maxAttempts - tối đa bao nhiêu lần (default 60 = 5 phút)
   */
  async pollUntilDone(
    taskId: string,
    intervalMs = 30000,
    maxAttempts = 40,
  ): Promise<KlingTaskResult> {
    this.logger.log(`[Kling] Start polling taskId: ${taskId}`);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Chờ trước khi check
      await this.sleep(intervalMs);

      const res = await this.getTaskStatus(taskId);
      const task = res.data;

      this.logger.log(
        `[Kling] Attempt ${attempt}/${maxAttempts} - status: ${task.task_status}`,
      );

      if (task.task_status === 'succeed') {
        this.logger.log(`[Kling] Task ${taskId} SUCCEED`);
        return task;
      }

      if (task.task_status === 'failed') {
        this.logger.error(
          `[Kling] Task ${taskId} FAILED: ${task.task_status_msg}`,
        );
        throw new Error(`Kling task failed: ${task.task_status_msg}`);
      }

      // submitted | processing -> tiếp tục poll
    }

    throw new Error(`Kling task ${taskId} timeout sau ${maxAttempts} lần poll`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}