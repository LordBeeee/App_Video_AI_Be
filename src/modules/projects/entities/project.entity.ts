import {
  Entity, Column, PrimaryGeneratedColumn,
  CreateDateColumn, UpdateDateColumn
} from 'typeorm';

@Entity({ name: 'projects', schema: 'public' })
export class Project {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: number;

  @Column({ name: 'user_id', type: 'bigint' })
  userId!: number;

  @Column({ length: 255 })
  title!: string;

  @Column({ name: 'workflow_mode', length: 50, default: 'video_only' })
  workflowMode!: string;

  @Column({ length: 50, default: 'draft' })
  status!: string;

  @Column({ name: 'prompt_step_status', length: 50, default: 'skipped' })
  promptStepStatus!: string;

  @Column({ name: 'image_step_status', length: 50, default: 'skipped' })
  imageStepStatus!: string;

  @Column({ name: 'video_step_status', length: 50, default: 'pending' })
  videoStepStatus!: string;

  @Column({ type: 'jsonb', default: '{}' })
  metadata!: object;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}