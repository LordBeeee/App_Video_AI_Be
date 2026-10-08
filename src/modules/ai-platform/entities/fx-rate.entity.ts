import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'fx_rates', schema: 'public' })
@Index(['baseCurrency', 'quoteCurrency', 'rateDate'], { unique: true })
export class FxRate {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: number;

  @Column({ name: 'base_currency', length: 3 })
  baseCurrency!: string;

  @Column({ name: 'quote_currency', length: 3 })
  quoteCurrency!: string;

  @Column({ name: 'rate_date', type: 'date' })
  rateDate!: string;

  @Column({ type: 'decimal', precision: 18, scale: 6 })
  rate!: string;

  @Column({ length: 50, default: 'frankfurter' })
  source!: string;

  @CreateDateColumn({ name: 'fetched_at' })
  fetchedAt!: Date;
}
