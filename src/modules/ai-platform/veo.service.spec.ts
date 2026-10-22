import { VeoService } from './veo.service';

describe('VeoService request mapping', () => {
  const service = new VeoService({ get: jest.fn(() => 'project-1') } as never);
  const image = { bytesBase64Encoded: 'aW1hZ2U=', mimeType: 'image/png' };

  beforeEach(() => jest.restoreAllMocks());

  it('uses the first and optional last frame without referenceImages', async () => {
    jest.spyOn(service as any, 'image').mockResolvedValue(image);
    const request = jest
      .spyOn(service as any, 'request')
      .mockResolvedValue({ name: 'operation-1' });
    await service.submit(
      'A moving flower',
      {
        referenceMode: 'first_frame',
        duration: 6,
        aspectRatio: '16:9',
        resolution: '720p',
        generateAudio: false,
      },
      ['https://example.com/first.png', 'https://example.com/last.png'],
      'veo-3.1-generate-001',
    );
    expect(request).toHaveBeenCalledWith(
      'veo-3.1-generate-001',
      'predictLongRunning',
      expect.objectContaining({
        instances: [{ prompt: 'A moving flower', image, lastFrame: image }],
      }),
    );
  });

  it('rejects reference image mode', async () => {
    await expect(
      service.submit(
        'A moving flower',
        { referenceMode: 'refer_image', duration: 8 },
        ['https://example.com/ref.png'],
        'veo-3.1-fast-generate-001',
      ),
    ).rejects.toThrow('Veo chỉ hỗ trợ ảnh đầu và ảnh cuối');
  });
});
