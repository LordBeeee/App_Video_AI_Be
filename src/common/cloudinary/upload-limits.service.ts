import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';

const MB = 1_000_000;
const TTL_MS = 60 * 60 * 1000;

export type UploadLimits = { image: number; video: number; audio: number };

@Injectable()
export class UploadLimitsService {
  private readonly logger = new Logger(UploadLimitsService.name);
  private cached: UploadLimits | null = null;
  private expiresAt = 0;
  private pending: Promise<UploadLimits> | null = null;

  constructor(private readonly config: ConfigService) {}

  private fallback(): UploadLimits {
    const value = (key: string, defaultMb: number) => {
      const configured = Number(this.config.get(key));
      return Number.isFinite(configured) && configured > 0
        ? Math.floor(configured * MB)
        : defaultMb * MB;
    };
    return {
      image: value('CLOUDINARY_FALLBACK_IMAGE_MB', 10),
      video: value('CLOUDINARY_FALLBACK_VIDEO_MB', 100),
      audio: value('CLOUDINARY_FALLBACK_AUDIO_MB', 100),
    };
  }

  async getLimits(): Promise<UploadLimits> {
    if (this.cached && Date.now() < this.expiresAt) return this.cached;
    if (this.pending) return this.pending;
    this.pending = this.refresh();
    try {
      return await this.pending;
    } finally {
      this.pending = null;
    }
  }

  private async refresh(): Promise<UploadLimits> {
    try {
      const usage = await cloudinary.api.usage();
      const media = (usage as any).media_limits || {};
      const fallback = this.fallback();
      const normalized = (raw: unknown, defaultBytes: number, maxBytes: number) => {
        const bytes = Number(raw);
        if (!Number.isFinite(bytes) || bytes <= 0) return Math.min(defaultBytes, maxBytes);
        // Cloudinary reports MiB; show and enforce whole decimal 10 MB steps.
        return Math.min(maxBytes, Math.max(MB, Math.floor(bytes / (10 * MB)) * 10 * MB));
      };
      const video = normalized(media.video_max_size_bytes, fallback.video, 200 * MB);
      this.cached = {
        image: normalized(media.image_max_size_bytes, fallback.image, 200 * MB),
        video,
        audio: Math.min(video, 200 * MB),
      };
    } catch (error) {
      this.logger.warn(`Không đọc được giới hạn Cloudinary: ${error instanceof Error ? error.message : String(error)}`);
      this.cached = this.fallback();
    }
    this.expiresAt = Date.now() + TTL_MS;
    return this.cached!;
  }
}
