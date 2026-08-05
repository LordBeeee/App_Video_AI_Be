import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn, OneToOne } from 'typeorm';
import { AiElement } from './ai-element.entity';
import { Asset } from '../../assets/entities/asset.entity';

@Entity({ name: 'ai_element_videos', schema: 'public' })
export class AiElementVideo {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: number;

  @Column({ name: 'element_id', type: 'bigint' })
  elementId!: number;

  @Column({ name: 'asset_id', type: 'bigint' })
  assetId!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @OneToOne(() => AiElement, (el) => el.video, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'element_id' })
  element!: AiElement;

  @ManyToOne(() => Asset)
  @JoinColumn({ name: 'asset_id' })
  asset!: Asset;
}