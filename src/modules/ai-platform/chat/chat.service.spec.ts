import { BadRequestException } from '@nestjs/common';
import { Response } from 'express';
import { ChatService } from './chat.service';

describe('ChatService model availability', () => {
  const setup = () => {
    const conversations = {
      create: jest.fn((value) => value),
      save: jest.fn((value) => Promise.resolve(value)),
      findOne: jest.fn().mockResolvedValue({
        id: 'conversation', userId: 1, modelSlug: 'anthropic/claude',
      }),
    };
    const messages = { find: jest.fn().mockResolvedValue([]) };
    const pricing = { getValidQuote: jest.fn() };
    const wallets = { hold: jest.fn() };
    const catalog = { find: jest.fn().mockResolvedValue({}) };
    const service = new ChatService(
      conversations as never, messages as never, {} as never, {} as never,
      pricing as never, wallets as never, {} as never, catalog as never,
    );
    return { service, conversations, messages, pricing, wallets, catalog };
  };

  it('creates a conversation after validating its chat model', async () => {
    const { service, catalog, conversations } = setup();
    await service.createConversation(1, { modelSlug: 'google/chat-model' });
    expect(catalog.find).toHaveBeenCalledWith('chat', 'google/chat-model');
    expect(conversations.save).toHaveBeenCalledTimes(1);
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
});
