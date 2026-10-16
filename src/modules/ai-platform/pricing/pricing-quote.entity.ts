import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'pricing_quotes', schema: 'public' })
export class PricingQuote {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId!: number;

  @Column({ length: 20 })
  modality!: 'image' | 'video' | 'audio' | 'chat';

  @Column({ name: 'model_slug', length: 255 })
  modelSlug!: string;

  @Column({ type: 'jsonb', default: '{}' })
  request!: Record<string, any>;

  @Column({
    name: 'provider_cost_min_usd',
    type: 'decimal',
    precision: 18,
    scale: 10,
  })
  providerCostMinUsd!: string;

  @Column({
    name: 'provider_cost_max_usd',
    type: 'decimal',
    precision: 18,
    scale: 10,
  })
  providerCostMaxUsd!: string;

  @Column({ name: 'usd_vnd_rate', type: 'decimal', precision: 18, scale: 6 })
  usdVndRate!: string;

  @Column({ name: 'markup_rate', type: 'decimal', precision: 8, scale: 6 })
  markupRate!: string;

  @Column({ name: 'min_price_vnd', type: 'bigint' })
  minPriceVnd!: number;

  @Column({ name: 'max_price_vnd', type: 'bigint' })
  maxPriceVnd!: number;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
