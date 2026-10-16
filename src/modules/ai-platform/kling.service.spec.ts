import axios from 'axios';
import { KlingService } from './kling.service';

jest.mock('axios');

describe('KlingService', () => {
  const request = axios.request as jest.Mock;
  const service = new KlingService({ get: () => 'test-key' } as never);

  beforeEach(() => request.mockReset());

  it('submits Kling 3.0 with ordered first and last frames', async () => {
    request.mockResolvedValue({
      data: { code: 0, data: { id: 'job-1', status: 'submitted' } },
    });
    await service.submit(
      'kling/kling-3.0',
      'move forward',
      { duration: 5, resolution: '1080p' },
      ['https://example.com/first.png', 'https://example.com/last.png'],
    );
    const config = request.mock.calls[0][0];
    expect(config.url).toBe(
      'https://api-singapore.klingai.com/image-to-video/kling-3.0',
    );
    expect(config.data.contents.map((item: any) => item.type)).toEqual([
      'prompt',
      'first_frame',
      'last_frame',
    ]);
  });

  it('submits O1 to Kling Omni Video with image references', async () => {
    request.mockResolvedValue({
      data: { code: 0, data: { task_id: 'job-2', task_status: 'submitted' } },
    });
    await service.submit(
      'kling/kling-o1',
      'wave',
      { duration: 5, resolution: '720p' },
      ['https://example.com/one.png'],
    );
    const config = request.mock.calls[0][0];
    expect(config.url).toBe(
      'https://api-singapore.klingai.com/v1/videos/omni-video',
    );
    expect(config.data.model_name).toBe('kling-video-o1');
    expect(config.data.image_list[0].type).toBe('first_frame');
    expect(config.data.prompt).toBe('wave');
  });

  it('submits 3.0 Omni to the current API with typed reference images', async () => {
    request.mockResolvedValue({ data: { code: 0, data: { id: 'omni-1', status: 'submitted' } } });
    await service.submit('kling/kling-3.0-omni', 'a red dress', {
      duration: 5, resolution: '4k', referenceMode: 'refer_image', generateAudio: true,
    }, ['https://example.com/look.png']);
    const config = request.mock.calls[0][0];
    expect(config.url).toBe('https://api-singapore.klingai.com/omni-video/kling-3.0-omni');
    expect(config.data.contents[1]).toEqual({ type: 'refer_image', url: 'https://example.com/look.png', id: 'image_1' });
    expect(config.data.settings).toMatchObject({ resolution: '4k', audio: 'native', aspect_ratio: '16:9' });
  });

  it('does not send unsupported audio and multi-shot settings to Turbo', async () => {
    request.mockResolvedValue({ data: { code: 0, data: { id: 'turbo-1', status: 'submitted' } } });
    await service.submit('kling/kling-3.0-turbo', 'move', { duration: 5, resolution: '720p' }, ['https://example.com/first.png']);
    expect(request.mock.calls[0][0].data.settings).toEqual({ duration: 5, resolution: '720p' });
  });

  it('reads a completed task from the new Kling task API', async () => {
    request.mockResolvedValue({
      data: {
        code: 0,
        data: [
          {
            status: 'succeeded',
            outputs: [{ type: 'video', url: 'https://example.com/result.mp4' }],
          },
        ],
      },
    });
    await expect(
      service.getJob('kling/kling-3.0', 'job-1'),
    ).resolves.toMatchObject({
      status: 'succeeded',
      url: 'https://example.com/result.mp4',
    });
  });
});
