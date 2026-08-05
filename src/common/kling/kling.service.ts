import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
// import * as jwt from 'jsonwebtoken';

export interface KlingMultiPromptItem {
  index: number;
  prompt: string;
  duration: string;
}

export interface KlingCreateVideoDto {
  modelName: string;
  imageUrl: string;
  imageTailUrl?: string;

  // ── Normal mode (multiShot=false hoặc intelligence) ──
  prompt: string;
  negativePrompt?: string;

  duration?: string;
  mode?: 'std' | 'pro' | '4k';
  sound?: 'on' | 'off';
  externalTaskId?: string;
  callbackUrl?: string;

  // ── Multi-Shot ─────────────────────────────────────────────────────────
  multiShot?: boolean;
  // 'customize': gửi kèm multiPrompt
  // 'intelligence': Kling tự phân cảnh, dùng prompt bình thường
  shotType?: 'customize' | 'intelligence';
  // Bắt buộc khi multiShot=true + shotType='customize'
  multiPrompt?: KlingMultiPromptItem[];
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

export interface KlingCreateMotionControlDto {
  modelName: string;
  imageUrl: string;
  videoUrl: string;
  prompt?: string;
  keepOriginalSound?: 'yes' | 'no';
  characterOrientation: 'image' | 'video';
  mode: 'std' | 'pro';
  externalTaskId?: string;
}

export interface KlingCreateElementDto {
  elementName: string;
  elementDescription: string;
  referenceType: 'image_refer' | 'video_refer';
  frontalImageUrl?: string;
  referImageUrls?: string[];
  videoUrl?: string;
  elementVoiceId?: string;
  externalTaskId?: string;
  callbackUrl?: string;
}

export interface KlingElementTaskResult {
  task_id: string;
  task_status: 'submitted' | 'processing' | 'succeed' | 'failed';
  task_status_msg?: string;
  created_at: number;
  updated_at: number;
}

export interface KlingElementApiResponse {
  code: number;
  message: string;
  request_id: string;
  data: KlingElementTaskResult;
}

export interface KlingElementResult {
  element_id: number;
  element_name: string;
  element_description: string;
  reference_type: string;
  element_image_list?: any;
  element_video_list?: any;
  element_voice_info?: any;
}

export interface KlingElementQueryResult {
  task_id: string;
  task_status: 'submitted' | 'processing' | 'succeed' | 'failed';
  task_status_msg?: string;
  created_at: number;
  updated_at: number;
  task_result?: { elements: KlingElementResult[] };
}

export interface KlingElementQueryApiResponse {
  code: number;
  message: string;
  request_id: string;
  data: KlingElementQueryResult;
}

@Injectable()
export class KlingService {
  private readonly logger = new Logger(KlingService.name);
  private readonly baseUrl = 'https://api-singapore.klingai.com';

  constructor(private configService: ConfigService) {}

  // private generateToken(): string {
  //   const ak = this.configService.getOrThrow<string>('KLING_ACCESS_KEY');
  //   const sk = this.configService.getOrThrow<string>('KLING_SECRET_KEY');
  //   const now = Math.floor(Date.now() / 1000);

  //   const payload = {
  //     iss: ak,
  //     exp: now + 2700,
  //     nbf: now - 30,
  //   };

  //   return jwt.sign(payload, sk, {
  //     algorithm: 'HS256',
  //     header: { alg: 'HS256', typ: 'JWT' },
  //     noTimestamp: true,
  //   });
  // }

