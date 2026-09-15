import {
  Entity, Column, PrimaryGeneratedColumn,
  CreateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { VideoGeneration } from './video-generation.entity';
import { AiElement } from '../../elements/entities/ai-element.entity';

/**
 * Maps to: public.video_generation_elements
 * Bảng nối many-to-many giữa video_generations và ai_elements.
 * Bảng này đã tồn tại sẵn trong DB, chỉ cần map entity — không cần migration.
 */
@Entity({ name: 'video_generation_elements', schema: 'public' })
export class VideoGenerationElement {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: number;

  @Column({ name: 'video_generation_id', type: 'bigint' })
  videoGenerationId!: number;

  @Column({ name: 'element_id', type: 'bigint' })
  elementId!: number;

  /** Số thứ tự tag dùng khi prompt cần refer <<<element_N>>> — lưu '1' | '2' | '3' */
  @Column({ name: 'tag_id', length: 10, nullable: true })
  tagId?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @ManyToOne(() => VideoGeneration, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'video_generation_id' })
  videoGeneration!: VideoGeneration;

  @ManyToOne(() => AiElement)
  @JoinColumn({ name: 'element_id' })
  element!: AiElement;
}