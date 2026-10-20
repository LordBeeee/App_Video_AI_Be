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
      status: 'succeeded', content: { video_url: 'https://example.com/video.mp4' },
      usage: { completion_tokens: 108900 },
    } });
    await expect(service.getJob('task-1')).resolves.toMatchObject({
      status: 'succeeded', url: 'https://example.com/video.mp4', units: 108900,
    });
  });
});
