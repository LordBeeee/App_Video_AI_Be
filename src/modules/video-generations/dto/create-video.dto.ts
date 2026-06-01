export class CreateVideoDto {
  modelId!: number;
  resolution!: string;

  prompt!: string;
  negativePrompt?: string;

  duration?: string;
  mode?: 'std' | 'pro' | '4k';
  sound?: 'on' | 'off';
  sceneNumber?: number;
  cost?: number;
}

export class CreateMotionControlVideoDto {
  modelId!: number;

  prompt?: string;
  negativePrompt?: string;

  // 'image': khớp hướng theo ảnh nhân vật (max video ref 10s)
  // 'video': khớp hướng theo video ref (max 30s)
  characterOrientation!: 'image' | 'video';

  keepOriginalSound?: 'yes' | 'no';

  mode?: 'std' | 'pro';

  sceneNumber?: number;
  cost?: number;
}