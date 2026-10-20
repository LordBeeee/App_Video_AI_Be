// BytePlus ModelArk: https://docs.byteplus.com/en/docs/modelark/create-video-generation-task-api
export const SEEDANCE_VIDEO_MODELS = [
  {
    id: 'seedance/seedance-2.5',
    name: 'Seedance: 2.5',
    provider: 'seedance',
    apiModel: 'dreamina-seedance-2-5-260628',
    modality: 'video',
    description: 'Tạo video từ ảnh đầu hoặc ảnh đầu/cuối, có thể tạo âm thanh.',
    capabilities: {
      resolutions: ['480p', '720p', '1080p'],
      durations: Array.from({ length: 27 }, (_, i) => i + 4),
      frameImages: ['first_frame', 'last_frame'],
      maxReferenceImages: 2,
      requiresImage: true,
      generateAudio: true,
      maxImageMb: 10,
      maxPromptCharacters: 2500,
    },
    pricing: {
      unitType: 'output_token',
      source: 'https://docs.byteplus.com/en/docs/modelark/model-pricing',
      perMillionTokens: { '480p': 10.7, '720p': 10.7, '1080p': 11.7 },
    },
  },
] as const;
