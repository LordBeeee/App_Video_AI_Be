import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'wallets', schema: 'public' })
export class Wallet {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: number;

  @Column({ name: 'user_id', type: 'bigint', unique: true })
  userId!: number;

  @Column({ name: 'balance_vnd', type: 'bigint', default: 0 })
  balanceVnd!: number;

  @Column({ name: 'held_vnd', type: 'bigint', default: 0 })
  heldVnd!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
