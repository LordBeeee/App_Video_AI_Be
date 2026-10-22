// Google Cloud Veo model capabilities and public Agent Platform pricing.
export const VEO_VIDEO_MODELS = [
  {
    id: 'google/veo-3.1',
    name: 'Veo: 3.1',
    provider: 'veo',
    apiModel: 'veo-3.1-generate-001',
    modality: 'video',
    description: 'Tạo video từ ảnh đầu và ảnh cuối tùy chọn.',
    capabilities: {
      resolutions: ['720p', '1080p', '4k'],
      durations: [4, 6, 8],
      aspectRatios: ['16:9', '9:16'],
      maxReferenceImages: 2,
      requiresImage: true,
      generateAudio: true,
      maxImageMb: 20,
      maxPromptCharacters: 2500,
    },
    pricing: {
      unitType: 'video_second',
      source:
        'https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing',
      perSecond: {
        '720p': { noAudio: 0.2, withAudio: 0.4 },
        '1080p': { noAudio: 0.2, withAudio: 0.4 },
        '4k': { noAudio: 0.4, withAudio: 0.6 },
      },
    },
  },
  {
    id: 'google/veo-3.1-fast',
    name: 'Veo: 3.1 Fast',
    provider: 'veo',
    apiModel: 'veo-3.1-fast-generate-001',
    modality: 'video',
    description: 'Tạo video nhanh từ ảnh đầu và ảnh cuối tùy chọn.',
    capabilities: {
      resolutions: ['720p', '1080p'],
      durations: [4, 6, 8],
      aspectRatios: ['16:9', '9:16'],
      maxReferenceImages: 2,
      requiresImage: true,
      generateAudio: true,
      maxImageMb: 20,
      maxPromptCharacters: 2500,
    },
    pricing: {
      unitType: 'video_second',
      source:
        'https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing',
      perSecond: {
        '720p': { noAudio: 0.08, withAudio: 0.1 },
        '1080p': { noAudio: 0.1, withAudio: 0.12 },
      },
    },
  },
] as const;
