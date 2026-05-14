import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { AiProvider } from '../../ai-provider/entities/ai-provider.entity';

@Entity({ name: 'ai_models', schema: 'public' })
export class AiModel {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: number;

  @Column({ name: 'provider_id', type: 'bigint' })
  providerId!: number;

  @Column({ length: 100 })
  code!: string;

  @Column({ length: 255 })
  name!: string;

  @Column({ name: 'model_type', length: 50 })
  modelType!: string;

  @Column({ length: 50, nullable: true })
  version!: string;

  @Column({ type: 'text', nullable: true })
  description!: string;

  @Column({ name: 'input_schema', type: 'jsonb', nullable: true })
  inputSchema!: object;

  @Column({ name: 'output_schema', type: 'jsonb', nullable: true })
  outputSchema!: object;

  @Column({ name: 'default_params', type: 'jsonb', nullable: true })
  defaultParams!: object;

  @Column({ type: 'jsonb', nullable: true })
  pricing!: object;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @ManyToOne(() => AiProvider, provider => provider.models)
  @JoinColumn({ name: 'provider_id' })
  provider!: AiProvider;
}