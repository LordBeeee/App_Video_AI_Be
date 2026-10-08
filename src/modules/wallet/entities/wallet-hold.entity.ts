import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'wallet_holds', schema: 'public' })
export class WalletHold {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'wallet_id', type: 'bigint' })
  walletId!: number;

  @Column({ name: 'user_id', type: 'bigint' })
  userId!: number;

  @Column({ name: 'quote_id', type: 'uuid', unique: true })
  quoteId!: string;

  @Column({ name: 'generation_id', type: 'uuid', nullable: true })
  generationId?: string;

  @Column({ name: 'amount_vnd', type: 'bigint' })
  amountVnd!: number;

  @Column({ name: 'settled_amount_vnd', type: 'bigint', nullable: true })
  settledAmountVnd?: number;

  @Column({ length: 20, default: 'active' })
  status!: 'active' | 'settled' | 'released';

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
