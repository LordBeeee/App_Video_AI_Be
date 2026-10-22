import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import jwt from 'jsonwebtoken';

type VeoJob = {
  status: string;
  buffer?: Buffer;
  error?: string;
  url?: string;
  units?: number;
  costUsd?: number;
};
type VeoOptions = {
  referenceMode?: string;
  duration?: number;
  aspectRatio?: string;
  resolution?: string;
  generateAudio?: boolean;
};
type VeoOperation = {
  name?: string;
  done?: boolean;
  error?: { message?: string };
  response?: { videos?: { bytesBase64Encoded?: string; gcsUri?: string }[] };
};

@Injectable()
export class VeoService {
  private readonly baseUrl = 'https://us-central1-aiplatform.googleapis.com/v1';
  private token?: { value: string; expiresAt: number };

  constructor(private readonly config: ConfigService) {}

  private errorMessage(error: unknown, fallback: string) {
    if (axios.isAxiosError(error)) {
      const data = error.response?.data as
        | {
            error_description?: string;
            error?: { message?: string };
            message?: string;
          }
        | undefined;
      return (
        data?.error_description ||
        data?.error?.message ||
        data?.message ||
        error.message
      );
    }
    return error instanceof Error ? error.message : fallback;
  }

  private credentials() {
    const projectId = this.config.get<string>('GOOGLE_CLOUD_PROJECT_ID');
    const raw = this.config.get<string>('GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON');
    if (!projectId || !raw) {
      throw new BadRequestException('Chưa cấu hình Google Cloud cho Veo');
    }
    try {
      const account = JSON.parse(raw) as {
        client_email?: string;
        private_key?: string;
      };
      if (!account.client_email || !account.private_key) throw new Error();
      return { projectId, account };
    } catch {
      throw new BadRequestException(
        'GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON không hợp lệ',
      );
    }
  }

  private async accessToken() {
    if (this.token && this.token.expiresAt > Date.now() + 60_000)
      return this.token.value;
    const { account } = this.credentials();
    const assertion = jwt.sign(
      { scope: 'https://www.googleapis.com/auth/cloud-platform' },
      account.private_key!,
      {
        algorithm: 'RS256',
        issuer: account.client_email,
        audience: 'https://oauth2.googleapis.com/token',
        expiresIn: '1h',
      },
    );
    try {
      const response = await axios.post<{
        access_token: string;
        expires_in: number;
      }>(
        'https://oauth2.googleapis.com/token',
        new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }),
        { timeout: 20_000 },
      );
      this.token = {
        value: response.data.access_token,
        expiresAt: Date.now() + response.data.expires_in * 1000,
      };
      return this.token.value;
    } catch (error: unknown) {
      throw new BadGatewayException(
        this.errorMessage(error, 'Không xác thực được Google Cloud'),
      );
    }
  }

  private modelPath(model: string) {
    if (
      !['veo-3.1-generate-001', 'veo-3.1-fast-generate-001'].includes(model)
    ) {
      throw new BadRequestException('Model Veo không hợp lệ');
    }
    const { projectId } = this.credentials();
    return `projects/${projectId}/locations/us-central1/publishers/google/models/${model}`;
  }

  private async request<T>(
    model: string,
    method: 'predictLongRunning' | 'fetchPredictOperation',
    data: unknown,
  ) {
    try {
      const response = await axios.post<T>(
        `${this.baseUrl}/${this.modelPath(model)}:${method}`,
        data,
        {
          headers: { Authorization: `Bearer ${await this.accessToken()}` },
          timeout: 120_000,
        },
      );
      return response.data;
    } catch (error: unknown) {
      if (
        error instanceof BadRequestException ||
        error instanceof BadGatewayException
      )
        throw error;
      throw new BadGatewayException(
        this.errorMessage(error, 'Google Veo request failed'),
      );
    }
  }

  private async image(url: string) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('URL ảnh Veo không hợp lệ');
    }
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname !== 'res.cloudinary.com'
    ) {
      throw new BadRequestException(
        'Ảnh Veo phải được lưu trong thư viện Cloudinary',
      );
    }
    const response = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 30_000,
      maxContentLength: 20 * 1024 * 1024,
      maxRedirects: 0,
    });
    const bytes = Buffer.from(response.data);
    if (bytes.length > 20 * 1024 * 1024)
      throw new BadRequestException('Ảnh Veo vượt 20 MB');
    const mimeType = bytes
      .subarray(0, 3)
      .equals(Buffer.from([0xff, 0xd8, 0xff]))
      ? 'image/jpeg'
      : bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? 'image/png'
        : null;
    if (!mimeType)
      throw new BadRequestException('Veo chỉ hỗ trợ ảnh JPEG hoặc PNG');
    return { bytesBase64Encoded: bytes.toString('base64'), mimeType };
  }

  async submit(
    prompt: string,
    options: VeoOptions,
    references: string[],
    model: string,
  ) {
    if (options.referenceMode && options.referenceMode !== 'first_frame') {
      throw new BadRequestException('Veo chỉ hỗ trợ ảnh đầu và ảnh cuối');
    }
    if (references.length < 1 || references.length > 2) {
      throw new BadRequestException('Veo cần ảnh đầu và tối đa một ảnh cuối');
    }
    const images = await Promise.all(references.map((url) => this.image(url)));
    const instance = {
      prompt,
      image: images[0],
      ...(images[1] ? { lastFrame: images[1] } : {}),
    };
    const result = await this.request<{ name?: string }>(
      model,
      'predictLongRunning',
      {
        instances: [instance],
        parameters: {
          sampleCount: 1,
          durationSeconds: Number(options.duration),
          aspectRatio: options.aspectRatio,
          resolution: options.resolution,
          generateAudio: !!options.generateAudio,
        },
      },
    );
    if (!result.name)
      throw new BadGatewayException('Google Veo không trả về mã tác vụ');
    return { id: result.name, status: 'pending' };
  }

  async getJob(operationName: string, model: string): Promise<VeoJob> {
    if (!operationName.startsWith(`${this.modelPath(model)}/operations/`)) {
      throw new BadRequestException('Mã tác vụ Veo không hợp lệ');
    }
    const result = await this.request<VeoOperation>(
      model,
      'fetchPredictOperation',
      {
        operationName,
      },
    );
    if (!result.done) return { status: 'processing' };
    if (result.error)
      return {
        status: 'failed',
        error: result.error.message || 'Veo thất bại',
      };
    const video = result.response?.videos?.[0];
    if (!video) return { status: 'failed', error: 'Veo không trả về video' };
    if (video.bytesBase64Encoded) {
      return {
        status: 'succeeded',
        buffer: Buffer.from(video.bytesBase64Encoded, 'base64'),
      };
    }
    if (video.gcsUri) {
      return {
        status: 'failed',
        error: 'Veo trả về GCS URI nhưng chưa cấu hình lưu Cloud Storage',
      };
    }
    return { status: 'failed', error: 'Định dạng phản hồi Veo không hợp lệ' };
  }
}
