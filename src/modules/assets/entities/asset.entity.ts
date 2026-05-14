import {
  Entity, Column, PrimaryGeneratedColumn,
  CreateDateColumn, ManyToOne, JoinColumn
} from 'typeorm';
import { User } from '../../user/entities/user.entity';

@Entity({ name: 'assets', schema: 'public' })
export class Asset {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: number;

  @Column({ name: 'user_id', type: 'bigint' })
  userId!: number;

  @Column({ name: 'project_id', type: 'bigint', nullable: true })
  projectId!: number;

  @Column({ name: 'scene_id', type: 'bigint', nullable: true })
  sceneId!: number;

  @Column({ name: 'asset_type', length: 50 })
  assetType!: string; // image | video | thumbnail ...

  @Column({ name: 'asset_role', length: 50, nullable: true })
  assetRole!: string; // image_begin | image_end | scene_video ...

  @Column({ name: 'source_type', length: 50, default: 'generated' })
  sourceType!: string; // uploaded | generated | external

  @Column({ name: 'original_url', type: 'text', nullable: true })
  originalUrl!: string;

  @Column({ name: 'stored_url', type: 'text' })
  storedUrl!: string;

  @Column({ name: 'thumbnail_url', type: 'text', nullable: true })
  thumbnailUrl!: string;

  @Column({ name: 'storage_provider', length: 50, nullable: true })
  storageProvider!: string; // cloudinary

  @Column({ name: 'mime_type', length: 100, nullable: true })
  mimeType!: string;

  @Column({ name: 'file_size_bytes', type: 'bigint', nullable: true })
  fileSizeBytes!: number;

  @Column({ type: 'jsonb', default: '{}' })
  metadata!: object;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user!: User;
}