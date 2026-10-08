import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PayosService } from './payos.service';
import { PaymentsController } from './payments.controller';
import { TopupOrder } from './entities/topup-order.entity';
import { WalletHold } from './entities/wallet-hold.entity';
import { WalletTransaction } from './entities/wallet-transaction.entity';
import { Wallet } from './entities/wallet.entity';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Wallet,
      WalletTransaction,
      WalletHold,
      TopupOrder,
    ]),
  ],
  controllers: [WalletController, PaymentsController],
  providers: [WalletService, PayosService],
  exports: [WalletService],
})
export class WalletModule {}
