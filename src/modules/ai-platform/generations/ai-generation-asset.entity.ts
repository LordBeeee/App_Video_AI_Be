import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Asset } from '../../assets/entities/asset.entity';
import { AiGeneration } from './ai-generation.entity';

@Entity({ name: 'ai_generation_assets', schema: 'public' })
export class AiGenerationAsset {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'generation_id', type: 'uuid' })
  generationId!: string;

  @Column({ name: 'asset_id', type: 'bigint' })
  assetId!: number;

  @Column({ length: 30 })
  role!: 'input' | 'reference' | 'output' | 'thumbnail';

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @ManyToOne(() => AiGeneration, (generation) => generation.linkedAssets, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'generation_id' })
  generation!: AiGeneration;

  @ManyToOne(() => Asset, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'asset_id' })
  asset!: Asset;
}
