import axios from 'axios';
import { KlingService } from './kling.service';

jest.mock('axios');

describe('KlingService', () => {
  const request = axios.request as jest.Mock;
  const service = new KlingService({ get: () => 'test-key' } as never, {} as never);

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

describe('Kling element creation', () => {
  const request = axios.request as jest.Mock;
  const repo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
  };
  const service = new KlingService({ get: () => 'test-key' } as never, repo as never);

  beforeEach(() => { request.mockReset(); repo.find.mockReset(); repo.findOne.mockReset(); repo.save.mockClear(); });

  it('sends ordered owned images using the Kling Element API', async () => {
    repo.find.mockResolvedValue([
      { id: 1, userId: 7, assetType: 'image', storedUrl: 'https://example.com/front.png' },
      { id: 2, userId: 7, assetType: 'image', storedUrl: 'https://example.com/side.png' },
    ]);
    request.mockResolvedValue({ data: { code: 0, data: { task_id: 'element-task', task_status: 'submitted' } } });
    await service.createElement(7, { name: 'Cat', description: 'Mascot', referenceType: 'image', mainAssetId: 1, additionalAssetIds: [2] });
    const call = request.mock.calls[0][0];
    expect(call.url).toBe('https://api-singapore.klingai.com/v1/general/advanced-custom-elements');
    expect(call.data.element_image_list).toEqual({ frontal_image: 'https://example.com/front.png', refer_images: [{ image_url: 'https://example.com/side.png' }] });
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, sourceType: 'reference' }));
  });

  it('rejects references that do not belong to the user', async () => {
    repo.find.mockResolvedValue([{ id: 1, userId: 7, assetType: 'image', storedUrl: 'https://example.com/front.png' }]);
    await expect(service.createElement(7, { name: 'Cat', description: 'Mascot', mainAssetId: 1, additionalAssetIds: [2] })).rejects.toThrow('Tài nguyên tham chiếu không hợp lệ');
    expect(request).not.toHaveBeenCalled();
  });

  it('creates a custom voice from a user-owned audio sample', async () => {
    repo.findOne.mockResolvedValue({ id: 3, userId: 7, assetType: 'audio', mimeType: 'audio/mpeg', storedUrl: 'https://example.com/voice.mp3', durationSeconds: 12 });
    request.mockResolvedValue({ data: { code: 0, data: { task_id: 'voice-task', task_status: 'submitted' } } });
    await service.createVoice(7, { name: 'MC Voice', sampleAssetId: 3 });
    expect(request.mock.calls[0][0]).toMatchObject({
      url: 'https://api-singapore.klingai.com/v1/general/custom-voices',
      data: { voice_name: 'MC Voice', voice_url: 'https://example.com/voice.mp3' },
    });
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, assetRole: 'voice', sourceType: 'reference' }));
  });

  it('does not submit a voice using another user’s sample', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.createVoice(7, { name: 'MC Voice', sampleAssetId: 3 })).rejects.toThrow('Mẫu giọng');
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects a voice sample shorter than five seconds', async () => {
    repo.findOne.mockResolvedValue({ id: 3, userId: 7, assetType: 'audio', mimeType: 'audio/mpeg', metadata: { mediaDurationSeconds: 4.8 } });
    await expect(service.createVoice(7, { name: 'MC Voice', sampleAssetId: 3 })).rejects.toThrow('5–30 giây');
    expect(request).not.toHaveBeenCalled();
  });

  it('updates a completed voice reference with the Kling Voice ID', async () => {
    const voice = { id: 9, assetRole: 'voice', metadata: { taskId: 'voice-task', status: 'processing' } };
    repo.find.mockResolvedValue([voice]);
    request.mockResolvedValue({ data: { code: 0, data: { task_status: 'succeed', task_result: { voices: [{ voice_id: 'voice-123', trial_url: 'https://example.com/preview.mp3' }] } } } });
    const result = await service.listReferences(7);
    expect(result.items[0].metadata).toMatchObject({ status: 'succeed', voiceId: 'voice-123', trialUrl: 'https://example.com/preview.mp3' });
  });
});
