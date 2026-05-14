export class CreateVideoDto {
  modelId!: number;
  // projectId!: number;
  // resolution để ghép vào prompt
  // '720p' | '1080p' | '2k' | '4k'
  resolution!: string;

  prompt!: string;
  negativePrompt?: string;

  // duration?: '5' | '10';
  duration?: string;
  mode?: 'std' | 'pro';
  sound?: 'on' | 'off';
  sceneNumber?: number;
  
}