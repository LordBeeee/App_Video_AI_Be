import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import * as streamifier from 'streamifier';

@Injectable()
export class CloudinaryService {
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
          if (error) return reject(error);
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
          if (error) return reject(error);
          resolve(result!.secure_url);
        },
      );
    });
  }
}