import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'chat_messages', schema: 'public' })
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string;

  @Column({ length: 20 })
  role!: 'user' | 'assistant' | 'system';

  @Column({ type: 'text' })
  content!: string;

  @Column({ name: 'input_tokens', type: 'int', nullable: true })
  inputTokens?: number;

  @Column({ name: 'output_tokens', type: 'int', nullable: true })
  outputTokens?: number;

  @Column({
    name: 'cost_usd',
    type: 'decimal',
    precision: 18,
    scale: 10,
    nullable: true,
  })
  costUsd?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
