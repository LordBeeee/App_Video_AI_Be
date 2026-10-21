import axios from 'axios';
import { SeedanceService } from './seedance.service';

describe('SeedanceService image-to-video API', () => {
  const service = new SeedanceService({ get: () => 'test-key' } as never);

  afterEach(() => jest.restoreAllMocks());

  it('submits ordered first and last frames to BytePlus', async () => {
    const request = jest.spyOn(axios, 'request').mockResolvedValue({
      data: { id: 'task-1', status: 'queued' },
    });
    const job = await service.submit('The camera moves forward',
      { duration: 5, resolution: '720p', generateAudio: false },
      ['https://example.com/start.png', 'https://example.com/end.png']);

    expect(job).toEqual({ id: 'task-1', status: 'queued' });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      url: 'https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks',
      data: expect.objectContaining({
        model: 'dreamina-seedance-2-5-260628',
        ratio: 'adaptive',
        generate_audio: false,
        watermark: false,
        draft: false,
        return_last_frame: true,
        content: [
          { type: 'text', text: 'The camera moves forward' },
          { type: 'image_url', image_url: { url: 'https://example.com/start.png' }, role: 'first_frame' },
          { type: 'image_url', image_url: { url: 'https://example.com/end.png' }, role: 'last_frame' },
        ],
      }),
    }));
  });

  it('reads the video URL and actual output tokens', async () => {
    jest.spyOn(axios, 'request').mockResolvedValue({ data: {
      status: 'succeeded', content: {
        video_url: 'https://example.com/video.mp4',
        last_frame_url: 'https://example.com/last.jpg',
      },
      usage: { completion_tokens: 108900 },
    } });
    await expect(service.getJob('task-1')).resolves.toMatchObject({
      status: 'succeeded', url: 'https://example.com/video.mp4',
      lastFrameUrl: 'https://example.com/last.jpg', units: 108900,
    });
  });

  it('submits Omni references with their roles and selected task constraints', async () => {
    const request = jest.spyOn(axios, 'request').mockResolvedValue({
      data: { id: 'omni-1', status: 'queued' },
    });
    await service.submitOmni('Replace the sky in @video_2 using @image_1 and @audio_3', {
      omniTaskType: 'edit', duration: -1, resolution: '720p',
      aspectRatio: 'adaptive', generateAudio: false,
      referenceInputs: [
        { assetId: 1, type: 'reference_image', url: 'https://example.com/image.jpg' },
        { assetId: 2, type: 'reference_video', url: 'https://example.com/video.mp4' },
        { assetId: 3, type: 'reference_audio', url: 'https://example.com/audio.mp3' },
      ],
    });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        omni_reference_task_type: 'edit', duration: -1, ratio: 'adaptive',
        watermark: false, draft: false, return_last_frame: true,
        content: [
          { type: 'text', text: 'Replace the sky in @Video 1 using @Image 1 and @Audio 1' },
          { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' }, role: 'reference_image' },
          { type: 'video_url', video_url: { url: 'https://example.com/video.mp4' }, role: 'reference_video' },
          { type: 'audio_url', audio_url: { url: 'https://example.com/audio.mp3' }, role: 'reference_audio' },
        ],
      }),
    }));
  });

  it('allows a chosen ratio for Omni reference generation', async () => {
    const request = jest.spyOn(axios, 'request').mockResolvedValue({
      data: { id: 'omni-2', status: 'queued' },
    });
    await service.submitOmni('A moving landscape', {
      omniTaskType: 'reference', duration: 5, resolution: '480p',
      aspectRatio: '16:9', referenceInputs: [
        { assetId: 4, type: 'reference_image', url: 'https://example.com/landscape.png' },
      ],
    });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ omni_reference_task_type: 'reference', ratio: '16:9', duration: 5 }),
    }));
  });

  it('submits Seedance 2.0 frames with the selected model and ratio', async () => {
    const request = jest.spyOn(axios, 'request').mockResolvedValue({ data: { id: 'frame-2' } });
    await service.submit('A moving landscape', { duration: 5, resolution: '4k', aspectRatio: '16:9' },
      ['https://example.com/frame.png'], 'dreamina-seedance-2-0-260128');
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      model: 'dreamina-seedance-2-0-260128', ratio: '16:9', resolution: '4k',
    }) }));
  });

  it('omits the 2.5 task hint when submitting Seedance 2.0 Omni', async () => {
    const request = jest.spyOn(axios, 'request').mockResolvedValue({ data: { id: 'omni-2' } });
    await service.submitOmni('Extend @video_1', {
      omniTaskType: 'extend', duration: 5, resolution: '720p', aspectRatio: '16:9',
      referenceInputs: [{ assetId: 1, type: 'reference_video', url: 'https://example.com/video.mp4' }],
    }, 'dreamina-seedance-2-0-260128');
    const data = request.mock.calls[0][0].data as Record<string, any>;
    expect(data).toMatchObject({ model: 'dreamina-seedance-2-0-260128', ratio: '16:9' });
    expect(data).not.toHaveProperty('omni_reference_task_type');
    expect(data).not.toHaveProperty('draft');
  });
});
