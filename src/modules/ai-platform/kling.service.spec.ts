import axios from 'axios';
import { KlingService } from './kling.service';

jest.mock('axios');

describe('KlingService', () => {
  const request = axios.request as jest.Mock;
  const service = new KlingService(
    { get: () => 'test-key' } as never,
    {} as never,
  );

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

  it('submits custom shot prompt with multi-shot enabled', async () => {
    request.mockResolvedValue({
      data: { code: 0, data: { id: 'shot-job', status: 'submitted' } },
    });
    const prompt = 'shot 1, 2, Wide shot; shot 2, 3, Close-up;';
    await service.submit(
      'kling/kling-3.0',
      prompt,
      { duration: 5, resolution: '720p', multiShot: true },
      ['https://example.com/first.png'],
    );
    const body = request.mock.calls[0][0].data;
    expect(body.contents[0]).toEqual({ type: 'prompt', text: prompt });
    expect(body.settings.multi_shot).toBe(true);
    expect(body.settings.duration).toBe(5);
  });

  it('submits selected Kling 3.0 Elements with stable prompt ids', async () => {
    request.mockResolvedValue({
      data: { code: 0, data: { id: 'element-job', status: 'submitted' } },
    });
    await service.submit(
      'kling/kling-3.0',
      'The hero @element_21 waves',
      {
        duration: 5,
        resolution: '720p',
        elementAssetIds: [21, 34],
        elementIds: ['kling-101', 'kling-102'],
      },
      ['https://example.com/first.png'],
    );
    expect(request.mock.calls[0][0].data.contents).toEqual([
      { type: 'prompt', text: 'The hero @element_21 waves' },
      { type: 'first_frame', url: 'https://example.com/first.png' },
      { type: 'element', element_id: 'kling-101', id: 'element_21' },
      { type: 'element', element_id: 'kling-102', id: 'element_34' },
    ]);
  });

  it('submits selected Kling 3.0 Omni Elements with stable prompt ids', async () => {
    request.mockResolvedValue({
      data: { code: 0, data: { id: 'omni-job', status: 'submitted' } },
    });
    await service.submit(
      'kling/kling-3.0-omni',
      'The hero @element_21 waves',
      {
        duration: 5,
        resolution: '720p',
        elementAssetIds: [21],
        elementIds: ['kling-101'],
      },
      ['https://example.com/first.png'],
    );
    const config = request.mock.calls[0][0];
    expect(config.url).toBe(
      'https://api-singapore.klingai.com/omni-video/kling-3.0-omni',
    );
    expect(config.data.contents).toContainEqual({
      type: 'element',
      element_id: 'kling-101',
      id: 'element_21',
    });
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
    request.mockResolvedValue({
      data: { code: 0, data: { id: 'omni-1', status: 'submitted' } },
    });
    await service.submit(
      'kling/kling-3.0-omni',
      'a red dress',
      {
        duration: 5,
        resolution: '4k',
        referenceMode: 'refer_image',
        generateAudio: true,
      },
      ['https://example.com/look.png'],
    );
    const config = request.mock.calls[0][0];
    expect(config.url).toBe(
      'https://api-singapore.klingai.com/omni-video/kling-3.0-omni',
    );
    expect(config.data.contents[1]).toEqual({
      type: 'refer_image',
      url: 'https://example.com/look.png',
      id: 'image_1',
    });
    expect(config.data.settings).toMatchObject({
      resolution: '4k',
      audio: 'native',
      aspect_ratio: '16:9',
    });
  });

  it('does not send unsupported audio and multi-shot settings to Turbo', async () => {
    request.mockResolvedValue({
      data: { code: 0, data: { id: 'turbo-1', status: 'submitted' } },
    });
    await service.submit(
      'kling/kling-3.0-turbo',
      'move',
      { duration: 5, resolution: '720p' },
      ['https://example.com/first.png'],
    );
    expect(request.mock.calls[0][0].data.settings).toEqual({
      duration: 5,
      resolution: '720p',
    });
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
  const service = new KlingService(
    { get: () => 'test-key' } as never,
    repo as never,
  );

  beforeEach(() => {
    request.mockReset();
    repo.find.mockReset();
    repo.findOne.mockReset();
    repo.save.mockReset().mockImplementation(async (value) => value);
  });

  it('sends ordered owned images using the Kling Element API', async () => {
    repo.find.mockResolvedValue([
      {
        id: 1,
        userId: 7,
        assetType: 'image',
        storedUrl: 'https://example.com/front.png',
      },
      {
        id: 2,
        userId: 7,
        assetType: 'image',
        storedUrl: 'https://example.com/side.png',
      },
    ]);
    request.mockResolvedValue({
      data: {
        code: 0,
        data: { task_id: 'element-task', task_status: 'submitted' },
      },
    });
    await service.createElement(7, {
      name: 'Cat',
      description: 'Mascot',
      elementType: 'image',
      mainAssetId: 1,
      additionalAssetIds: [2],
    });
    const call = request.mock.calls[0][0];
    expect(call.url).toBe(
      'https://api-singapore.klingai.com/v1/general/advanced-custom-elements',
    );
    expect(call.data.element_image_list).toEqual({
      frontal_image: 'https://example.com/front.png',
      refer_images: [{ image_url: 'https://example.com/side.png' }],
    });
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, sourceType: 'external' }),
    );
  });

  it('rejects references that do not belong to the user', async () => {
    repo.find.mockResolvedValue([
      {
        id: 1,
        userId: 7,
        assetType: 'image',
        storedUrl: 'https://example.com/front.png',
      },
    ]);
    await expect(
      service.createElement(7, {
        name: 'Cat',
        description: 'Mascot',
        mainAssetId: 1,
        additionalAssetIds: [2],
      }),
    ).rejects.toThrow('Tài nguyên tham chiếu không hợp lệ');
    expect(request).not.toHaveBeenCalled();
  });

  it('does not send an Element task when its pending record cannot be saved', async () => {
    repo.find.mockResolvedValue([
      {
        id: 1,
        userId: 7,
        assetType: 'image',
        storedUrl: 'https://example.com/front.png',
      },
      {
        id: 2,
        userId: 7,
        assetType: 'image',
        storedUrl: 'https://example.com/side.png',
      },
    ]);
    repo.save.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(
      service.createElement(7, {
        name: 'Cat',
        description: 'Mascot',
        mainAssetId: 1,
        additionalAssetIds: [2],
      }),
    ).rejects.toThrow('database unavailable');
    expect(request).not.toHaveBeenCalled();
  });

  it('creates a custom voice from a user-owned audio sample', async () => {
    repo.findOne.mockResolvedValue({
      id: 3,
      userId: 7,
      assetType: 'audio',
      mimeType: 'audio/mpeg',
      storedUrl: 'https://example.com/voice.mp3',
      durationSeconds: 12,
    });
    request.mockResolvedValue({
      data: {
        code: 0,
        data: { task_id: 'voice-task', task_status: 'submitted' },
      },
    });
    await service.createVoice(7, { name: 'MC Voice', sampleAssetId: 3 });
    expect(request.mock.calls[0][0]).toMatchObject({
      url: 'https://api-singapore.klingai.com/v1/general/custom-voices',
      data: {
        voice_name: 'MC Voice',
        voice_url: 'https://example.com/voice.mp3',
      },
    });
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        assetRole: 'voice',
        sourceType: 'external',
      }),
    );
  });

  it('saves the Voice before submitting it to Kling', async () => {
    repo.findOne.mockResolvedValue({
      id: 3,
      userId: 7,
      assetType: 'audio',
      mimeType: 'audio/mpeg',
      storedUrl: 'https://example.com/voice.mp3',
      durationSeconds: 12,
    });
    request.mockResolvedValue({
      data: {
        code: 0,
        data: { task_id: 'voice-task', task_status: 'submitted' },
      },
    });
    await service.createVoice(7, { name: 'MC Voice', sampleAssetId: 3 });
    expect(repo.save).toHaveBeenCalledTimes(2);
    expect(repo.save.mock.invocationCallOrder[0]).toBeLessThan(
      request.mock.invocationCallOrder[0],
    );
    expect(repo.save.mock.lastCall?.[0].metadata).toMatchObject({
      taskId: 'voice-task',
      status: 'submitted',
    });
  });

  it('does not submit a voice using another user’s sample', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(
      service.createVoice(7, { name: 'MC Voice', sampleAssetId: 3 }),
    ).rejects.toThrow('Mẫu giọng');
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects a voice sample shorter than five seconds', async () => {
    repo.findOne.mockResolvedValue({
      id: 3,
      userId: 7,
      assetType: 'audio',
      mimeType: 'audio/mpeg',
      metadata: { mediaDurationSeconds: 4.8 },
    });
    await expect(
      service.createVoice(7, { name: 'MC Voice', sampleAssetId: 3 }),
    ).rejects.toThrow('5–30 giây');
    expect(request).not.toHaveBeenCalled();
  });

  it('updates a completed Voice with the Kling Voice ID', async () => {
    const voice = {
      id: 9,
      assetRole: 'voice',
      metadata: { taskId: 'voice-task', status: 'processing' },
    };
    repo.find.mockResolvedValue([voice]);
    request.mockResolvedValue({
      data: {
        code: 0,
        data: {
          task_status: 'succeed',
          task_result: {
            voices: [
              {
                voice_id: 'voice-123',
                trial_url: 'https://example.com/preview.mp3',
              },
            ],
          },
        },
      },
    });
    const result = await service.listCustomAssets(7, 'voice');
    expect(result.items[0].metadata).toMatchObject({
      status: 'succeed',
      voiceId: 'voice-123',
      trialUrl: 'https://example.com/preview.mp3',
    });
  });

  it.each([
    [
      'element',
      'image',
      'elementId',
      123,
      '/v1/general/delete-advanced-elements',
      { element_id: '123' },
    ],
    [
      'element',
      'video',
      'elementId',
      456,
      '/v1/general/delete-advanced-elements',
      { element_id: '456' },
    ],
    [
      'voice',
      'audio',
      'voiceId',
      'voice-789',
      '/v1/general/delete-voices',
      { voice_id: 'voice-789' },
    ],
  ])(
    'deletes an owned %s %s custom asset through Kling',
    async (role, type, idField, klingId, path, body) => {
      const asset = {
        id: 9,
        userId: 7,
        sourceType: 'external',
        storageProvider: 'kling',
        assetRole: role,
        assetType: type,
        metadata: { status: 'succeed', [idField]: klingId },
      };
      repo.findOne.mockResolvedValue(asset);
      request.mockResolvedValue({
        data: {
          code: 0,
          data: { task_id: 'delete-task', task_status: 'submitted' },
        },
      });

      const result = await service.deleteCustomAsset(
        7,
        9,
        role as 'element' | 'voice',
      );

      expect(request.mock.calls[0][0]).toMatchObject({
        method: 'POST',
        url: `https://api-singapore.klingai.com${path}`,
        data: body,
      });
      expect(result.metadata).toMatchObject({
        deleteTaskId: 'delete-task',
        deleteStatus: 'submitted',
      });
    },
  );

  it('refuses to delete another user’s Element', async () => {
    repo.findOne.mockResolvedValue({
      id: 9,
      userId: 8,
      sourceType: 'external',
      storageProvider: 'kling',
      assetRole: 'element',
    });
    await expect(service.deleteCustomAsset(7, 9, 'element')).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it('does not delete a Voice through the Element endpoint', async () => {
    repo.findOne.mockResolvedValue({
      id: 9,
      userId: 7,
      sourceType: 'external',
      storageProvider: 'kling',
      assetRole: 'voice',
      metadata: { status: 'succeed', voiceId: 'voice-789' },
    });
    await expect(service.deleteCustomAsset(7, 9, 'element')).rejects.toThrow(
      'Loại tài nguyên',
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('waits for a creation task before allowing deletion', async () => {
    repo.findOne.mockResolvedValue({
      id: 9,
      userId: 7,
      sourceType: 'external',
      storageProvider: 'kling',
      assetRole: 'voice',
      metadata: { status: 'processing', taskId: 'create-task' },
    });
    await expect(service.deleteCustomAsset(7, 9, 'voice')).rejects.toThrow(
      'đang tạo',
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('hides a failed creation without calling Kling', async () => {
    repo.findOne.mockResolvedValue({
      id: 9,
      userId: 7,
      sourceType: 'external',
      storageProvider: 'kling',
      assetRole: 'voice',
      metadata: { status: 'failed', taskId: null },
    });
    const result = await service.deleteCustomAsset(7, 9, 'voice');
    expect(result.metadata.deleteStatus).toBe('succeed');
    expect(request).not.toHaveBeenCalled();
  });

  it('keeps a Voice visible when Kling reports deletion failed', async () => {
    const asset = {
      id: 9,
      assetRole: 'voice',
      metadata: {
        status: 'succeed',
        deleteStatus: 'submitted',
        deleteTaskId: 'delete-task',
      },
    };
    repo.find.mockResolvedValue([asset]);
    request.mockResolvedValue({
      data: {
        code: 0,
        data: { task_status: 'failed', task_status_msg: 'Voice is in use' },
      },
    });

    const result = await service.listCustomAssets(7, 'voice');

    expect(result.items).toEqual([asset]);
    expect(asset.metadata).toMatchObject({
      deleteStatus: 'failed',
      deleteError: 'Voice is in use',
    });
  });

  it('removes an Element from the list only after Kling confirms deletion', async () => {
    const asset = {
      id: 9,
      assetRole: 'element',
      metadata: {
        status: 'succeed',
        deleteStatus: 'submitted',
        deleteTaskId: 'delete-task',
      },
    };
    repo.find.mockResolvedValue([asset]);
    request.mockResolvedValue({
      data: { code: 0, data: { task_status: 'succeed' } },
    });

    const result = await service.listCustomAssets(7, 'element');

    expect(request.mock.calls[0][0].url).toContain(
      '/advanced-custom-elements/delete-task',
    );
    expect(asset.metadata.deleteStatus).toBe('succeed');
    expect(result.items).toEqual([]);
  });
});
