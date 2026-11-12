import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Response } from 'express';
import { Repository } from 'typeorm';
import { WalletService } from '../../wallet/wallet.service';
import { AiGeneration } from '../generations/ai-generation.entity';
import { ChatMessage } from './chat-message.entity';
import { Conversation } from './conversation.entity';
import { PricingQuote } from '../pricing/pricing-quote.entity';
import { OpenRouterService } from '../openrouter.service';
import { PricingService } from '../pricing/pricing.service';
import { CatalogService } from '../catalog/catalog.service';
import { chatContent, chatDocuments } from './chat-documents';
import { chargeQuoteVnd } from '../pricing/pricing-calculator';

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
    private readonly catalog: CatalogService,
  ) {}

  async createConversation(
    userId: number,
    body: { modelSlug: string; title?: string },
  ) {
    if (!body.modelSlug) throw new BadRequestException('Model là bắt buộc');
    await this.catalog.find('chat', body.modelSlug);
    return this.conversations.save(
      this.conversations.create({
        userId,
        modelSlug: body.modelSlug,
        title: body.title?.trim() || 'Cuộc trò chuyện mới',
      }),
    );
  }

  async list(userId: number) {
    const conversations = await this.conversations.find({
      where: { userId },
      order: { updatedAt: 'DESC' },
      take: 50,
    });
    if (!conversations.length) return [];
    const costs: Array<{ id: string; total: string; linked: string; messages: string }> = await this.generations.query(`
      SELECT c.id, COALESCE(cost.total, 0) AS total, COALESCE(cost.linked, 0) AS linked,
             (SELECT COUNT(*) FROM public.chat_messages m
              WHERE m.conversation_id = c.id AND m.role = 'user') AS messages
      FROM public.conversations c
      LEFT JOIN (
        SELECT g.options->>'conversationId' AS conversation_id, COUNT(*) AS linked,
               SUM(CASE WHEN h.status = 'settled' THEN h.settled_amount_vnd ELSE 0 END) AS total
        FROM public.ai_generations g
        LEFT JOIN public.wallet_holds h ON h.id = g.wallet_hold_id AND h.user_id = g.user_id
        WHERE g.user_id = $1 AND g.modality = 'chat'
          AND g.options->>'conversationId' = ANY($2::text[])
        GROUP BY g.options->>'conversationId'
      ) cost ON cost.conversation_id = c.id::text
      WHERE c.user_id = $1 AND c.id = ANY($2::uuid[])
    `, [userId, conversations.map((conversation) => conversation.id)]);
    const byId = new Map(costs.map((cost) => [cost.id, cost]));
    return conversations.map((conversation) => {
      const cost = byId.get(conversation.id);
      return {
        ...conversation,
        totalChargedVnd: Number(cost?.total || 0),
        costComplete: Number(cost?.linked || 0) >= Number(cost?.messages || 0),
      };
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
    await this.catalog.find('chat', conversation.modelSlug);
    const quote = await this.pricing.getValidQuote(
      userId,
      body.quoteId,
      content,
    );
    if (
      quote.modality !== 'chat' ||
      quote.modelSlug !== conversation.modelSlug ||
      (quote.request?.options?.conversationId && quote.request.options.conversationId !== conversationId)
    ) {
      throw new BadRequestException('Báo giá không khớp hội thoại');
    }
    const documents = chatDocuments(quote.request?.options?.documents);
    const history = await this.pricing.chatHistory(userId, conversationId);
    if (quote.request?.chatContextHash &&
        quote.request.chatContextHash !== this.pricing.chatHistoryHash(history))
      throw new BadRequestException('Hội thoại đã thay đổi, vui lòng lấy báo giá mới');
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
        documents,
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
        options: { ...quote.request?.options, conversationId },
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
      const upstream = await this.openRouter.streamChat({
        model: quote.modelSlug,
        messages: [...history, userMessage].map((message) => ({
          role: message.role,
          content: chatContent(message.content, message.documents),
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
      const charge = chargeQuoteVnd(
        Number(quote.maxPriceVnd),
        Number(quote.usdVndRate),
        Number(quote.markupRate),
        actualUsd,
      );
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
        const charge = chargeQuoteVnd(
          Number(quote.maxPriceVnd),
          Number(quote.usdVndRate),
          Number(quote.markupRate),
          billedUsd,
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
