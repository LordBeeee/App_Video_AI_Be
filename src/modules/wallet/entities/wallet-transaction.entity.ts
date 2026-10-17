import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'wallet_transactions', schema: 'public' })
export class WalletTransaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'wallet_id', type: 'bigint' })
  walletId!: number;

  @Column({ name: 'user_id', type: 'bigint' })
  userId!: number;

  @Column({ length: 30 })
  type!: 'topup' | 'debit' | 'refund' | 'adjustment';

  @Column({ name: 'amount_vnd', type: 'bigint' })
  amountVnd!: number;

  @Column({ name: 'balance_after_vnd', type: 'bigint' })
  balanceAfterVnd!: number;

  @Column({ name: 'idempotency_key', length: 255, unique: true })
  idempotencyKey!: string;

  @Column({ type: 'jsonb', default: '{}' })
  metadata!: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
