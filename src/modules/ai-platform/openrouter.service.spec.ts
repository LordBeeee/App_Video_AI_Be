import axios from 'axios';
import { OpenRouterService } from './openrouter.service';

describe('OpenRouter speech audio', () => {
  const service = new OpenRouterService({
    getOrThrow: () => 'test-key', get: () => undefined,
  } as never);

  afterEach(() => jest.restoreAllMocks());

  it('wraps PCM in WAV using the response sample rate and preserves generation metadata', async () => {
    const pcm = Buffer.from([0, 0, 255, 127]);
    jest.spyOn(axios, 'post').mockResolvedValue({
      data: pcm, headers: { 'content-type': 'audio/pcm;rate=22050;channels=1', 'x-generation-id': 'gen-1' },
    });
    const response = await service.generateSpeech({ response_format: 'pcm' });
    expect(response.data.toString('ascii', 0, 4)).toBe('RIFF');
    expect(response.data.readUInt32LE(4)).toBe(40);
    expect(response.data.toString('ascii', 8, 16)).toBe('WAVEfmt ');
    expect(response.data.readUInt16LE(22)).toBe(1);
    expect(response.data.readUInt32LE(24)).toBe(22050);
    expect(response.data.readUInt16LE(34)).toBe(16);
    expect(response.data.readUInt32LE(40)).toBe(pcm.length);
    expect(response.data.subarray(44)).toEqual(pcm);
    expect(response.headers['x-generation-id']).toBe('gen-1');
  });

  it('keeps MP3 bytes unchanged', async () => {
    const mp3 = Buffer.from('ID3audio');
    jest.spyOn(axios, 'post').mockResolvedValue({ data: mp3, headers: {} });
    expect((await service.generateSpeech({ response_format: 'mp3' })).data).toEqual(mp3);
  });

  it.each([Buffer.alloc(0), Buffer.alloc(3)])('rejects empty or incomplete PCM samples', async (data) => {
    jest.spyOn(axios, 'post').mockResolvedValue({ data, headers: {} });
    await expect(service.generateSpeech({ response_format: 'pcm' })).rejects.toThrow('PCM không hợp lệ');
  });
});
