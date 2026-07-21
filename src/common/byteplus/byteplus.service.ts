import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface BytePlusContentItem {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
  role?: 'first_frame' | 'last_frame';
}

export interface BytePlusCreateVideoDto {
  modelCode: string;         // e.g. 'dreamina-seedance-2-0-260128'
  prompt: string;
  imageUrl: string;          // first frame (bắt buộc)
  imageTailUrl?: string;     // last frame (tuỳ chọn)
  resolution?: string;       // '480p' | '720p' | '1080p' | '4k'
  ratio?: string;            // '16:9' | '9:16' | ...
  duration?: number;         // giây
  generateAudio?: boolean;
}

export interface BytePlusTaskResult {
  id: string;
  model: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'expired' | 'cancelled';
  content?: { video_url?: string };
  error?: { code?: string; message?: string };
  resolution?: string;
  ratio?: string;
  duration?: number;
  created_at: number;
  updated_at: number;
}

@Injectable()
export class BytePlusService {
  private readonly logger = new Logger(BytePlusService.name);
  private readonly baseUrl = 'https://ark.ap-southeast.bytepluses.com';

  constructor(private configService: ConfigService) {}

  private get headers() {
    const apiKey = this.configService.getOrThrow<string>('ARK_API_KEY');
    return {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async createVideoTask(dto: BytePlusCreateVideoDto): Promise<BytePlusTaskResult> {
    const content: BytePlusContentItem[] = [
      { type: 'text', text: dto.prompt },
    ];

    if (dto.imageTailUrl) {
      // First + last frame mode: role bắt buộc cho cả 2 ảnh
      content.push({
        type: 'image_url',
        image_url: { url: dto.imageUrl },
        role: 'first_frame',
      });
      content.push({
        type: 'image_url',
        image_url: { url: dto.imageTailUrl },
        role: 'last_frame',
      });
    } else {
      // First frame only: role có thể bỏ trống
      content.push({
        type: 'image_url',
        image_url: { url: dto.imageUrl },
        role: 'first_frame',
      });
    }

    const payload: Record<string, any> = {
      model: dto.modelCode,
      content,
      resolution: dto.resolution || '720p',
      ratio: dto.ratio || 'adaptive',
      duration: dto.duration ?? 5,
      generate_audio: dto.generateAudio ?? true,
    };

    this.logger.log(`[BytePlus] createVideoTask payload: ${JSON.stringify(payload)}`);

    try {
      const response = await axios.post<BytePlusTaskResult>(
        `${this.baseUrl}/api/v3/contents/generations/tasks`,
        payload,
        { headers: this.headers },
      );
      return response.data;
    } catch (err: any) {
      this.logger.error(
        `[BytePlus] createVideoTask FAILED - status: ${err.response?.status}, ` +
        `data: ${JSON.stringify(err.response?.data)}`,
      );
      throw err;
    }
  }

  async getTaskStatus(taskId: string): Promise<BytePlusTaskResult> {
    try {
      const response = await axios.get<BytePlusTaskResult>(
        `${this.baseUrl}/api/v3/contents/generations/tasks/${taskId}`,
        { headers: this.headers },
      );
      return response.data;
    } catch (err: any) {
      this.logger.error(
        `[BytePlus] getTaskStatus error - status: ${err.response?.status}, ` +
        `data: ${JSON.stringify(err.response?.data)}`,
      );
      throw err;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async pollUntilDone(
    taskId: string,
    intervalMs = 10000,
    maxAttempts = 60,
  ): Promise<BytePlusTaskResult> {
    this.logger.log(`[BytePlus] Start polling taskId: ${taskId}`);
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await this.sleep(intervalMs);

      try {
        const task = await this.getTaskStatus(taskId);
        consecutiveErrors = 0;

        this.logger.log(
          `[BytePlus] Attempt ${attempt}/${maxAttempts} - status: ${task.status}`,
        );

        if (task.status === 'succeeded') {
          this.logger.log(`[BytePlus] Task ${taskId} SUCCEEDED`);
          return task;
        }

        if (task.status === 'failed' || task.status === 'expired' || task.status === 'cancelled') {
          throw new Error(
            `BytePlus task ${task.status}: ${task.error?.message || 'unknown error'}`,
          );
        }
        // 'queued' | 'running' → tiếp tục poll
      } catch (err: any) {
        if (err.message?.startsWith('BytePlus task')) throw err;

        consecutiveErrors++;
        this.logger.warn(
          `[BytePlus] Attempt ${attempt} error (${consecutiveErrors}/${maxConsecutiveErrors}): ${err.message}`,
        );
        if (consecutiveErrors >= maxConsecutiveErrors) {
          throw new Error(
            `BytePlus polling aborted after ${maxConsecutiveErrors} consecutive errors: ${err.message}`,
          );
        }
      }
    }

    throw new Error(`BytePlus task ${taskId} timeout sau ${maxAttempts} lần poll`);
  }
}