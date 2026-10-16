import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { klingVideoModel } from './kling-video';

@Injectable()
export class KlingService {
  private readonly baseUrl = 'https://api-singapore.klingai.com';

  constructor(private readonly config: ConfigService) {}

  private async request(method: 'GET' | 'POST', path: string, data?: unknown) {
    const key = this.config.get<string>('KLING_API_KEY');
    if (!key) throw new BadRequestException('Chưa cấu hình KLING_API_KEY');
    try {
      const response = await axios.request<any>({
        method,
        url: `${this.baseUrl}${path}`,
        data,
        timeout: 120_000,
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
      });
      if (response.data?.code != null && response.data.code !== 0) {
        throw new Error(
          response.data.message || `Kling error ${response.data.code}`,
        );
      }
      return response.data?.data;
    } catch (error: any) {
      throw new BadGatewayException(
        error.response?.data?.message ||
          error.message ||
          'Kling request failed',
      );
    }
  }

  async submit(
    modelId: string,
    prompt: string,
    options: Record<string, any>,
    references: string[],
  ) {
    const model = klingVideoModel(modelId);
    if (!model) throw new BadRequestException('Model Kling không hợp lệ');
    if (!references.length)
      throw new BadRequestException('Cần ít nhất một ảnh để tạo video');
    const duration = Number(options.duration || 5);
    const resolution = String(options.resolution || '720p');
    const audio = options.generateAudio ? 'native' : 'off';
    const referenceMode = options.referenceMode === 'refer_image' ? 'refer_image' : 'first_frame';
    let path: string;
    let body: Record<string, any>;
    if (model.apiKind === 'omni_legacy') {
      path = '/v1/videos/omni-video';
      const imageList = references.map((url, index) => ({
        image_url: url,
        ...(referenceMode === 'first_frame'
          ? { type: index === 0 ? 'first_frame' : 'end_frame' }
          : {}),
      }));
      body = {
        model_name: model.apiModel,
        prompt: referenceMode === 'refer_image'
          ? `${prompt} ${references.map((_, i) => `<<<image_${i + 1}>>>`).filter((tag) => !prompt.includes(tag)).join(' ')}`.trim()
          : prompt,
        image_list: imageList,
        duration: String(duration),
        mode: resolution === '1080p' ? 'pro' : 'std',
        ...(referenceMode === 'refer_image' ? { aspect_ratio: options.aspectRatio || '16:9' } : {}),
      };
    } else if (model.apiKind === 'omni_new') {
      path = '/omni-video/kling-3.0-omni';
      body = {
        contents: [
          { type: 'prompt', text: prompt },
          ...references.map((url, index) => ({
            type: referenceMode === 'refer_image'
              ? 'refer_image'
              : index === 0 ? 'first_frame' : 'last_frame',
            url,
            id: `image_${index + 1}`,
          })),
        ],
        settings: {
          duration,
          resolution,
          audio,
          multi_shot: !!options.multiShot,
          ...(referenceMode === 'refer_image' ? { aspect_ratio: options.aspectRatio || '16:9' } : {}),
        },
      };
    } else {
      path = `/image-to-video/${model.apiModel}`;
      body = {
        contents: [
          { type: 'prompt', text: prompt },
          { type: 'first_frame', url: references[0] },
          ...(references[1]
            ? [{ type: 'last_frame', url: references[1] }]
            : []),
        ],
        settings: model.apiKind === 'turbo'
          ? { duration, resolution }
          : { duration, resolution, audio, multi_shot: !!options.multiShot },
      };
    }
    const job = await this.request('POST', path, body);
    return {
      id: String(job?.id || job?.task_id || ''),
      status: String(job?.status || job?.task_status || 'submitted'),
    };
  }

  async getJob(modelId: string, jobId: string) {
    const model = klingVideoModel(modelId);
    if (!model) throw new BadRequestException('Model Kling không hợp lệ');
    const data =
      model.apiKind === 'omni_legacy'
        ? await this.request(
            'GET',
            `/v1/videos/omni-video/${encodeURIComponent(jobId)}`,
          )
        : await this.request(
            'GET',
            `/tasks?task_ids=${encodeURIComponent(jobId)}`,
          );
    const job = Array.isArray(data) ? data[0] : data;
    if (!job)
      throw new BadGatewayException('Kling chưa trả về trạng thái tác vụ');
    const output = job.outputs?.find?.((item: any) => item.type === 'video');
    const url =
      output?.url || output?.video?.url || job.task_result?.videos?.[0]?.url;
    const billing = job.billing || [];
    const cash = billing.find?.(
      (item: any) => item.charge_type === 'cash' && item.currency === 'USD',
    );
    return {
      status: String(job.status || job.task_status || ''),
      url: url ? String(url) : undefined,
      error: job.message || job.task_status_msg,
      units: Number(
        job.final_unit_deduction ||
          billing.find?.((item: any) => item.charge_type === 'unit')?.amount,
      ),
      costUsd: cash ? Number(cash.amount) : undefined,
    };
  }

  async download(url: string) {
    if (!url.startsWith('https://'))
      throw new BadGatewayException('Kling trả về URL video không hợp lệ');
    const response = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 180_000,
    });
    return Buffer.from(response.data);
  }
}
