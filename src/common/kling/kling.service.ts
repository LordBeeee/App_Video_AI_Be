// import { Injectable, Logger } from '@nestjs/common';
// import { ConfigService } from '@nestjs/config';
// import axios from 'axios';
// import * as jwt from 'jsonwebtoken';

// export interface KlingCreateVideoDto {
//   modelName: string;
//   imageUrl: string;
//   imageTailUrl?: string;
//   prompt: string;
//   negativePrompt?: string;
//   duration?: string;
//   mode?: 'std' | 'pro' | '4k';
//   sound?: 'on' | 'off';
//   externalTaskId?: string;
//   callbackUrl?: string;
// }

// export interface KlingVideo {
//   id: string;
//   url: string;
//   duration: string;
// }

// export interface KlingTaskResult {
//   task_id: string;
//   task_status: 'submitted' | 'processing' | 'succeed' | 'failed';
//   task_result?: {
//     videos?: KlingVideo[];
//   };
//   task_status_msg?: string;
//   created_at: number;
//   updated_at: number;
// }

// export interface KlingApiResponse {
//   code: number;
//   message: string;
//   request_id: string;
//   data: KlingTaskResult;
// }

// export interface KlingCreateMotionControlDto {
//   modelName: string;
//   imageUrl: string;    // character image URL (public)
//   videoUrl: string;    // reference motion video URL (public)
//   prompt?: string;
//   keepOriginalSound?: 'yes' | 'no';
//   characterOrientation: 'image' | 'video';
//   mode: 'std' | 'pro';
//   externalTaskId?: string;
// }

// @Injectable()
// export class KlingService {
//   private readonly logger = new Logger(KlingService.name);
//   private readonly baseUrl = 'https://api-singapore.klingai.com';

//   constructor(private configService: ConfigService) {}

//     private generateToken(): string {
//     const ak = this.configService.getOrThrow<string>('KLING_ACCESS_KEY');
//     const sk = this.configService.getOrThrow<string>('KLING_SECRET_KEY');
//     const now = Math.floor(Date.now() / 1000);

//     const payload = {
//       iss: ak,
//       exp: now + 2700, // hết hạn sau 45 phút
//       nbf: now - 30,    // có hiệu lực từ 30 giây trước
//     };

//     return jwt.sign(payload, sk, {
//       algorithm: 'HS256',
//       header: { alg: 'HS256', typ: 'JWT' },
//       noTimestamp: true,
//     });
    
//   }

//   private get headers() {
//     return {
//       Authorization: `Bearer ${this.generateToken()}`,
//       'Content-Type': 'application/json',
//     };
//   }
//   // Bước 1: Tạo task
//   async createImageToVideo(dto: KlingCreateVideoDto): Promise<KlingApiResponse> {
//     const payload: any = {
//       model_name: dto.modelName,
//       image: dto.imageUrl,
//       prompt: dto.prompt,
//       duration: dto.duration || '5',
//       mode: dto.mode || 'std',
//       sound: dto.sound || 'off',
//       negative_prompt: dto.negativePrompt || '',
//       callback_url: dto.callbackUrl || '',
//       external_task_id: dto.externalTaskId || '',
//     };

//     if (dto.imageTailUrl) {
//       payload.image_tail = dto.imageTailUrl;
//     }

//     this.logger.log(`[Kling] Creating task: ${JSON.stringify(payload)}`);

//     const response = await axios.post<KlingApiResponse>(
//       `${this.baseUrl}/v1/videos/image2video`,
//       payload,
//       { headers: this.headers },
//     );

//     return response.data;
//   }

