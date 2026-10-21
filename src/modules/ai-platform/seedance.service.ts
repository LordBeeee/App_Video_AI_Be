import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class SeedanceService {
  private readonly baseUrl = 'https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks';

  constructor(private readonly config: ConfigService) {}

  private async request(method: 'GET' | 'POST', path: string, data?: unknown) {
    const key = this.config.get<string>('ARK_API_KEY');
    if (!key) throw new BadRequestException('Chưa cấu hình ARK_API_KEY');
    try {
      const response = await axios.request<any>({
        method,
        url: `${this.baseUrl}${path}`,
        data,
        timeout: 120_000,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      });
      return response.data;
    } catch (error: any) {
      throw new BadGatewayException(
        error.response?.data?.error?.message || error.response?.data?.message ||
          error.message || 'BytePlus request failed',
      );
    }
  }

  async submit(prompt: string, options: Record<string, any>, references: string[]) {
    if (references.length < 1 || references.length > 2)
      throw new BadRequestException('Seedance cần 1 ảnh đầu và tối đa 1 ảnh cuối');
    const content: Record<string, any>[] = [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: references[0] }, role: 'first_frame' },
    ];
    if (references[1]) content.push({
      type: 'image_url', image_url: { url: references[1] }, role: 'last_frame',
    });
    const task = await this.request('POST', '', {
      model: 'dreamina-seedance-2-5-260628',
      content,
      duration: Number(options.duration || 5),
      resolution: String(options.resolution || '720p'),
      ratio: 'adaptive',
      generate_audio: !!options.generateAudio,
      watermark: false,
      draft: false,
      return_last_frame: true,
    });
    return { id: String(task?.id || ''), status: String(task?.status || 'queued') };
  }

  async submitOmni(prompt: string, options: Record<string, any>) {
    const counts = { image: 0, video: 0, audio: 0 };
    const mentions = new Map<string, string>();
    for (const input of options.referenceInputs || []) {
      const kind = input.type === 'reference_image' ? 'image'
        : input.type === 'reference_video' ? 'video' : 'audio';
      mentions.set(`@${kind}_${input.assetId}`, `@${kind[0].toUpperCase()}${kind.slice(1)} ${++counts[kind]}`);
    }
    const providerPrompt = prompt.replace(/@(image|video|audio)_(\d+)/g, (mention) => {
      const mapped = mentions.get(mention);
      if (!mapped) throw new BadRequestException(`Tài nguyên ${mention} không còn được chọn`);
      return mapped;
    });
    const content: Record<string, any>[] = [{ type: 'text', text: providerPrompt }];
    for (const input of options.referenceInputs || []) {
      const kind = input.type === 'reference_image' ? 'image'
        : input.type === 'reference_video' ? 'video' : 'audio';
      content.push({
        type: `${kind}_url`,
        [`${kind}_url`]: { url: input.url },
        role: input.type,
      });
    }
    const task = await this.request('POST', '', {
      model: 'dreamina-seedance-2-5-260628',
      content,
      omni_reference_task_type: options.omniTaskType,
      duration: Number(options.duration),
      resolution: String(options.resolution || '720p'),
      ratio: options.omniTaskType === 'reference'
        ? String(options.aspectRatio || 'adaptive') : 'adaptive',
      generate_audio: !!options.generateAudio,
      watermark: false,
      draft: false,
      return_last_frame: true,
    });
    return { id: String(task?.id || ''), status: String(task?.status || 'queued') };
  }

  async getJob(jobId: string) {
    const task = await this.request('GET', `/${encodeURIComponent(jobId)}`);
    return {
      status: String(task?.status || ''),
      url: task?.content?.video_url ? String(task.content.video_url) : undefined,
      lastFrameUrl: task?.content?.last_frame_url
        ? String(task.content.last_frame_url) : undefined,
      error: task?.error?.message || task?.error,
      units: Number(task?.usage?.completion_tokens),
      costUsd: undefined as number | undefined,
    };
  }

  async download(url: string) {
    if (!url.startsWith('https://'))
      throw new BadGatewayException('BytePlus trả về URL video không hợp lệ');
    const response = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer', timeout: 180_000,
    });
    return Buffer.from(response.data);
  }
}
