import { Injectable } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User } from './entities/user.entity';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  findByEmail(email: string) {
    return this.userRepository.findOne({
      where: { email },
      relations: ['role'],
    });
  }

  findAll() {
    return this.userRepository.find();
  }

  async findMe(userId: number) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['role'],
    });

    if (!user) return null;

    return {
      id:          user.id,
      email:       user.email,
      fullName:    user.fullName,
      avatarUrl:   user.avatarUrl,
      roleId:      user.roleId,
      roleName:    user.role?.name,
      status:      user.status,
      lastLoginAt: user.lastLoginAt,
      createdAt:   user.createdAt,
      updatedAt:   user.updatedAt,
    };
  }

  async updateLastLogin(userId: number) {
    await this.userRepository.update(userId, {
      lastLoginAt: new Date(),
      updatedAt:   new Date(),
    });
  }

  async getStats(userId: number) {
    const rows = await this.dataSource.query(
      `SELECT total_prompts, total_images, total_videos, total_cost
       FROM v_user_stats
       WHERE user_id = $1`,
      [userId],
    );

    const row = rows[0] ?? {
      total_prompts: 0,
      total_images:  0,
      total_videos:  0,
      total_cost:    0,
    };

    return {
      totalPrompts: Number(row.total_prompts),
      totalImages:  Number(row.total_images),
      totalVideos:  Number(row.total_videos),
      totalCost:    Number(row.total_cost),
    };
  }
}