//   // Bước 2: Lấy status của 1 task
//   async getTaskStatus(taskId: string): Promise<KlingApiResponse> {
//     try {
//       const response = await axios.get<KlingApiResponse>(
//         `${this.baseUrl}/v1/videos/image2video/${taskId}`,
//         { headers: this.headers },
//       );
//       return response.data;
//     } catch (err: any) {
//       // Log đầy đủ để biết service code chính xác
//       this.logger.error(
//         `[Kling] getTaskStatus error - HTTP: ${err.response?.status}, ` +
//         `ServiceCode: ${err.response?.data?.code}, ` +
//         `Msg: ${err.response?.data?.message}`
//       );
//       throw err;
//     }
//   }
//   /**
//    * Polling cho đến khi task succeed hoặc failed
//    * @param taskId
//    * @param intervalMs - mỗi bao lâu check 1 lần (default 5s)
//    * @param maxAttempts - tối đa bao nhiêu lần (default 60 = 5 phút)
//    */
//   private sleep(ms: number): Promise<void> {
//     return new Promise((resolve) => setTimeout(resolve, ms));
//   }

//   async createMotionControl(dto: KlingCreateMotionControlDto): Promise<KlingApiResponse> {
//   const payload: any = {
//     model_name: dto.modelName,
//     image_url: dto.imageUrl,
//     video_url: dto.videoUrl,
//     prompt: dto.prompt || '',
//     keep_original_sound: dto.keepOriginalSound || 'yes',
//     character_orientation: dto.characterOrientation,
//     mode: dto.mode || 'pro',
//     external_task_id: dto.externalTaskId || '',
//   };

//   this.logger.log(`[Kling MotionControl] Creating task: ${JSON.stringify(payload)}`);

//   try {
//     const response = await axios.post<KlingApiResponse>(
//       `${this.baseUrl}/v1/videos/motion-control`,
//       payload,
//       { headers: this.headers },
//     );
//     return response.data;
//   } catch (err: any) {
//     this.logger.error(
//       `[Kling MotionControl] FAILED - status: ${err.response?.status}, data: ${JSON.stringify(err.response?.data)}`,
//     );
//     throw err;
//   }
// }

//   async getMotionControlTaskStatus(taskId: string): Promise<KlingApiResponse> {
//     try {
//       const response = await axios.get<KlingApiResponse>(
//         `${this.baseUrl}/v1/videos/motion-control/${taskId}`,
//         { headers: this.headers },
//       );
//       return response.data;
//     } catch (err: any) {
//       this.logger.error(
//         `[Kling] getMotionControlTaskStatus error - status: ${err.response?.status}, data: ${JSON.stringify(err.response?.data)}`,
//       );
//       throw err;
//     }
//   }
  
//   async pollUntilDone(
//     taskId: string,
//     intervalMs = 30000,
//     maxAttempts = 40,
//   ): Promise<KlingTaskResult> {
//     this.logger.log(`[Kling] Start polling taskId: ${taskId}`);
//     let consecutiveErrors = 0;
//     const maxConsecutiveErrors = 3;

//     for (let attempt = 1; attempt <= maxAttempts; attempt++) {
//       await this.sleep(intervalMs);

//       try {
//         const res = await this.getTaskStatus(taskId);
//         const task = res.data;
//         consecutiveErrors = 0; // reset khi success

//         this.logger.log(
//           `[Kling] Attempt ${attempt}/${maxAttempts} - status: ${task.task_status}`,
//         );

//         if (task.task_status === 'succeed') {
//           this.logger.log(`[Kling] Task ${taskId} SUCCEED`);
//           return task;
//         }

//         if (task.task_status === 'failed') {
//           this.logger.error(`[Kling] Task ${taskId} FAILED: ${task.task_status_msg}`);
//           throw new Error(`Kling task failed: ${task.task_status_msg}`);
//         }
//         // submitted | processing → tiếp tục
//       } catch (err: any) {
//         if (err.message?.startsWith('Kling task failed:')) throw err;

//         const httpStatus = err.response?.status;
//         const serviceCode = err.response?.data?.code;

//         if (httpStatus === 401) {
//           if (serviceCode === 1003) {
//             // "Authorization is not yet valid" → clock skew
//             // nbf: now - 5 chưa đủ, Kling server clock lệch
//             // → Tạm skip, token mới ở lần sau sẽ valid
//             this.logger.warn(`[Kling] Attempt ${attempt} - 401/1003 (clock skew), skipping...`);
//             continue;
//           }

