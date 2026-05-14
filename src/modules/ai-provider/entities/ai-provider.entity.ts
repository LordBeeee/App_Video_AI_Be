import { Entity, Column, PrimaryGeneratedColumn, OneToMany, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { AiModel } from '../../ai-models/entities/ai-model.entity';

@Entity({ name: 'ai_providers', schema: 'public' })
export class AiProvider {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: number;

  @Column({ length: 100 })
  code!: string;

  @Column({ length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string;

  @Column({ name: 'provider_type', length: 50, nullable: true })
  providerType!: string;

  @Column({ name: 'base_url', type: 'text', nullable: true })
  baseUrl!: string;

  @Column({ name: 'provider_config', type: 'jsonb', nullable: true })
  providerConfig!: object;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @OneToMany(() => AiModel, model => model.provider)
  models!: AiModel[];
}