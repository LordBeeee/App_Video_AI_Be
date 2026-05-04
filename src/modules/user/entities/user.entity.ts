import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('increment')
  id!: number

  @Column({ name: 'role_id' })
  roleId!: number

  @Column()
  email!: string

  @Column({ name: 'password_hash' })
  passwordHash!: string

  @Column({ name: 'full_name', nullable: true })
  fullName?: string

  @Column({ name: 'avatar_url', nullable: true })
  avatarUrl?: string

  @Column()
  status!: string

  @Column({ name: 'last_login_at', nullable: true })
  lastLoginAt?: Date

  @Column({ name: 'created_at' })
  createdAt!: Date

  @Column({ name: 'updated_at' })
  updatedAt!: Date
}