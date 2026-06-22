import {
  Entity, Column, PrimaryGeneratedColumn,
  CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { AiModel } from '../../ai-models/entities/ai-model.entity';
import { Asset } from '../../assets/entities/asset.entity';

/**
 * Maps to: public.motion_generations
 *
 * Bảng riêng cho Motion Control (tách khỏi video_generations).
 * DB dùng GENERATED ALWAYS AS IDENTITY cho id.
 *
 * Chỉ model có supports_motion_control = true mới dùng bảng này.
 * (Kling v2.6 và Kling v3)
 */
@Entity({ name: 'motion_generations', schema: 'public' })
export class MotionGeneration {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: number;

  // ── FK columns ──────────────────────────────────────────────────────────
  @Column({ name: 'project_id', type: 'bigint' })
  projectId!: number;

  @Column({ name: 'model_id', type: 'bigint' })
  modelId!: number;

  /** Ảnh nhân vật (bắt buộc, NOT NULL trong DB) */
  @Column({ name: 'character_image_asset_id', type: 'bigint' })
  characterImageAssetId!: number;

  /** Video tham chiếu chuyển động (bắt buộc, NOT NULL trong DB) */
  @Column({ name: 'motion_reference_asset_id', type: 'bigint' })
  motionReferenceAssetId!: number;

  @Column({ name: 'output_asset_id', type: 'bigint', nullable: true })
  outputAssetId?: number;

  @Column({ name: 'thumbnail_asset_id', type: 'bigint', nullable: true })
  thumbnailAssetId?: number;

  // ── Motion settings ──────────────────────────────────────────────────────
  /**
   * 'image': hướng nhân vật theo ảnh (video ref tối đa 10s)
   * 'video': hướng nhân vật theo video (video ref tối đa 30s)
   */
  @Column({ name: 'character_orientation', length: 10, nullable: true })
  characterOrientation?: string;

  /** std | pro — DB default: 'pro' */
  @Column({ name: 'generation_mode', length: 20, default: 'pro' })
  generationMode!: string;

  @Column({ name: 'motion_prompt', type: 'text', nullable: true })
  motionPrompt?: string;

  @Column({ name: 'negative_prompt', type: 'text', nullable: true })
  negativePrompt?: string;

  @Column({ name: 'duration_seconds', type: 'int', nullable: true })
  durationSeconds?: number;

  @Column({ name: 'fps', type: 'int', nullable: true })
  fps?: number;

  /** Giữ âm thanh từ video gốc — DB column: generation_sound */
  @Column({ name: 'generation_sound', type: 'boolean', default: true })
  generationSound!: boolean;

  // ── Status & external task ───────────────────────────────────────────────
  @Column({ length: 50, default: 'pending' })
  status!: string; // pending | queued | processing | succeeded | failed | cancelled

  @Column({ name: 'external_task_id', length: 255, nullable: true })
  externalTaskId?: string;

  // ── Payload / metadata ───────────────────────────────────────────────────
  @Column({ type: 'jsonb', default: '{}' })
  params!: object;

  @Column({ name: 'request_payload', type: 'jsonb', default: '{}' })
  requestPayload!: object;

  @Column({ name: 'response_payload', type: 'jsonb', default: '{}' })
  responsePayload!: object;

  @Column({ name: 'result_payload', type: 'jsonb', default: '{}' })
  resultPayload!: object;

  // ── Error ────────────────────────────────────────────────────────────────
  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string;

  // ── Cost & timing ────────────────────────────────────────────────────────
  /** Đơn vị: VND (integer) — DB type: bigint */
  @Column({ name: 'cost', type: 'bigint', nullable: true })
  cost?: number;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt?: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  // ── Relations ────────────────────────────────────────────────────────────
  @ManyToOne(() => AiModel)
  @JoinColumn({ name: 'model_id' })
  model!: AiModel;

  @ManyToOne(() => Asset)
  @JoinColumn({ name: 'character_image_asset_id' })
  characterImageAsset!: Asset;

  @ManyToOne(() => Asset)
  @JoinColumn({ name: 'motion_reference_asset_id' })
  motionReferenceAsset!: Asset;

  @ManyToOne(() => Asset)
  @JoinColumn({ name: 'output_asset_id' })
  outputAsset!: Asset;

  @ManyToOne(() => Asset)
  @JoinColumn({ name: 'thumbnail_asset_id' })
  thumbnailAsset!: Asset;
}