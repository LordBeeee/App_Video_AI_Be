import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { createHmac, timingSafeEqual } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { TopupOrder } from './entities/topup-order.entity';
import { WalletService } from './wallet.service';

@Injectable()
export class PayosService {
  constructor(
    @InjectRepository(TopupOrder)
    private readonly orders: Repository<TopupOrder>,
    private readonly wallets: WalletService,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  private signature(data: Record<string, any>) {
    const canonical = Object.keys(data)
      .sort()
      .map((key) => `${key}=${data[key] ?? ''}`)
      .join('&');
    return createHmac(
      'sha256',
      this.config.getOrThrow<string>('PAYOS_CHECKSUM_KEY'),
    )
      .update(canonical)
      .digest('hex');
  }

  async createTopup(userId: number, amountVnd: number) {
    if (
      !Number.isInteger(amountVnd) ||
      amountVnd < 10_000 ||
      amountVnd > 100_000_000
    ) {
      throw new BadRequestException(
        'Số tiền nạp phải từ 10.000 đến 100.000.000 VND',
      );
    }
    const wallet = await this.wallets.ensureWallet(userId);
    const orderCode = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    const returnUrl =
      this.config.get<string>('PAYOS_RETURN_URL') ||
      `${this.config.get<string>('FRONTEND_URL') || 'http://localhost:5173'}/wallet?payment=success`;
    const cancelUrl =
      this.config.get<string>('PAYOS_CANCEL_URL') ||
      `${this.config.get<string>('FRONTEND_URL') || 'http://localhost:5173'}/wallet?payment=cancelled`;
    const data = {
      amount: amountVnd,
      cancelUrl,
      description: `NAP VI ${orderCode}`,
      orderCode,
      returnUrl,
    };
    const order = await this.orders.save(
      this.orders.create({
        userId,
        walletId: wallet.id,
        orderCode,
        amountVnd,
        status: 'pending',
      }),
    );
    try {
      const response = await axios.post(
        'https://api-merchant.payos.vn/v2/payment-requests',
        {
          ...data,
          signature: this.signature(data),
          items: [{ name: 'Nạp ví AI Studio', quantity: 1, price: amountVnd }],
        },
        {
          headers: {
            'x-client-id': this.config.getOrThrow<string>('PAYOS_CLIENT_ID'),
            'x-api-key': this.config.getOrThrow<string>('PAYOS_API_KEY'),
            'Content-Type': 'application/json',
          },
          timeout: 15_000,
        },
      );
      const payment = response.data?.data;
      order.paymentLinkId = payment?.paymentLinkId;
      order.checkoutUrl = payment?.checkoutUrl;
      order.qrCode = payment?.qrCode;
      await this.orders.save(order);
      return order;
    } catch (error: any) {
      await this.orders.update({ id: order.id }, { status: 'cancelled' });
      throw new BadRequestException(
        error.response?.data?.desc || 'Không thể tạo liên kết thanh toán payOS',
      );
    }
  }

  verifyWebhook(payload: any) {
    if (!payload?.data || !payload?.signature)
      throw new UnauthorizedException('Webhook không hợp lệ');
    const expected = this.signature(payload.data);
    const supplied = String(payload.signature);
    if (
      expected.length !== supplied.length ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
    ) {
      throw new UnauthorizedException('Chữ ký payOS không hợp lệ');
    }
  }

  async handleWebhook(payload: any) {
    this.verifyWebhook(payload);
    if (!payload.success || payload.data?.code !== '00')
      return { success: true };
    const orderCode = Number(payload.data.orderCode);
    const amount = Number(payload.data.amount);
    const reference = String(
      payload.data.reference || payload.data.paymentLinkId || orderCode,
    );
    const order = await this.orders.findOne({ where: { orderCode } });
    if (!order) throw new BadRequestException('Không tìm thấy đơn nạp');
    if (Number(order.amountVnd) !== amount)
      throw new BadRequestException('Số tiền webhook không khớp');
    if (order.status === 'paid') return { success: true };

    await this.wallets.credit(
      order.userId,
      amount,
      `payos:${reference}`,
      'topup',
      {
        orderId: order.id,
        orderCode,
        paymentLinkId: payload.data.paymentLinkId,
      },
    );
    await this.dataSource.getRepository(TopupOrder).update(
      { id: order.id },
      {
        status: 'paid',
        providerReference: reference,
        paidAt: new Date(),
      },
    );
    return { success: true };
  }

  history(userId: number) {
    return this.orders.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }
}
