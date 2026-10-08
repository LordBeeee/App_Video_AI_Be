import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Response } from 'express';
import { Repository } from 'typeorm';
import { WalletService } from '../wallet/wallet.service';
import { AiGeneration } from './entities/ai-generation.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { Conversation } from './entities/conversation.entity';
import { PricingQuote } from './entities/pricing-quote.entity';
import { OpenRouterService } from './openrouter.service';
import { PricingService } from './pricing.service';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversations: Repository<Conversation>,
    @InjectRepository(ChatMessage)
    private readonly messages: Repository<ChatMessage>,
    @InjectRepository(PricingQuote)
    private readonly quotes: Repository<PricingQuote>,
    @InjectRepository(AiGeneration)
    private readonly generations: Repository<AiGeneration>,
    private readonly pricing: PricingService,
    private readonly wallets: WalletService,
    private readonly openRouter: OpenRouterService,
  ) {}

  async createConversation(
    userId: number,
    body: { modelSlug: string; title?: string },
  ) {
    if (!body.modelSlug) throw new BadRequestException('Model là bắt buộc');
    return this.conversations.save(
      this.conversations.create({
        userId,
        modelSlug: body.modelSlug,
        title: body.title?.trim() || 'Cuộc trò chuyện mới',
      }),
    );
  }

  list(userId: number) {
    return this.conversations.find({
      where: { userId },
      order: { updatedAt: 'DESC' },
      take: 50,
    });
  }

  async getMessages(userId: number, conversationId: string) {
    await this.ownedConversation(userId, conversationId);
    return this.messages.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });
  }

  private async ownedConversation(userId: number, id: string) {
    const conversation = await this.conversations.findOne({ where: { id } });
    if (!conversation) throw new NotFoundException('Không tìm thấy hội thoại');
    if (Number(conversation.userId) !== Number(userId))
      throw new ForbiddenException();
    return conversation;
  }

  private write(res: Response, event: string, payload: any) {
    if (!res.writableEnded)
      res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  }

  async streamMessage(
    userId: number,
    conversationId: string,
    body: { quoteId: string; content: string },
    res: Response,
  ) {
    const content = String(body.content || '').trim();
    if (!content) throw new BadRequestException('Tin nhắn không được để trống');
    const conversation = await this.ownedConversation(userId, conversationId);
    const quote = await this.pricing.getValidQuote(
      userId,
      body.quoteId,
      content,
    );
    if (
      quote.modality !== 'chat' ||
      quote.modelSlug !== conversation.modelSlug
    ) {
      throw new BadRequestException('Báo giá không khớp hội thoại');
    }
    const hold = await this.wallets.hold(
      userId,
      quote.id,
      Number(quote.maxPriceVnd),
    );
    quote.consumedAt = new Date();
    await this.quotes.save(quote);
    const userMessage = await this.messages.save(
      this.messages.create({
        conversationId,
        role: 'user',
        content,
      }),
    );
    const generation = await this.generations.save(
      this.generations.create({
        userId,
        quoteId: quote.id,
        walletHoldId: hold.id,
        modality: 'chat',
        modelSlug: quote.modelSlug,
        status: 'processing',
        prompt: content,
        options: quote.request?.options || {},
        outputUrls: [],
        usage: {},
        estimatedMinVnd: Number(quote.minPriceVnd),
        estimatedMaxVnd: Number(quote.maxPriceVnd),
      }),
    );
    await this.wallets.attachGeneration(hold.id, generation.id);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    this.write(res, 'start', {
      generationId: generation.id,
      messageId: userMessage.id,
    });

    let providerGenerationId = '';
    try {
      const history = await this.messages.find({
        where: { conversationId },
        order: { createdAt: 'ASC' },
        take: 40,
      });
      const upstream = await this.openRouter.streamChat({
        model: quote.modelSlug,
        messages: history.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        stream: true,
        max_tokens: Number(quote.request?.options?.maxOutputTokens || 1024),
        usage: { include: true },
      });

      let pending = '';
      let assistantText = '';
      let usage: any = {};
      for await (const chunk of upstream.data) {
        pending += Buffer.from(chunk).toString('utf8');
        const lines = pending.split('\n');
        pending = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();
          if (!raw || raw === '[DONE]') continue;
          try {
            const event = JSON.parse(raw);
            providerGenerationId ||= event.id || '';
            if (event.usage) usage = event.usage;
            const delta = event.choices?.[0]?.delta?.content;
            if (delta) {
              assistantText += delta;
              this.write(res, 'delta', { text: delta });
            }
          } catch {
            /* ignore keep-alive or provider-specific non-JSON lines */
          }
        }
      }

      let actualUsd = Number(usage.cost);
      if (!Number.isFinite(actualUsd) && providerGenerationId) {
        try {
          const metadata =
            await this.openRouter.getGeneration(providerGenerationId);
          actualUsd = Number(metadata.data?.total_cost ?? metadata.data?.usage);
        } catch {
          /* quote maximum remains the settlement fallback */
        }
      }
      const charge = Number.isFinite(actualUsd)
        ? Math.min(
            Number(quote.maxPriceVnd),
            Math.ceil(
              actualUsd *
                Number(quote.usdVndRate) *
                (1 + Number(quote.markupRate)),
            ),
          )
        : Number(quote.maxPriceVnd);
      const assistant = await this.messages.save(
        this.messages.create({
          conversationId,
          role: 'assistant',
          content: assistantText,
          inputTokens: usage.prompt_tokens,
          outputTokens: usage.completion_tokens,
          costUsd: Number.isFinite(actualUsd) ? String(actualUsd) : undefined,
        }),
      );
      generation.status = 'succeeded';
      generation.providerGenerationId = providerGenerationId || undefined;
      generation.usage = usage;
      generation.actualCostUsd = Number.isFinite(actualUsd)
        ? String(actualUsd)
        : undefined;
      generation.chargedVnd = charge;
      generation.completedAt = new Date();
      await this.generations.save(generation);
      await this.wallets.settle(hold.id, charge, {
        generationId: generation.id,
        modality: 'chat',
      });
      this.write(res, 'done', { message: assistant, chargedVnd: charge });
      res.end();
    } catch (error: any) {
      generation.status = 'failed';
      generation.errorMessage = error.message || 'Chat thất bại';
      generation.completedAt = new Date();
      await this.generations.save(generation);
      let billedUsd: number | undefined;
      if (providerGenerationId) {
        try {
          const metadata =
            await this.openRouter.getGeneration(providerGenerationId);
          const parsed = Number(
            metadata.data?.total_cost ?? metadata.data?.usage,
          );
          if (Number.isFinite(parsed) && parsed > 0) billedUsd = parsed;
        } catch {
          /* An unavailable generation record means there is no confirmed charge. */
        }
      }
      if (billedUsd != null) {
        const charge = Math.min(
          Number(quote.maxPriceVnd),
          Math.ceil(
            billedUsd *
              Number(quote.usdVndRate) *
              (1 + Number(quote.markupRate)),
          ),
        );
        generation.actualCostUsd = String(billedUsd);
        generation.chargedVnd = charge;
        await this.generations.save(generation);
        await this.wallets.settle(hold.id, charge, {
          generationId: generation.id,
          modality: 'chat',
          interrupted: true,
        });
      } else {
        await this.wallets.release(
          hold.id,
          generation.errorMessage || 'Chat thất bại',
        );
      }
      this.write(res, 'error', { message: generation.errorMessage });
      res.end();
    }
  }
}
