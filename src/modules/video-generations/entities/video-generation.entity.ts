import {
  Entity, Column, PrimaryGeneratedColumn,
  CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn
} from 'typeorm';
import { AiModel } from '../../ai-models/entities/ai-model.entity';
import { Asset } from '../../assets/entities/asset.entity';

@Entity({ name: 'video_generations', schema: 'public' })
export class VideoGeneration {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: number;

  @Column({ name: 'project_id', type: 'bigint' })
  projectId!: number;

  @Column({ name: 'model_id', type: 'bigint' })
  modelId!: number;

  @Column({ name: 'image_begin_asset_id', type: 'bigint', nullable: true })
  imageBeginAssetId!: number;

  @Column({ name: 'image_end_asset_id', type: 'bigint', nullable: true })
  imageEndAssetId!: number;

  @Column({ name: 'motion_prompt', type: 'text' })
  motionPrompt!: string;

  @Column({ name: 'negative_prompt', type: 'text', nullable: true })
  negativePrompt!: string;

  @Column({ length: 50, default: 'pending' })
  status!: string; // pending | queued | processing | succeeded | failed | cancelled

  @Column({ name: 'external_task_id', length: 255, nullable: true })
  externalTaskId!: string;

  @Column({ name: 'output_asset_id', type: 'bigint', nullable: true })
  outputAssetId!: number;

  @Column({ name: 'duration_seconds', type: 'int', nullable: true })
  durationSeconds!: number;

  @Column({ name: 'aspect_ratio', length: 20, nullable: true })
  aspectRatio!: string;

  @Column({ name: 'result_payload', type: 'jsonb', default: '{}' })
  resultPayload!: object;
  
  @Column({ type: 'jsonb', default: '{}' })
  params!: object;

  @Column({ name: 'request_payload', type: 'jsonb', default: '{}' })
  requestPayload!: object;

  @Column({ name: 'response_payload', type: 'jsonb', default: '{}' })
  responsePayload!: object;

  @Column({ name: 'error_code', length: 100, nullable: true })
  errorCode!: string;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string;

  @Column({ name: 'cost', type: 'decimal', precision: 12, scale: 6, nullable: true })
  cost!: number;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Column({ name: 'generation_type', length: 50, default: 'standard' })
  generationType!: string; // 'standard' | 'motion_control'

  @Column({ name: 'motion_reference_asset_id', type: 'bigint', nullable: true })
  motionReferenceAssetId!: number;

  @Column({ name: 'keep_original_sound', type: 'boolean', default: true })
  keepOriginalSound!: boolean;

  @Column({ name: 'character_orientation', length: 10, nullable: true })
  characterOrientation!: string; // 'image' | 'video'

  @Column({ name: 'generation_mode', length: 20, default: 'std' })
  generationMode!: string; // 'std' | 'pro' | '4k'

  // Thêm relation cho motion reference asset:
  @ManyToOne(() => Asset)
  @JoinColumn({ name: 'motion_reference_asset_id' })
  motionReferenceAsset!: Asset;

  @ManyToOne(() => AiModel)
  @JoinColumn({ name: 'model_id' })
  model!: AiModel;

  @ManyToOne(() => Asset)
  @JoinColumn({ name: 'image_begin_asset_id' })
  imageBeginAsset!: Asset;

  @ManyToOne(() => Asset)
  @JoinColumn({ name: 'image_end_asset_id' })
  imageEndAsset!: Asset;

  @ManyToOne(() => Asset)
  @JoinColumn({ name: 'output_asset_id' })
  outputAsset!: Asset;
}