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

  async getDailyStats(userId: number, month: number, year: number) {
    const daysInMonth = new Date(year, month, 0).getDate();
    const TZ = 'Asia/Ho_Chi_Minh';

    const [promptRows, imageRows, videoRows] = await Promise.all([
      this.dataSource.query(
        `SELECT
           EXTRACT(DAY FROM pg.created_at AT TIME ZONE $4)::int AS day,
           COUNT(*)::int                                          AS cnt,
           COALESCE(SUM(pg.cost), 0)::bigint                    AS cost
         FROM prompt_generations pg
         JOIN projects p ON p.id = pg.project_id
         WHERE p.user_id = $1
           AND pg.status = 'succeeded'
           AND EXTRACT(MONTH FROM pg.created_at AT TIME ZONE $4) = $2
           AND EXTRACT(YEAR  FROM pg.created_at AT TIME ZONE $4) = $3
         GROUP BY 1`,
        [userId, month, year, TZ],
      ),

      this.dataSource.query(
        `SELECT
           EXTRACT(DAY FROM ig.created_at AT TIME ZONE $4)::int AS day,
           COUNT(*)::int                                          AS cnt,
           COALESCE(SUM(ig.cost), 0)::bigint                    AS cost
         FROM image_generations ig
         JOIN projects p ON p.id = ig.project_id
         WHERE p.user_id = $1
           AND ig.status = 'succeeded'
           AND EXTRACT(MONTH FROM ig.created_at AT TIME ZONE $4) = $2
           AND EXTRACT(YEAR  FROM ig.created_at AT TIME ZONE $4) = $3
         GROUP BY 1`,
        [userId, month, year, TZ],
      ),

      this.dataSource.query(
        `SELECT
           EXTRACT(DAY FROM vg.created_at AT TIME ZONE $4)::int AS day,
           COUNT(*)::int                                          AS cnt,
           COALESCE(SUM(vg.cost), 0)::bigint                    AS cost
         FROM video_generations vg
         JOIN projects p ON p.id = vg.project_id
         WHERE p.user_id = $1
           AND vg.status = 'succeeded'
           AND EXTRACT(MONTH FROM vg.created_at AT TIME ZONE $4) = $2
           AND EXTRACT(YEAR  FROM vg.created_at AT TIME ZONE $4) = $3
         GROUP BY 1`,
        [userId, month, year, TZ],
      ),
    ]);

    type DayEntry = { cnt: number; cost: number };
    const toMap = (rows: any[]): Record<number, DayEntry> =>
      Object.fromEntries(
        rows.map((r) => [r.day, { cnt: Number(r.cnt), cost: Number(r.cost) }]),
      );

    const pm = toMap(promptRows);
    const im = toMap(imageRows);
    const vm = toMap(videoRows);

    const generations: { day: number; prompt: number; images: number; videos: number }[] = [];
    const spending:    { day: number; total: number }[] = [];

    for (let d = 1; d <= daysInMonth; d++) {
      generations.push({
        day:    d,
        prompt: pm[d]?.cnt  ?? 0,
        images: im[d]?.cnt  ?? 0,
        videos: vm[d]?.cnt  ?? 0,
      });
      spending.push({
        day:   d,
        total: (pm[d]?.cost ?? 0) + (im[d]?.cost ?? 0) + (vm[d]?.cost ?? 0),
      });
    }

    return { generations, spending };
  }

  findById(id: number) {
    return this.userRepository.findOne({
      where: { id },
      relations: ['role'],
    });
  }

  findAll() {
    // Không trả passwordHash
    return this.userRepository.find({
      select: {
        id: true,
        email: true,
        fullName: true,
        avatarUrl: true,
        roleId: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
      },
      relations: ['role'],
    });
  }
}