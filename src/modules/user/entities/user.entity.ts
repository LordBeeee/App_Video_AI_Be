import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'
import { JoinColumn, ManyToOne } from 'typeorm';
import { Role } from './role.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('increment')
  id!: number

  @Column({ name: 'role_id' })
  roleId!: number

  @ManyToOne(() => Role, (role) => role.users)
  @JoinColumn({ name: 'role_id' })
  role!: Role;
  
  @Column()
  email!: string

  @Column({ name: 'password_hash' })
  passwordHash!: string

  @Column({ name: 'full_name', nullable: true })
  fullName?: string

  @Column({ name: 'avatar_url', nullable: true })
  avatarUrl?: string

  @Column({ nullable: true })
  phone?: string
  
  @Column()
  status!: string

  @Column({ name: 'last_login_at', nullable: true })
  lastLoginAt?: Date

  @Column({ name: 'created_at' })
  createdAt!: Date

  @Column({ name: 'updated_at' })
  updatedAt!: Date
}