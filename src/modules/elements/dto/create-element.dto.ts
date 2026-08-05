export class CreateElementDto {
  providerId!: number;
  referenceType!: 'image_refer' | 'video_refer';
  elementName!: string;         // ≤ 20 ký tự
  elementDescription!: string;  // ≤ 100 ký tự
  elementVoiceId?: string;      // chỉ hợp lệ khi referenceType = image_refer

  // reuse asset có sẵn (chọn từ History)
  frontalImageAssetId?: number;
  referImageAssetIds?: number[];
  videoAssetId?: number;
}