//           if (serviceCode === 1004) {
//             // "Authorization has expired" → token expired sớm hơn dự kiến
//             // Token đã được regenerate → lần poll tiếp sẽ có token mới
//             this.logger.warn(`[Kling] Attempt ${attempt} - 401/1004 (token expired), skipping...`);
//             continue;
//           }

//           if (serviceCode === 1000 || serviceCode === 1002) {
//             // "Authentication failed / invalid" → credentials sai thật
//             // KHÔNG skip → throw ngay để biết sớm
//             throw new Error(`Kling auth failed (${serviceCode}): check KLING_ACCESS_KEY / KLING_SECRET_KEY`);
//           }

//           // 401 không rõ service code → skip an toàn
//           this.logger.warn(`[Kling] Attempt ${attempt} - 401 (serviceCode: ${serviceCode}), skipping...`);
//           continue;
//         }

//         // Lỗi khác (5xx, timeout, network) → count consecutive
//         consecutiveErrors++;
//         this.logger.warn(
//           `[Kling] Attempt ${attempt} non-auth error (${consecutiveErrors}/${maxConsecutiveErrors}): ${err.message}`,
//         );
//         if (consecutiveErrors >= maxConsecutiveErrors) {
//           throw new Error(`Kling polling aborted after ${maxConsecutiveErrors} consecutive errors: ${err.message}`);
//         }
//       }
//     }

//     throw new Error(`Kling task ${taskId} timeout sau ${maxAttempts} lần poll`);
//   }

//   async pollMotionControlUntilDone(
//     taskId: string,
//     intervalMs = 30000,
//     maxAttempts = 40,
//   ): Promise<KlingTaskResult> {
//     this.logger.log(`[Kling MotionControl] Start polling taskId: ${taskId}`);
//     let consecutiveErrors = 0;
//     const maxConsecutiveErrors = 3;

//     for (let attempt = 1; attempt <= maxAttempts; attempt++) {
//       await this.sleep(intervalMs);

//       try {
//         const res = await this.getMotionControlTaskStatus(taskId);
//         const task = res.data;
//         consecutiveErrors = 0;

//         this.logger.log(
//           `[Kling MotionControl] Attempt ${attempt}/${maxAttempts} - status: ${task.task_status}`,
//         );

//         if (task.task_status === 'succeed') return task;

//         if (task.task_status === 'failed') {
//           throw new Error(`Kling motion control task failed: ${task.task_status_msg}`);
//         }
//       } catch (err: any) {
//         if (err.message?.startsWith('Kling motion control task failed:')) throw err;

//         consecutiveErrors++;
//         this.logger.warn(
//           `[Kling MotionControl] Attempt ${attempt} error (${consecutiveErrors}/${maxConsecutiveErrors}): ${err.message}`,
//         );

//         if (consecutiveErrors >= maxConsecutiveErrors) {
//           throw new Error(
//             `Kling MotionControl polling aborted after ${maxConsecutiveErrors} consecutive errors: ${err.message}`,
//           );
//         }
//       }
//     }

//     throw new Error(`Kling motion control task ${taskId} timeout`);
//   }
// }
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as jwt from 'jsonwebtoken';

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

@Injectable()
export class KlingService {
  private readonly logger = new Logger(KlingService.name);
  private readonly baseUrl = 'https://api-singapore.klingai.com';

  constructor(private configService: ConfigService) {}

  private generateToken(): string {
    const ak = this.configService.getOrThrow<string>('KLING_ACCESS_KEY');
    const sk = this.configService.getOrThrow<string>('KLING_SECRET_KEY');
    const now = Math.floor(Date.now() / 1000);

    const payload = {
      iss: ak,
      exp: now + 2700,
      nbf: now - 30,
    };

    return jwt.sign(payload, sk, {
      algorithm: 'HS256',
      header: { alg: 'HS256', typ: 'JWT' },
      noTimestamp: true,
    });
  }

  private get headers() {
    return {
      Authorization: `Bearer ${this.generateToken()}`,
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
}