// Output dimensions from BytePlus ModelArk's video generation API documentation.
// The ratio is width / height; portrait entries are listed separately because
// provider dimensions are rounded to supported pixel sizes.
const DIMENSIONS: Record<string, Record<string, [number, number]>> = {
  '2.0': {
    '480p:16:9': [864, 496],
    '480p:4:3': [752, 560],
    '480p:1:1': [640, 640],
    '480p:3:4': [560, 752],
    '480p:9:16': [496, 864],
    '480p:21:9': [992, 432],
    '720p:16:9': [1280, 720],
    '720p:4:3': [1112, 834],
    '720p:1:1': [960, 960],
    '720p:3:4': [834, 1112],
    '720p:9:16': [720, 1280],
    '720p:21:9': [1470, 630],
    '1080p:16:9': [1920, 1080],
    '1080p:4:3': [1664, 1248],
    '1080p:1:1': [1440, 1440],
    '1080p:3:4': [1248, 1664],
    '1080p:9:16': [1080, 1920],
    '1080p:21:9': [2206, 946],
    '4k:16:9': [3840, 2160],
    '4k:4:3': [3326, 2494],
    '4k:1:1': [2880, 2880],
    '4k:3:4': [2494, 3326],
    '4k:9:16': [2160, 3840],
    '4k:21:9': [4398, 1886],
  },
  '2.5': {
    '480p:16:9': [854, 480],
    '480p:4:3': [752, 560],
    '480p:1:1': [640, 640],
    '480p:3:4': [560, 752],
    '480p:9:16': [480, 854],
    '480p:21:9': [992, 432],
    '720p:16:9': [1280, 720],
    '720p:4:3': [1112, 834],
    '720p:1:1': [960, 960],
    '720p:3:4': [834, 1112],
    '720p:9:16': [720, 1280],
    '720p:21:9': [1470, 630],
    '1080p:16:9': [1920, 1080],
    '1080p:4:3': [1664, 1248],
    '1080p:1:1': [1440, 1440],
    '1080p:3:4': [1248, 1664],
    '1080p:9:16': [1080, 1920],
    '1080p:21:9': [2206, 946],
  },
};

const RATIOS: Record<string, number> = {
  '21:9': 21 / 9,
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '1:1': 1,
  '3:4': 3 / 4,
  '9:16': 9 / 16,
};

export function seedanceOutputDimensions(
  apiModel: string,
  resolution: string,
  requestedRatio: string,
  sourceAspectRatio?: number,
) {
  const version = apiModel.includes('seedance-2-5') ? '2.5' : '2.0';
  let ratio = requestedRatio;
  if (!ratio || ratio === 'adaptive') {
    ratio =
      Number.isFinite(sourceAspectRatio) && sourceAspectRatio! > 0
        ? Object.keys(RATIOS).reduce(
            (best, candidate) =>
              Math.abs(Math.log(RATIOS[candidate] / sourceAspectRatio!)) <
              Math.abs(Math.log(RATIOS[best] / sourceAspectRatio!))
                ? candidate
                : best,
            '16:9',
          )
        : '16:9';
  }
  const dimensions = DIMENSIONS[version][`${resolution}:${ratio}`];
  if (!dimensions) return null;
  return { width: dimensions[0], height: dimensions[1], ratio };
}

export function estimateSeedanceTokens(
  outputSeconds: number,
  inputVideoSeconds: number,
  width: number,
  height: number,
  fps = 24,
) {
  return ((outputSeconds + inputVideoSeconds) * width * height * fps) / 1024;
}
