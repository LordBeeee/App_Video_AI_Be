import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Wallet } from './entities/wallet.entity';
import { WalletHold } from './entities/wallet-hold.entity';
import { WalletTransaction } from './entities/wallet-transaction.entity';

@Injectable()
export class WalletService {
  constructor(
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    @InjectRepository(WalletTransaction)
    private readonly transactions: Repository<WalletTransaction>,
    @InjectRepository(WalletHold)
    private readonly holds: Repository<WalletHold>,
    private readonly dataSource: DataSource,
  ) {}

  async ensureWallet(userId: number) {
    let wallet = await this.wallets.findOne({ where: { userId } });
    if (!wallet) {
      try {
        wallet = await this.wallets.save(
          this.wallets.create({ userId, balanceVnd: 0, heldVnd: 0 }),
        );
      } catch {
        wallet = await this.wallets.findOneOrFail({ where: { userId } });
      }
    }
    return wallet;
  }

  async summary(userId: number) {
    const wallet = await this.ensureWallet(userId);
    const balanceVnd = Number(wallet.balanceVnd);
    const heldVnd = Number(wallet.heldVnd);
    return {
      id: wallet.id,
      balanceVnd,
      heldVnd,
      availableVnd: balanceVnd - heldVnd,
    };
  }

  async history(userId: number) {
    await this.ensureWallet(userId);
    return this.transactions.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  async hold(userId: number, quoteId: string, amountVnd: number) {
    if (!Number.isInteger(amountVnd) || amountVnd <= 0)
      throw new BadRequestException('Số tiền giữ không hợp lệ');
    await this.ensureWallet(userId);
    return this.dataSource.transaction(async (manager) => {
      const wallet = await manager.getRepository(Wallet).findOne({
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!wallet) throw new NotFoundException('Không tìm thấy ví');
      const available = Number(wallet.balanceVnd) - Number(wallet.heldVnd);
      if (available < amountVnd) {
        throw new BadRequestException({
          code: 'INSUFFICIENT_BALANCE',
          message: 'Số dư khả dụng không đủ',
          requiredVnd: amountVnd,
          availableVnd: available,
        });
      }
      wallet.heldVnd = Number(wallet.heldVnd) + amountVnd;
      await manager.save(wallet);
      return manager.save(
        manager.create(WalletHold, {
          walletId: wallet.id,
          userId,
          quoteId,
          amountVnd,
          status: 'active',
        }),
      );
    });
  }

  async attachGeneration(holdId: string, generationId: string) {
    await this.holds.update({ id: holdId }, { generationId });
  }

  async settle(
    holdId: string,
    requestedChargeVnd: number,
    metadata: Record<string, any> = {},
  ) {
    return this.dataSource.transaction(async (manager) => {
      const hold = await manager.getRepository(WalletHold).findOne({
        where: { id: holdId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!hold || hold.status !== 'active') return hold;
      const wallet = await manager.getRepository(Wallet).findOne({
        where: { id: hold.walletId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!wallet) throw new NotFoundException('Không tìm thấy ví');
      const charge = Math.max(
        0,
        Math.min(Math.ceil(requestedChargeVnd), Number(hold.amountVnd)),
      );
      wallet.heldVnd = Math.max(
        0,
        Number(wallet.heldVnd) - Number(hold.amountVnd),
      );
      wallet.balanceVnd = Math.max(0, Number(wallet.balanceVnd) - charge);
      hold.status = 'settled';
      hold.settledAmountVnd = charge;
      await manager.save(wallet);
      await manager.save(hold);
      await manager.save(
        manager.create(WalletTransaction, {
          walletId: wallet.id,
          userId: hold.userId,
          type: 'debit',
          amountVnd: charge,
          balanceAfterVnd: Number(wallet.balanceVnd),
          idempotencyKey: `generation:${hold.generationId || hold.id}:debit`,
          metadata: {
            ...metadata,
            reservedVnd: Number(hold.amountVnd),
            releasedVnd: Number(hold.amountVnd) - charge,
          },
        }),
      );
      return hold;
    });
  }

  async release(holdId: string, reason: string) {
    return this.dataSource.transaction(async (manager) => {
      const hold = await manager.getRepository(WalletHold).findOne({
        where: { id: holdId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!hold || hold.status !== 'active') return hold;
      const wallet = await manager.getRepository(Wallet).findOne({
        where: { id: hold.walletId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!wallet) throw new NotFoundException('Không tìm thấy ví');
      wallet.heldVnd = Math.max(
        0,
        Number(wallet.heldVnd) - Number(hold.amountVnd),
      );
      hold.status = 'released';
      hold.settledAmountVnd = 0;
      await manager.save(wallet);
      await manager.save(hold);
      return { ...hold, reason };
    });
  }

  async credit(
    userId: number,
    amountVnd: number,
    idempotencyKey: string,
    type: 'topup' | 'refund' | 'adjustment' = 'topup',
    metadata: Record<string, any> = {},
  ) {
    if (!Number.isInteger(amountVnd) || amountVnd <= 0)
      throw new BadRequestException('Số tiền không hợp lệ');
    await this.ensureWallet(userId);
    return this.dataSource.transaction(async (manager) => {
      const existing = await manager
        .getRepository(WalletTransaction)
        .findOne({ where: { idempotencyKey } });
      if (existing) return existing;
      const wallet = await manager.getRepository(Wallet).findOne({
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!wallet) throw new NotFoundException('Không tìm thấy ví');
      wallet.balanceVnd = Number(wallet.balanceVnd) + amountVnd;
      await manager.save(wallet);
      return manager.save(
        manager.create(WalletTransaction, {
          walletId: wallet.id,
          userId,
          type,
          amountVnd,
          balanceAfterVnd: Number(wallet.balanceVnd),
          idempotencyKey,
          metadata,
        }),
      );
    });
  }
}
