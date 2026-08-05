import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { AiElement } from './ai-element.entity';
import { Asset } from '../../assets/entities/asset.entity';

@Entity({ name: 'ai_element_images', schema: 'public' })
export class AiElementImage {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: number;

  @Column({ name: 'element_id', type: 'bigint' })
  elementId!: number;

  @Column({ name: 'asset_id', type: 'bigint' })
  assetId!: number;

  @Column({ name: 'image_role', type: 'varchar', length: 20 })
  imageRole!: string; // 'frontal' | 'refer'

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @ManyToOne(() => AiElement, (el) => el.images, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'element_id' })
  element!: AiElement;

  @ManyToOne(() => Asset)
  @JoinColumn({ name: 'asset_id' })
  asset!: Asset;
}