import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Asset } from '../assets/entities/asset.entity';
import { klingVideoModel } from './catalog/kling-video';

@Injectable()
export class KlingService {
  private readonly baseUrl = 'https://api-singapore.klingai.com';

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Asset) private readonly assetRepo: Repository<Asset>,
  ) {}

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

  async createElement(userId: number, body: any) {
    const name = String(body.name || '').trim();
    const description = String(body.description || '').trim();
    const referenceType = body.referenceType === 'video' ? 'video' : 'image';
    if (
      body.additionalAssetIds != null &&
      !Array.isArray(body.additionalAssetIds)
    )
      throw new BadRequestException('Danh sách ảnh bổ sung không hợp lệ');
    const ids =
      referenceType === 'video'
        ? [body.videoAssetId]
        : [body.mainAssetId, ...(body.additionalAssetIds || [])];
    if (!name || name.length > 20 || !description || description.length > 100)
      throw new BadRequestException('Tên (1–20) và mô tả (1–100) là bắt buộc');
    if (
      ids.some((id) => !Number.isSafeInteger(Number(id))) ||
      (referenceType === 'image' && (ids.length < 2 || ids.length > 4))
    )
      throw new BadRequestException(
        'Element ảnh cần 1 ảnh chính và 1–3 ảnh bổ sung',
      );
    if (new Set(ids.map(String)).size !== ids.length)
      throw new BadRequestException('Ảnh tham chiếu không được trùng nhau');
    const assets = await this.assetRepo.find({
      where: { id: In(ids.map(Number)), userId },
    });
    if (
      assets.length !== ids.length ||
      assets.some((asset) => asset.assetType !== referenceType)
    )
      throw new BadRequestException('Tài nguyên tham chiếu không hợp lệ');
    if (
      referenceType === 'image' &&
      assets.some(
        (asset) =>
          (asset.mimeType &&
            !['image/jpeg', 'image/png'].includes(asset.mimeType)) ||
          (asset.fileSizeBytes && Number(asset.fileSizeBytes) > 10_000_000) ||
          (asset.width && asset.width < 300) ||
          (asset.height && asset.height < 300),
      )
    )
      throw new BadRequestException(
        'Ảnh phải là JPG/PNG, tối đa 10 MB và ít nhất 300 px',
      );
    if (
      referenceType === 'image' &&
      assets.some(
        (asset) =>
          asset.width &&
          asset.height &&
          (asset.width / asset.height < 0.4 ||
            asset.width / asset.height > 2.5),
      )
    )
      throw new BadRequestException(
        'Tỉ lệ ảnh phải nằm trong khoảng 1:2.5–2.5:1',
      );
    if (
      referenceType === 'video' &&
      assets.some(
        (asset) =>
          (asset.mimeType &&
            !['video/mp4', 'video/quicktime'].includes(asset.mimeType)) ||
          (asset.fileSizeBytes && Number(asset.fileSizeBytes) > 200_000_000) ||
          (asset.durationSeconds &&
            (asset.durationSeconds < 3 || asset.durationSeconds > 8)),
      )
    )
      throw new BadRequestException(
        'Video phải là MP4/MOV, dài 3–8 giây và tối đa 200 MB',
      );
    const byId = new Map(assets.map((asset) => [String(asset.id), asset]));
    const urls = ids.map((id) => byId.get(String(id))!.storedUrl);
    const payload: Record<string, any> = {
      element_name: name,
      element_description: description,
      reference_type: referenceType === 'image' ? 'image_refer' : 'video_refer',
      ...(referenceType === 'image'
        ? {
            element_image_list: {
              frontal_image: urls[0],
              refer_images: urls.slice(1).map((image_url) => ({ image_url })),
            },
          }
        : { element_video_list: { refer_videos: [{ video_url: urls[0] }] } }),
      ...(String(body.voiceId || '').trim()
        ? { element_voice_id: String(body.voiceId).trim() }
        : {}),
    };
    const asset = await this.assetRepo.save(
      this.assetRepo.create({
        userId,
        projectId: null,
        sceneId: null,
        assetType: referenceType,
        assetRole: 'element',
        sourceType: 'reference',
        storedUrl: urls[0],
        originalUrl: urls[0],
        thumbnailUrl: referenceType === 'image' ? urls[0] : null,
        storageProvider: 'kling',
        mimeType: null,
        fileSizeBytes: null,
        durationSeconds: null,
        fps: null,
        width: null,
        height: null,
        isFavorite: false,
        metadata: {
          provider: 'Kling AI',
          name,
          description,
          referenceType,
          voiceId: body.voiceId || null,
          taskId: null,
          status: 'submitting',
          referenceUrls: urls,
        },
      }),
    );
    let task: any;
    try {
      task = await this.request(
        'POST',
        '/v1/general/advanced-custom-elements',
        payload,
      );
      if (!task?.task_id)
        throw new BadGatewayException('Kling không trả về task ID');
    } catch (error) {
      asset.metadata = {
        ...asset.metadata,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
      await this.assetRepo.save(asset);
      throw error;
    }
    asset.metadata = {
      ...asset.metadata,
      taskId: task.task_id,
      status: task.task_status || 'submitted',
    };
    return this.assetRepo.save(asset);
  }

  async createVoice(userId: number, body: any) {
    const name = String(body.name || '').trim();
    const sampleAssetId = Number(body.sampleAssetId);
    if (!name || name.length > 20)
      throw new BadRequestException('Tên Voice phải có 1–20 ký tự');
    if (!Number.isSafeInteger(sampleAssetId) || sampleAssetId < 1)
      throw new BadRequestException('Cần chọn file mẫu giọng');
    const sample = await this.assetRepo.findOne({
      where: { id: sampleAssetId, userId },
    });
    if (
      !sample ||
      !['audio', 'video'].includes(sample.assetType) ||
      (sample.mimeType &&
        ![
          'audio/mpeg',
          'audio/mp3',
          'audio/wav',
          'audio/x-wav',
          'video/mp4',
          'video/quicktime',
        ].includes(sample.mimeType))
    )
      throw new BadRequestException(
        'Mẫu giọng phải là MP3, WAV, MP4 hoặc MOV của bạn',
      );
    const duration = Number(
      (sample.metadata as Record<string, any>)?.mediaDurationSeconds ||
        sample.durationSeconds ||
        0,
    );
    if (duration && (duration < 5 || duration > 30))
      throw new BadRequestException('Mẫu giọng phải dài 5–30 giây');
    const asset = await this.assetRepo.save(
      this.assetRepo.create({
        userId,
        projectId: null,
        sceneId: null,
        assetType: 'audio',
        assetRole: 'voice',
        sourceType: 'reference',
        storedUrl: sample.storedUrl,
        originalUrl: sample.storedUrl,
        thumbnailUrl: null,
        storageProvider: 'kling',
        mimeType: sample.mimeType,
        fileSizeBytes: sample.fileSizeBytes,
        durationSeconds: sample.durationSeconds,
        fps: null,
        width: null,
        height: null,
        isFavorite: false,
        metadata: {
          provider: 'Kling AI',
          name,
          referenceType: 'voice',
          sampleAssetId,
          taskId: null,
          status: 'submitting',
        },
      }),
    );
    let task: any;
    try {
      task = await this.request('POST', '/v1/general/custom-voices', {
        voice_name: name,
        voice_url: sample.storedUrl,
      });
      if (!task?.task_id)
        throw new BadGatewayException('Kling không trả về task ID');
    } catch (error) {
      asset.metadata = {
        ...asset.metadata,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
      await this.assetRepo.save(asset);
      throw error;
    }
    asset.metadata = {
      ...asset.metadata,
      taskId: task.task_id,
      status: task.task_status || 'submitted',
    };
    return this.assetRepo.save(asset);
  }

  async listReferences(userId: number) {
    const assets = await this.assetRepo.find({
      where: {
        userId,
        sourceType: 'reference',
        assetRole: In(['element', 'voice']),
      },
      order: { createdAt: 'DESC' },
    });
    for (const asset of assets) {
      const meta = asset.metadata as Record<string, any>;
      if (meta?.deleteStatus === 'submitting') continue;
      if (
        meta?.deleteStatus === 'submitted' ||
        meta?.deleteStatus === 'processing'
      ) {
        try {
          const path =
            asset.assetRole === 'voice'
              ? 'custom-voices'
              : 'advanced-custom-elements';
          const task = await this.request(
            'GET',
            `/v1/general/${path}/${encodeURIComponent(meta.deleteTaskId)}`,
          );
          meta.deleteStatus = task?.task_status || meta.deleteStatus;
          meta.deleteError =
            task?.task_status === 'failed'
              ? task?.task_status_msg || 'Kling không xóa được Reference'
              : null;
          asset.metadata = meta;
          await this.assetRepo.save(asset);
        } catch {
          /* Keep the pending deletion visible for a later status check. */
        }
        continue;
      }
      if (meta?.deleteStatus === 'succeed') continue;
      if (!meta?.taskId || !['submitted', 'processing'].includes(meta.status))
        continue;
      try {
        const path =
          asset.assetRole === 'voice'
            ? 'custom-voices'
            : 'advanced-custom-elements';
        const task = await this.request(
          'GET',
          `/v1/general/${path}/${encodeURIComponent(meta.taskId)}`,
        );
        meta.status = task?.task_status || meta.status;
        meta.error = task?.task_status_msg || null;
        if (asset.assetRole === 'voice') {
          meta.voiceId =
            task?.task_result?.voices?.[0]?.voice_id || meta.voiceId || null;
          meta.trialUrl =
            task?.task_result?.voices?.[0]?.trial_url || meta.trialUrl || null;
        } else {
          meta.elementId = task?.task_result?.elements?.[0]?.element_id || null;
        }
        asset.metadata = meta;
        await this.assetRepo.save(asset);
      } catch {
        /* Keep the saved task visible if Kling is temporarily unavailable. */
      }
    }
    return {
      items: assets.filter(
        (asset) =>
          (asset.metadata as Record<string, any>)?.deleteStatus !== 'succeed',
      ),
    };
  }

  async deleteReference(userId: number, assetId: number) {
    if (!Number.isSafeInteger(assetId) || assetId < 1)
      throw new BadRequestException('Reference ID không hợp lệ');
    const asset = await this.assetRepo.findOne({ where: { id: assetId } });
    if (!asset) throw new NotFoundException('Không tìm thấy Reference');
    if (Number(asset.userId) !== Number(userId)) throw new ForbiddenException();
    if (
      asset.sourceType !== 'reference' ||
      !['element', 'voice'].includes(asset.assetRole || '')
    )
      throw new BadRequestException('Asset này không phải Reference');

    const meta = asset.metadata as Record<string, any>;
    if (meta.deleteStatus === 'succeed') return asset;
    if (['submitting', 'submitted', 'processing'].includes(meta.deleteStatus))
      return asset;

    const isVoice = asset.assetRole === 'voice';
    const klingId = isVoice ? meta.voiceId : meta.elementId;
    if (!klingId) {
      if (meta.status !== 'failed')
        throw new ConflictException(
          'Reference đang tạo, hãy đợi Kling xử lý xong',
        );
      asset.metadata = { ...meta, deleteStatus: 'succeed' };
      return this.assetRepo.save(asset);
    }

    asset.metadata = { ...meta, deleteStatus: 'submitting', deleteError: null };
    await this.assetRepo.save(asset);
    try {
      const task = await this.request(
        'POST',
        isVoice
          ? '/v1/general/delete-voices'
          : '/v1/general/delete-advanced-elements',
        isVoice
          ? { voice_id: String(klingId) }
          : { element_id: String(klingId) },
      );
      if (!task?.task_id && task?.task_status !== 'succeed')
        throw new BadGatewayException('Kling không trả về task ID xóa');
      asset.metadata = {
        ...asset.metadata,
        deleteTaskId: task.task_id || null,
        deleteStatus: task.task_status || 'submitted',
      };
      return this.assetRepo.save(asset);
    } catch (error) {
      asset.metadata = {
        ...asset.metadata,
        deleteStatus: 'failed',
        deleteError: error instanceof Error ? error.message : String(error),
      };
      await this.assetRepo.save(asset);
      throw error;
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
    const referenceMode =
      options.referenceMode === 'refer_image' ? 'refer_image' : 'first_frame';
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
        prompt:
          referenceMode === 'refer_image'
            ? `${prompt} ${references
                .map((_, i) => `<<<image_${i + 1}>>>`)
                .filter((tag) => !prompt.includes(tag))
                .join(' ')}`.trim()
            : prompt,
        image_list: imageList,
        duration: String(duration),
        mode: resolution === '1080p' ? 'pro' : 'std',
        ...(referenceMode === 'refer_image'
          ? { aspect_ratio: options.aspectRatio || '16:9' }
          : {}),
      };
    } else if (model.apiKind === 'omni_new') {
      path = '/omni-video/kling-3.0-omni';
      body = {
        contents: [
          { type: 'prompt', text: prompt },
          ...references.map((url, index) => ({
            type:
              referenceMode === 'refer_image'
                ? 'refer_image'
                : index === 0
                  ? 'first_frame'
                  : 'last_frame',
            url,
            id: `image_${index + 1}`,
          })),
        ],
        settings: {
          duration,
          resolution,
          audio,
          multi_shot: !!options.multiShot,
          ...(referenceMode === 'refer_image'
            ? { aspect_ratio: options.aspectRatio || '16:9' }
            : {}),
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
        settings:
          model.apiKind === 'turbo'
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
