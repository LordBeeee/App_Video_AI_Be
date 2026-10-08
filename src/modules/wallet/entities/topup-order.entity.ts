import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'topup_orders', schema: 'public' })
export class TopupOrder {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId!: number;

  @Column({ name: 'wallet_id', type: 'bigint' })
  walletId!: number;

  @Column({ name: 'order_code', type: 'bigint', unique: true })
  orderCode!: number;

  @Column({ name: 'amount_vnd', type: 'bigint' })
  amountVnd!: number;

  @Column({ length: 20, default: 'pending' })
  status!: 'pending' | 'paid' | 'cancelled' | 'expired';

  @Column({ name: 'payment_link_id', length: 255, nullable: true })
  paymentLinkId?: string;

  @Column({ name: 'checkout_url', type: 'text', nullable: true })
  checkoutUrl?: string;

  @Column({ name: 'qr_code', type: 'text', nullable: true })
  qrCode?: string;

  @Column({
    name: 'provider_reference',
    length: 255,
    nullable: true,
    unique: true,
  })
  providerReference?: string;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
