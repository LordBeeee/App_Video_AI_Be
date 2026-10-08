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
      params: { output_modalities: outputModality },
    });
  }

  listImageModels() {
    return this.request<any>({ method: 'GET', url: '/images/models' });
  }

  listVideoModels() {
    return this.request<any>({ method: 'GET', url: '/videos/models' });
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

  async generateSpeech(body: Record<string, any>) {
    try {
      return await axios.post<ArrayBuffer>(
        `${this.baseUrl}/audio/speech`,
        body,
        {
          headers: this.headers,
          responseType: 'arraybuffer',
          timeout: 120_000,
        },
      );
    } catch (error: any) {
      const raw = error.response?.data;
      const message = Buffer.isBuffer(raw)
        ? raw.toString('utf8')
        : error.message;
      throw new BadGatewayException(message || 'Không thể tạo giọng nói');
    }
  }

  submitVideo(body: Record<string, any>) {
    return this.request<any>({ method: 'POST', url: '/videos', data: body });
  }

  getVideoJob(pollingUrl: string) {
    const url = pollingUrl.startsWith('http')
      ? pollingUrl.replace(this.baseUrl, '')
      : pollingUrl.replace('/api/v1', '');
    return this.request<any>({ method: 'GET', url });
  }

  async downloadVideo(jobId: string, sourceUrl?: string): Promise<Buffer> {
    const url = sourceUrl || `${this.baseUrl}/videos/${jobId}/content?index=0`;
    const response = await axios.get<ArrayBuffer>(url, {
      headers: this.headers,
      responseType: 'arraybuffer',
      timeout: 180_000,
      maxRedirects: 5,
    });
    return Buffer.from(response.data);
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
