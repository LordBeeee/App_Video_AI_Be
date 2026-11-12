import { BadRequestException } from '@nestjs/common';
import { Response } from 'express';
import { ChatService } from './chat.service';

describe('ChatService model availability', () => {
  const setup = () => {
    const conversations = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((value) => value),
      save: jest.fn((value) => Promise.resolve(value)),
      findOne: jest.fn().mockResolvedValue({
        id: 'conversation', userId: 1, modelSlug: 'anthropic/claude',
      }),
    };
    const messages = { find: jest.fn().mockResolvedValue([]) };
    const pricing = { getValidQuote: jest.fn(), chatHistory: jest.fn().mockResolvedValue([]),
      chatHistoryHash: jest.fn().mockReturnValue('current-context') };
    const wallets = { hold: jest.fn() };
    const catalog = { find: jest.fn().mockResolvedValue({}) };
    const generations = { query: jest.fn().mockResolvedValue([]) };
    const service = new ChatService(
      conversations as never, messages as never, {} as never, generations as never,
      pricing as never, wallets as never, {} as never, catalog as never,
    );
    return { service, conversations, messages, pricing, wallets, catalog, generations };
  };

  it('creates a conversation after validating its chat model', async () => {
    const { service, catalog, conversations } = setup();
    await service.createConversation(1, { modelSlug: 'google/chat-model' });
    expect(catalog.find).toHaveBeenCalledWith('chat', 'google/chat-model');
    expect(conversations.save).toHaveBeenCalledTimes(1);
  });

  it('returns persisted conversation charges with incomplete legacy costs marked', async () => {
    const { service, conversations, generations } = setup();
    conversations.find.mockResolvedValue([{ id: 'first' }, { id: 'legacy' }] as never);
    generations.query.mockResolvedValue([
      { id: 'first', total: '125', linked: '2', messages: '2' },
      { id: 'legacy', total: '10', linked: '1', messages: '3' },
    ] as never);
    await expect(service.list(1)).resolves.toEqual([
      { id: 'first', totalChargedVnd: 125, costComplete: true },
      { id: 'legacy', totalChargedVnd: 10, costComplete: false },
    ]);
    expect(generations.query).toHaveBeenCalledWith(expect.stringContaining("h.status = 'settled'"), [1, ['first', 'legacy']]);
    expect(conversations.find).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 1 } }));
  });

  it('does not query charges when there are no conversations', async () => {
    const { service, generations } = setup();
    await expect(service.list(1)).resolves.toEqual([]);
    expect(generations.query).not.toHaveBeenCalled();
  });

  it('does not save a conversation for a rejected model', async () => {
    const { service, catalog, conversations } = setup();
    catalog.find.mockRejectedValue(new BadRequestException());
    await expect(service.createConversation(1, { modelSlug: 'anthropic/claude' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(conversations.save).not.toHaveBeenCalled();
  });

  it('rejects an old conversation before consuming a quote or holding money', async () => {
    const { service, catalog, pricing, wallets } = setup();
    catalog.find.mockRejectedValue(new BadRequestException());
    await expect(service.streamMessage(1, 'conversation', {
      quoteId: 'old-quote', content: 'Hello',
    }, {} as Response)).rejects.toBeInstanceOf(BadRequestException);
    expect(catalog.find).toHaveBeenCalledWith('chat', 'anthropic/claude');
    expect(pricing.getValidQuote).not.toHaveBeenCalled();
    expect(wallets.hold).not.toHaveBeenCalled();
  });

  it('still allows reading history when a model is no longer available', async () => {
    const { service, catalog, messages } = setup();
    catalog.find.mockRejectedValue(new BadRequestException());
    await expect(service.getMessages(1, 'conversation')).resolves.toEqual([]);
    expect(messages.find).toHaveBeenCalled();
    expect(catalog.find).not.toHaveBeenCalled();
  });

  it('rejects a quote if the document context changed before holding money', async () => {
    const { service, pricing, wallets } = setup();
    pricing.getValidQuote.mockResolvedValue({ modality: 'chat', modelSlug: 'anthropic/claude',
      request: { options: {}, chatContextHash: 'old-context' } });
    await expect(service.streamMessage(1, 'conversation', {
      quoteId: 'quote', content: 'Question',
    }, {} as Response)).rejects.toBeInstanceOf(BadRequestException);
    expect(wallets.hold).not.toHaveBeenCalled();
  });

  it('saves attachments and sends their extracted text with conversation history', async () => {
    const document = { name: 'report.txt', text: 'Revenue: 120' };
    const conversations = { findOne: jest.fn().mockResolvedValue({ userId: 1, modelSlug: 'google/chat' }) };
    const messages = { create: jest.fn((value) => value), save: jest.fn(async (value) => ({ id: 'message', ...value })) };
    const quotes = { save: jest.fn() };
    const generations = { create: jest.fn((value) => value), save: jest.fn(async (value) => ({ id: 'generation', ...value })) };
    const pricing = {
      getValidQuote: jest.fn().mockResolvedValue({ id: 'quote', modality: 'chat', modelSlug: 'google/chat',
        maxPriceVnd: 100, usdVndRate: 26000, markupRate: 0.2,
        request: { options: { documents: [document], maxOutputTokens: 512 }, chatContextHash: 'context' } }),
      chatHistory: jest.fn().mockResolvedValue([{ role: 'user', content: 'Earlier question', documents: [document] }]),
      chatHistoryHash: jest.fn().mockReturnValue('context'),
    };
    const wallets = { hold: jest.fn().mockResolvedValue({ id: 'hold' }), attachGeneration: jest.fn(), settle: jest.fn() };
    const openRouter = { streamChat: jest.fn().mockResolvedValue({ data: (async function* () {
      yield Buffer.from('data: {"id":"provider-id","choices":[{"delta":{"content":"Revenue is 120"}}],"usage":{"cost":0.0001}}\n\ndata: [DONE]\n\n');
    })() }) };
    const service = new ChatService(conversations as never, messages as never, quotes as never,
      generations as never, pricing as never, wallets as never, openRouter as never,
      { find: jest.fn().mockResolvedValue({}) } as never);
    const res = { setHeader: jest.fn(), flushHeaders: jest.fn(), write: jest.fn(), end: jest.fn() };
    await service.streamMessage(1, 'conversation', { quoteId: 'quote', content: 'What is revenue?' }, res as unknown as Response);
    expect(messages.create).toHaveBeenCalledWith(expect.objectContaining({ role: 'user', documents: [document] }));
    expect(generations.create).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ conversationId: 'conversation' }),
    }));
    const request = openRouter.streamChat.mock.calls[0][0];
    expect(request.max_tokens).toBe(512);
    expect(request.messages).toHaveLength(2);
    expect(JSON.parse(request.messages[1].content)).toEqual({ question: 'What is revenue?', reference_documents: [document] });
    expect(wallets.settle).toHaveBeenCalled();
    expect(res.end).toHaveBeenCalled();
  });
});
