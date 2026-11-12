import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosRequestConfig } from 'axios';

@Injectable()
export class OpenRouterService {
  private readonly logger = new Logger(OpenRouterService.name);
  private readonly baseUrl = 'https://openrouter.ai/api/v1';

  constructor(private readonly config: ConfigService) {}

  private get headers() {
    const apiKey = this.config.getOrThrow<string>('OPENROUTER_API_KEY');
    return {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer':
        this.config.get<string>('APP_URL') || 'http://localhost:5173',
      'X-Title': this.config.get<string>('APP_NAME') || 'AI Studio',
    };
  }

  private async request<T>(config: AxiosRequestConfig): Promise<T> {
    try {
      const response = await axios.request<T>({
        baseURL: this.baseUrl,
        timeout: 120_000,
        ...config,
        headers: { ...this.headers, ...(config.headers || {}) },
      });
      return response.data;
    } catch (error: any) {
      const message =
        error.response?.data?.error?.message ||
        error.response?.data?.message ||
        error.message ||
        'OpenRouter request failed';
      this.logger.error(`${config.method || 'GET'} ${config.url}: ${message}`);
      throw new BadGatewayException(message);
    }
  }

  listModels(outputModality = 'text') {
    return this.request<any>({
      method: 'GET',
      url: '/models',
      params: {
        output_modalities: outputModality,
        ...(outputModality === 'text'
          ? { endpoints: '/api/v1/chat/completions' }
          : {}),
      },
    });
  }

  listImageModels() {
    return this.request<any>({ method: 'GET', url: '/images/models' });
  }

  getImageModelEndpoints(path: string) {
    return this.request<any>({
      method: 'GET',
      url: path.replace('/api/v1', ''),
    });
  }

  generateImage(body: Record<string, any>) {
    return this.request<any>({ method: 'POST', url: '/images', data: body });
  }

  private pcmToWav(data: Buffer, contentType: string) {
    const rate = Number(contentType.match(/(?:^|;)\s*rate=(\d+)/i)?.[1] || 24000);
    const channels = Number(contentType.match(/(?:^|;)\s*channels=(\d+)/i)?.[1] || 1);
    if (!data.length || rate < 8000 || rate > 192000 || channels < 1 || channels > 2 ||
        data.length % (channels * 2) !== 0) {
      throw new BadGatewayException('Dữ liệu âm thanh PCM không hợp lệ');
    }
    // Speech PCM is signed 16-bit little-endian; WAV lets the existing
    // Cloudinary uploader detect the audio and transcode it to MP3.
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + data.length, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(rate, 24);
    header.writeUInt32LE(rate * channels * 2, 28);
    header.writeUInt16LE(channels * 2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(data.length, 40);
    return Buffer.concat([header, data]);
  }

  async generateSpeech(body: Record<string, any>) {
    try {
      const response = await axios.post<ArrayBuffer>(
        `${this.baseUrl}/audio/speech`,
        body,
        {
          headers: this.headers,
          responseType: 'arraybuffer',
          timeout: 120_000,
        },
      );
      const data = Buffer.from(response.data);
      return {
        ...response,
        data: body.response_format === 'pcm'
          ? this.pcmToWav(data, String(response.headers['content-type'] || ''))
          : data,
      };
    } catch (error: any) {
      const raw = error.response?.data;
      const message = Buffer.isBuffer(raw)
        ? raw.toString('utf8')
        : error.message;
      throw new BadGatewayException(message || 'Không thể tạo giọng nói');
    }
  }

  getGeneration(id: string) {
    return this.request<any>({
      method: 'GET',
      url: '/generation',
      params: { id },
    });
  }

  async streamChat(body: Record<string, any>) {
    try {
      return await axios.post(`${this.baseUrl}/chat/completions`, body, {
        headers: this.headers,
        responseType: 'stream',
        timeout: 0,
      });
    } catch (error: any) {
      throw new BadGatewayException(
        error.response?.data?.error?.message || error.message,
      );
    }
  }
}
