import {
  Entity, Column, PrimaryGeneratedColumn,
  CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn,
  OneToMany, OneToOne,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { AiProvider } from '../../ai-provider/entities/ai-provider.entity';
import { AiElementImage } from './ai-element-image.entity';
import { AiElementVideo } from './ai-element-video.entity';

@Entity({ name: 'ai_elements', schema: 'public' })
export class AiElement {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: number;

  @Column({ name: 'user_id', type: 'bigint' })
  userId!: number;

  @Column({ name: 'provider_id', type: 'bigint' })
  providerId!: number;

  @Column({ name: 'project_id', type: 'bigint', nullable: true })
  projectId!: number | null;

  @Column({ name: 'element_name', type: 'varchar', length: 20 })
  elementName!: string;

  @Column({ name: 'element_description', type: 'varchar', length: 100 })
  elementDescription!: string;

  @Column({ name: 'reference_type', type: 'varchar', length: 20 })
  referenceType!: string; // 'image_refer' | 'video_refer'

  @Column({ name: 'external_element_id', type: 'varchar', length: 255, nullable: true })
  externalElementId!: string | null;

  @Column({ type: 'varchar', length: 50, default: 'pending' })
  status!: string; // pending | processing | succeeded | failed

  @Column({ name: 'element_voice_id', type: 'varchar', length: 255, nullable: true })
  elementVoiceId!: string | null;

  @Column({ name: 'tag_list', type: 'jsonb', default: '[]' })
  tagList!: any[];

  @Column({ name: 'request_payload', type: 'jsonb', default: '{}' })
  requestPayload!: object;

  @Column({ name: 'response_payload', type: 'jsonb', default: '{}' })
  responsePayload!: object;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ name: 'is_favorite', type: 'boolean', default: false })
  isFavorite!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @ManyToOne(() => AiProvider)
  @JoinColumn({ name: 'provider_id' })
  provider!: AiProvider;

  @OneToMany(() => AiElementImage, (img) => img.element)
  images!: AiElementImage[];

  @OneToOne(() => AiElementVideo, (vid) => vid.element)
  video!: AiElementVideo;
}