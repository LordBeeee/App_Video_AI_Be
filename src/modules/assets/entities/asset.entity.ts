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
  projectId!: number | null;

  @Column({ name: 'scene_id', type: 'bigint', nullable: true })
  sceneId!: number | null;

  @Column({ name: 'asset_type', type: 'varchar', length: 50 })
  assetType!: string;

  @Column({ name: 'asset_role', type: 'varchar', length: 50, nullable: true })
  assetRole!: string | null;

  @Column({ name: 'source_type', type: 'varchar', length: 50, default: 'generated' })
  sourceType!: string;

  @Column({ name: 'original_url', type: 'text', nullable: true })
  originalUrl!: string | null;

  @Column({ name: 'stored_url', type: 'text' })
  storedUrl!: string;

  @Column({ name: 'thumbnail_url', type: 'text', nullable: true })
  thumbnailUrl!: string | null;

  @Column({ name: 'storage_provider', type: 'varchar', length: 50, nullable: true })
  storageProvider!: string | null;

  @Column({ name: 'mime_type', type: 'varchar', length: 100, nullable: true })
  mimeType!: string | null;

  @Column({ name: 'file_size_bytes', type: 'bigint', nullable: true })
  fileSizeBytes!: number | null;

  @Column({ name: 'duration_seconds', type: 'int', nullable: true })
  durationSeconds!: number | null;

    @Column({ type: 'int', nullable: true })
  fps!: number | null;

  @Column({ type: 'int', nullable: true })
  width!: number | null;

  @Column({ type: 'int', nullable: true })
  height!: number | null;

  @Column({ name: 'is_favorite', type: 'boolean', default: false })
  isFavorite!: boolean;

  @Column({ type: 'jsonb', default: '{}' })
  metadata!: object;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user!: User;
}