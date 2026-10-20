// Direct Kling video catalog. API unit rates: https://kling.ai/dev/pricing
export const KLING_VIDEO_MODELS = [
  {
    id: 'kling/kling-3.0-turbo',
    name: 'Kling: 3.0 Turbo',
    provider: 'kling',
    apiModel: 'kling-3.0-turbo',
    apiKind: 'turbo',
    modality: 'video',
    description: 'Tạo video từ ảnh đầu, tối ưu tốc độ và chi phí.',
    capabilities: {
      resolutions: ['720p', '1080p'],
      durations: Array.from({ length: 13 }, (_, i) => i + 3),
      frameImages: ['first_frame'],
      maxReferenceImages: 1,
      requiresImage: true,
      generateAudio: false,
      nativeAudioIncluded: true,
      maxImageMb: 50,
      maxPromptCharacters: 2500,
    },
    pricing: {
      unitType: 'api_unit',
      source: 'kling_api_pricing',
      perSecond: {
        '720p': { includedAudio: 0.8 },
        '1080p': { includedAudio: 1 },
      },
    },
  },
  {
    id: 'kling/kling-3.0',
    name: 'Kling: 3.0',
    provider: 'kling',
    apiModel: 'kling-3.0',
    apiKind: 'standard',
    modality: 'video',
    description: 'Ảnh đầu/cuối, âm thanh và nhiều cảnh.',
    capabilities: {
      resolutions: ['720p', '1080p', '4k'],
      durations: Array.from({ length: 13 }, (_, i) => i + 3),
      frameImages: ['first_frame', 'last_frame'],
      maxReferenceImages: 2,
      requiresImage: true,
      generateAudio: true,
      multiShot: true,
      maxImageMb: 50,
      maxPromptCharacters: 3072,
    },
    pricing: {
      unitType: 'api_unit',
      source: 'kling_api_pricing',
      perSecond: {
        '720p': { noAudio: 0.6, withAudio: 0.9 },
        '1080p': { noAudio: 0.8, withAudio: 1.2 },
        '4k': { noAudio: 3, withAudio: 3 },
      },
    },
  },
  {
    id: 'kling/kling-3.0-omni',
    name: 'Kling: 3.0 Omni',
    provider: 'kling',
    apiModel: 'kling-v3-omni',
    apiKind: 'omni_new',
    modality: 'video',
    description: 'Nhiều ảnh tham chiếu và điều khiển bằng prompt.',
    capabilities: {
      resolutions: ['720p', '1080p', '4k'],
      aspectRatios: ['16:9', '9:16', '1:1'],
      durations: Array.from({ length: 13 }, (_, i) => i + 3),
      frameImages: ['first_frame', 'last_frame', 'refer_image'],
      referenceModes: ['first_frame', 'refer_image'],
      referenceVideos: ['feature_video', 'base_video'],
      maxReferenceImages: 7,
      requiresImage: false,
      generateAudio: true,
      multiShot: true,
      maxImageMb: 50,
      maxPromptCharacters: 3072,
    },
    pricing: {
      unitType: 'api_unit',
      source: 'kling_api_pricing',
      perSecond: {
        '720p': { noAudio: 0.6, withAudio: 0.8, withVideo: 0.9 },
        '1080p': { noAudio: 0.8, withAudio: 1, withVideo: 1.2 },
        '4k': { noAudio: 3, withAudio: 3, withVideo: 3 },
      },
    },
  },
] as const;

export function klingVideoModel(id: string) {
  return KLING_VIDEO_MODELS.find((model) => model.id === id);
}

export function formatKlingShots(
  shots: { prompt: string; duration: number }[],
) {
  return shots
    .map(
      (shot, index) =>
        `shot ${index + 1}, ${shot.duration}, ${shot.prompt.trim()};`,
    )
    .join(' ');
}
