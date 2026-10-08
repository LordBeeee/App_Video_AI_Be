import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AiGenerationAsset } from './ai-generation-asset.entity';
import { AiModel } from './ai-model.entity';

@Entity({ name: 'ai_generations', schema: 'public' })
export class AiGeneration {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId!: number;

  @Column({ name: 'project_id', type: 'bigint', nullable: true })
  projectId?: number;

  @Column({ name: 'quote_id', type: 'uuid', nullable: true })
  quoteId?: string;

  @Column({ name: 'wallet_hold_id', type: 'uuid', nullable: true })
  walletHoldId?: string;

  @Column({ length: 20 })
  modality!: 'image' | 'video' | 'audio' | 'chat';

  @Column({ name: 'model_slug', length: 255 })
  modelSlug!: string;

  @Column({ length: 30, default: 'openrouter' })
  source!: 'openrouter' | 'legacy_kling';

  @Column({ name: 'model_name_snapshot', length: 255, nullable: true })
  modelNameSnapshot?: string;

  @Column({ name: 'provider_snapshot', type: 'jsonb', default: '{}' })
  providerSnapshot!: Record<string, any>;

  @Column({ length: 30, default: 'pending' })
  status!: string;

  @Column({ type: 'text' })
  prompt!: string;

  @Column({ type: 'jsonb', default: '{}' })
  options!: Record<string, any>;

  @Column({ name: 'external_job_id', length: 255, nullable: true })
  externalJobId?: string;

  @Column({ name: 'provider_generation_id', length: 255, nullable: true })
  providerGenerationId?: string;

  @Column({ name: 'output_urls', type: 'jsonb', default: '[]' })
  outputUrls!: string[];

  @Column({ type: 'jsonb', default: '{}' })
  usage!: Record<string, any>;

  @Column({ name: 'estimated_min_vnd', type: 'bigint', default: 0 })
  estimatedMinVnd!: number;

  @Column({ name: 'estimated_max_vnd', type: 'bigint', default: 0 })
  estimatedMaxVnd!: number;

  @Column({
    name: 'actual_cost_usd',
    type: 'decimal',
    precision: 18,
    scale: 10,
    nullable: true,
  })
  actualCostUsd?: string;

  @Column({ name: 'charged_vnd', type: 'bigint', nullable: true })
  chargedVnd?: number;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @ManyToOne(() => AiModel, { nullable: true, createForeignKeyConstraints: false })
  @JoinColumn({ name: 'model_slug', referencedColumnName: 'openrouterSlug' })
  model?: AiModel;

  @OneToMany(() => AiGenerationAsset, (link) => link.generation)
  linkedAssets?: AiGenerationAsset[];
}
