import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import * as streamifier from 'streamifier';

@Injectable()
export class CloudinaryService {
  private uploadError(error: { message?: string }) {
    return new BadGatewayException(`Cloudinary: ${error.message || 'Tải file lên thất bại. Vui lòng thử lại.'}`);
  }

  constructor(private configService: ConfigService) {
    cloudinary.config({
      cloud_name: this.configService.getOrThrow('CLOUDINARY_CLOUD_NAME'),
      api_key: this.configService.getOrThrow('CLOUDINARY_API_KEY'),
      api_secret: this.configService.getOrThrow('CLOUDINARY_API_SECRET'),
    });
  }

  /**
   * Upload buffer lên Cloudinary
   * @param buffer  - file buffer từ multer
   * @param folder  - đường dẫn folder, vd: "ai-generation/users/1/projects/2/scenes/scene-1/images/begin"
   * @param publicId - tên file (không cần extension)
   */
  uploadBuffer(
    buffer: Buffer,
    folder: string,
    publicId?: string,
  ): Promise<UploadApiResponse> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          public_id: publicId,
          resource_type: 'image',
        },
        (error, result) => {
          if (error) return reject(this.uploadError(error));
          resolve(result!);
        },
      );

      streamifier.createReadStream(buffer).pipe(uploadStream);
    });
  }
  // Upload video từ URL (không cần download về, Cloudinary fetch trực tiếp)
  uploadVideoFromUrl(
    url: string,
    folder: string,
    publicId?: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      cloudinary.uploader.upload(
        url,
        {
          folder,
          public_id: publicId,
          resource_type: 'video',
        },
        (error, result) => {
          if (error) return reject(this.uploadError(error));
          resolve(result!.secure_url);
        },
      );
    });
  }

  uploadAudioBuffer(
    buffer: Buffer,
    folder: string,
    publicId: string,
  ): Promise<{ secureUrl: string; durationSeconds: number | null; fileSizeBytes: number | null }> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder, public_id: publicId, resource_type: 'video', format: 'mp3' },
        (error, result) => {
          if (error) return reject(this.uploadError(error));
          resolve({
            secureUrl: result!.secure_url,
            durationSeconds: result!.duration ?? null,
            fileSizeBytes: result!.bytes ?? null,
          });
        },
      );
      streamifier.createReadStream(buffer).pipe(uploadStream);
    });
  }

  // async uploadVideoBuffer(
  //   buffer: Buffer,
  //   folder: string,
  //   publicId: string,
  // ): Promise<{
  //   secure_url: string;
  //   public_id: string;
  //   duration?: number;
  //   width?: number;
  //   height?: number;
  //   frame_rate?: number;
  // }> {
  //   return new Promise((resolve, reject) => {
  //     const uploadStream = cloudinary.uploader.upload_stream(
  //       {
  //         folder,
  //         public_id: publicId,
  //         resource_type: 'video',
  //       },
  //       (error, result) => {
  //         if (error) return reject(error);
  //         resolve({
  //           secure_url: result!.secure_url,
  //           public_id: result!.public_id,
  //           duration: result!.duration,
  //           width: result!.width,
  //           height: result!.height,
  //           frame_rate: (result as any)!.frame_rate,
  //         });
  //       },
  //     );

  //     streamifier.createReadStream(buffer).pipe(uploadStream);
  //   });
  // }
  async uploadVideoBuffer(
    buffer: Buffer,
    folder: string,
    publicId: string,
  ): Promise<{
    secure_url: string;
    public_id: string;
    duration?: number;
    width?: number;
    height?: number;
    frame_rate?: number;
    thumbnail_url: string;
    bytes?: number;
  }> {
    return new Promise((resolve, reject) => {
      const uploadStream = buffer.length > 100_000_000
        ? cloudinary.uploader.upload_chunked_stream(
          { folder, public_id: publicId, resource_type: 'video', chunk_size: 20_000_000 },
          (error, result) => {
            if (error) return reject(this.uploadError(error));
            if (!result || (result as any).done === false) return;
            resolve(this.videoUploadResult(result));
          },
        )
        : cloudinary.uploader.upload_stream(
        {
          folder,
          public_id: publicId,
          resource_type: 'video',
        },
        (error, result) => {
          if (error) return reject(this.uploadError(error));
          resolve(this.videoUploadResult(result!));
        },
      );

      streamifier.createReadStream(buffer).pipe(uploadStream);
    });
  }

  private videoUploadResult(result: UploadApiResponse) {
    return {
      secure_url: result.secure_url,
      public_id: result.public_id,
      duration: result.duration,
      width: result.width,
      height: result.height,
      frame_rate: (result as any).frame_rate,
      thumbnail_url: cloudinary.url(result.public_id, {
        resource_type: 'video', format: 'jpg', transformation: [{ start_offset: '0' }],
      }),
      bytes: result.bytes,
    };
  }
}