  // private get headers() {
  //   return {
  //     Authorization: `Bearer ${this.generateToken()}`,
  //     'Content-Type': 'application/json',
  //   };
  // }
  private get headers() {
    const apiKey = this.configService.getOrThrow<string>('KLING_API_KEY');
    return {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async createImageToVideo(dto: KlingCreateVideoDto): Promise<KlingApiResponse> {
    const payload: Record<string, any> = {
      model_name: dto.modelName,
      image:       dto.imageUrl,
      duration:    dto.duration || '5',
      mode:        dto.mode || 'std',
      sound:       dto.sound || 'off',
      negative_prompt: dto.negativePrompt || '',
      callback_url:    dto.callbackUrl || '',
      external_task_id: dto.externalTaskId || '',
    };

    if (dto.imageTailUrl) {
      payload.image_tail = dto.imageTailUrl;
    }

    if (dto.multiShot) {
      // ── Multi-Shot mode ─────────────────────────────────────────────────
      // Kling docs: khi multi_shot=true, prompt là INVALID với customize,
      // nhưng BẮT BUỘC với intelligence
      payload.multi_shot = 'true';
      payload.shot_type  = dto.shotType || 'customize';

      if (dto.shotType === 'intelligence') {
        // intelligence: Kling tự phân cảnh, cần prompt, KHÔNG gửi multi_prompt
        payload.prompt = dto.prompt;
      } else {
        // customize: KHÔNG gửi prompt, gửi multi_prompt
        payload.multi_prompt = (dto.multiPrompt ?? []).map((item) => ({
          index:    item.index,
          prompt:   item.prompt,
          duration: item.duration,
        }));
      }
    } else {
      // ── Normal mode ─────────────────────────────────────────────────────
      // Kling docs: khi multi_shot=false, shot_type & multi_prompt là INVALID
      payload.multi_shot = 'false';
      payload.prompt = dto.prompt;
    }

    this.logger.log(`[Kling] createImageToVideo payload: ${JSON.stringify(payload)}`);

    const response = await axios.post<KlingApiResponse>(
      `${this.baseUrl}/v1/videos/image2video`,
      payload,
      { headers: this.headers },
    );

    return response.data;
  }

  async getTaskStatus(taskId: string): Promise<KlingApiResponse> {
    try {
      const response = await axios.get<KlingApiResponse>(
        `${this.baseUrl}/v1/videos/image2video/${taskId}`,
        { headers: this.headers },
      );
      return response.data;
    } catch (err: any) {
      this.logger.error(
        `[Kling] getTaskStatus error - HTTP: ${err.response?.status}, ` +
        `ServiceCode: ${err.response?.data?.code}, ` +
        `Msg: ${err.response?.data?.message}`,
      );
      throw err;
    }
  }

  async createMotionControl(dto: KlingCreateMotionControlDto): Promise<KlingApiResponse> {
    const payload: any = {
      model_name:           dto.modelName,
      image_url:            dto.imageUrl,
      video_url:            dto.videoUrl,
      prompt:               dto.prompt || '',
      keep_original_sound:  dto.keepOriginalSound || 'yes',
      character_orientation: dto.characterOrientation,
      mode:                 dto.mode || 'pro',
      external_task_id:     dto.externalTaskId || '',
    };

    this.logger.log(`[Kling MotionControl] Creating task: ${JSON.stringify(payload)}`);

    try {
      const response = await axios.post<KlingApiResponse>(
        `${this.baseUrl}/v1/videos/motion-control`,
        payload,
        { headers: this.headers },
      );
      return response.data;
    } catch (err: any) {
      this.logger.error(
        `[Kling MotionControl] FAILED - status: ${err.response?.status}, ` +
        `data: ${JSON.stringify(err.response?.data)}`,
      );
      throw err;
    }
  }

  async getMotionControlTaskStatus(taskId: string): Promise<KlingApiResponse> {
    try {
      const response = await axios.get<KlingApiResponse>(
        `${this.baseUrl}/v1/videos/motion-control/${taskId}`,
        { headers: this.headers },
      );
      return response.data;
    } catch (err: any) {
      this.logger.error(
        `[Kling] getMotionControlTaskStatus error - status: ${err.response?.status}, ` +
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
    intervalMs = 30000,
    maxAttempts = 40,
  ): Promise<KlingTaskResult> {
    this.logger.log(`[Kling] Start polling taskId: ${taskId}`);
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await this.sleep(intervalMs);

      try {
        const res = await this.getTaskStatus(taskId);
        const task = res.data;
        consecutiveErrors = 0;

        this.logger.log(
          `[Kling] Attempt ${attempt}/${maxAttempts} - status: ${task.task_status}`,
        );

        if (task.task_status === 'succeed') {
          this.logger.log(`[Kling] Task ${taskId} SUCCEED`);
          return task;
        }

        if (task.task_status === 'failed') {
          this.logger.error(`[Kling] Task ${taskId} FAILED: ${task.task_status_msg}`);
          throw new Error(`Kling task failed: ${task.task_status_msg}`);
        }
      } catch (err: any) {
        if (err.message?.startsWith('Kling task failed:')) throw err;

        const httpStatus = err.response?.status;
        const serviceCode = err.response?.data?.code;

        if (httpStatus === 401) {
          if (serviceCode === 1003) {
            this.logger.warn(`[Kling] Attempt ${attempt} - 401/1003 (clock skew), skipping...`);
            continue;
          }
          if (serviceCode === 1004) {
            this.logger.warn(`[Kling] Attempt ${attempt} - 401/1004 (token expired), skipping...`);
            continue;
          }
          if (serviceCode === 1000 || serviceCode === 1002) {
            throw new Error(`Kling auth failed (${serviceCode}): check KLING_ACCESS_KEY / KLING_SECRET_KEY`);
          }
          this.logger.warn(`[Kling] Attempt ${attempt} - 401 (serviceCode: ${serviceCode}), skipping...`);
          continue;
        }

        consecutiveErrors++;
        this.logger.warn(
          `[Kling] Attempt ${attempt} non-auth error (${consecutiveErrors}/${maxConsecutiveErrors}): ${err.message}`,
        );
        if (consecutiveErrors >= maxConsecutiveErrors) {
          throw new Error(
            `Kling polling aborted after ${maxConsecutiveErrors} consecutive errors: ${err.message}`,
          );
        }
      }
    }

    throw new Error(`Kling task ${taskId} timeout sau ${maxAttempts} lần poll`);
  }

  async pollMotionControlUntilDone(
    taskId: string,
    intervalMs = 30000,
    maxAttempts = 40,
  ): Promise<KlingTaskResult> {
    this.logger.log(`[Kling MotionControl] Start polling taskId: ${taskId}`);
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await this.sleep(intervalMs);

      try {
        const res = await this.getMotionControlTaskStatus(taskId);
        const task = res.data;
        consecutiveErrors = 0;

        this.logger.log(
          `[Kling MotionControl] Attempt ${attempt}/${maxAttempts} - status: ${task.task_status}`,
        );

        if (task.task_status === 'succeed') return task;

        if (task.task_status === 'failed') {
          throw new Error(`Kling motion control task failed: ${task.task_status_msg}`);
        }
      } catch (err: any) {
        if (err.message?.startsWith('Kling motion control task failed:')) throw err;

        consecutiveErrors++;
        this.logger.warn(
          `[Kling MotionControl] Attempt ${attempt} error (${consecutiveErrors}/${maxConsecutiveErrors}): ${err.message}`,
        );

        if (consecutiveErrors >= maxConsecutiveErrors) {
          throw new Error(
            `Kling MotionControl polling aborted after ${maxConsecutiveErrors} consecutive errors: ${err.message}`,
          );
        }
      }
    }

    throw new Error(`Kling motion control task ${taskId} timeout`);
  }
  
  async createElement(dto: KlingCreateElementDto): Promise<KlingElementApiResponse> {
    const payload: Record<string, any> = {
      element_name: dto.elementName,
      element_description: dto.elementDescription,
      reference_type: dto.referenceType,
      callback_url: dto.callbackUrl || '',
      external_task_id: dto.externalTaskId || '',
    };

    if (dto.referenceType === 'image_refer') {
      payload.element_image_list = {
        frontal_image: dto.frontalImageUrl,
        refer_images: (dto.referImageUrls ?? []).map((url) => ({ image_url: url })),
      };
      if (dto.elementVoiceId) payload.element_voice_id = dto.elementVoiceId;
    } else {
      payload.element_video_list = {
        refer_videos: dto.videoUrl ? [{ video_url: dto.videoUrl }] : [],
      };
    }

    this.logger.log(`[Kling] createElement payload: ${JSON.stringify(payload)}`);

    try {
      const response = await axios.post<KlingElementApiResponse>(
        `${this.baseUrl}/v1/general/advanced-custom-elements/`,
        payload,
        { headers: this.headers },
      );
      return response.data;
    } catch (err: any) {
      this.logger.error(
        `[Kling] createElement FAILED - status: ${err.response?.status}, data: ${JSON.stringify(err.response?.data)}`,
      );
      throw err;
    }
  }

  async getElementTaskStatus(taskId: string): Promise<KlingElementQueryApiResponse> {
    try {
      const response = await axios.get<KlingElementQueryApiResponse>(
        `${this.baseUrl}/v1/general/advanced-custom-elements/${taskId}`,
        { headers: this.headers },
      );
      return response.data;
    } catch (err: any) {
      this.logger.error(
        `[Kling] getElementTaskStatus error - status: ${err.response?.status}, data: ${JSON.stringify(err.response?.data)}`,
      );
      throw err;
    }
  }

  async deleteElement(elementId: string): Promise<any> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/v1/general/delete-advanced-elements`,
        { element_id: elementId },
        { headers: this.headers },
      );
      return response.data;
    } catch (err: any) {
      this.logger.error(
        `[Kling] deleteElement error - status: ${err.response?.status}, data: ${JSON.stringify(err.response?.data)}`,
      );
      throw err;
    }
  }

  async pollElementUntilDone(
    taskId: string,
    intervalMs = 5000,
    maxAttempts = 30,
  ): Promise<KlingElementQueryResult> {
    this.logger.log(`[Kling] Start polling element taskId: ${taskId}`);
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await this.sleep(intervalMs);

      try {
        const res = await this.getElementTaskStatus(taskId);
        const task = res.data;
        consecutiveErrors = 0;

        this.logger.log(
          `[Kling] Element poll ${attempt}/${maxAttempts} - status: ${task.task_status}`,
        );

        if (task.task_status === 'succeed') return task;
        if (task.task_status === 'failed') {
          throw new Error(`Kling element task failed: ${task.task_status_msg}`);
        }
      } catch (err: any) {
        if (err.message?.startsWith('Kling element task failed:')) throw err;

        consecutiveErrors++;
        this.logger.warn(
          `[Kling] Element poll attempt ${attempt} error (${consecutiveErrors}/${maxConsecutiveErrors}): ${err.message}`,
        );
        if (consecutiveErrors >= maxConsecutiveErrors) {
          throw new Error(
            `Kling element polling aborted after ${maxConsecutiveErrors} consecutive errors: ${err.message}`,
          );
        }
      }
    }

    throw new Error(`Kling element task ${taskId} timeout sau ${maxAttempts} lần poll`);
  }
}