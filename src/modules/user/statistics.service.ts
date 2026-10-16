import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User } from './entities/user.entity';

@Injectable()
export class StatisticsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
  ) {}
  async getStats(userId: number) {
    const [row] = await this.dataSource.query(
      `SELECT
        COUNT(*) FILTER (WHERE modality = 'chat' AND status = 'succeeded')::int AS total_prompts,
        COUNT(*) FILTER (WHERE modality = 'image' AND status = 'succeeded')::int AS total_images,
        COUNT(*) FILTER (WHERE modality = 'video' AND status = 'succeeded')::int AS total_videos,
        COALESCE(SUM(charged_vnd) FILTER (WHERE status = 'succeeded'), 0)::bigint AS total_cost
       FROM ai_generations WHERE user_id = $1`,
      [userId],
    );
    return {
      totalPrompts: Number(row?.total_prompts ?? 0),
      totalImages: Number(row?.total_images ?? 0),
      totalVideos: Number(row?.total_videos ?? 0),
      totalCost: Number(row?.total_cost ?? 0),
    };
  }

  async getDailyStats(userId: number, month: number, year: number) {
    return this.dailyStats(
      'WHERE user_id = $1',
      [userId, month, year],
      month,
      year,
    );
  }

  async getSystemStats() {
    const [row] = await this.dataSource.query(
      `SELECT
        COUNT(*) FILTER (WHERE modality = 'chat' AND status = 'succeeded')::int AS total_prompts,
        COUNT(*) FILTER (WHERE modality = 'image' AND status = 'succeeded')::int AS total_images,
        COUNT(*) FILTER (WHERE modality = 'video' AND status = 'succeeded')::int AS total_videos,
        COALESCE(SUM(charged_vnd) FILTER (WHERE status = 'succeeded'), 0)::bigint AS total_cost
       FROM ai_generations`,
    );
    return {
      totalPrompts: Number(row?.total_prompts ?? 0),
      totalImages: Number(row?.total_images ?? 0),
      totalVideos: Number(row?.total_videos ?? 0),
      totalCost: Number(row?.total_cost ?? 0),
    };
  }

  async getSystemDailyStats(month: number, year: number) {
    return this.dailyStats('', [month, year], month, year);
  }

  private async dailyStats(
    userClause: string,
    params: number[],
    month: number,
    year: number,
  ) {
    const userScoped = Boolean(userClause);
    const monthParam = userScoped ? '$2' : '$1';
    const yearParam = userScoped ? '$3' : '$2';
    const rows = await this.dataSource.query(
      `SELECT EXTRACT(DAY FROM created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::int AS day,
        modality, COUNT(*)::int AS cnt, COALESCE(SUM(charged_vnd), 0)::bigint AS cost
       FROM ai_generations ${userClause}
       ${userScoped ? 'AND' : 'WHERE'} status = 'succeeded'
         AND EXTRACT(MONTH FROM created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') = ${monthParam}
         AND EXTRACT(YEAR FROM created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') = ${yearParam}
       GROUP BY 1, 2`,
      params,
    );
    const map = new Map<string, { cnt: number; cost: number }>();
    for (const row of rows) {
      map.set(`${row.day}:${row.modality}`, {
        cnt: Number(row.cnt),
        cost: Number(row.cost),
      });
    }
    const generations: Array<{
      day: number;
      prompt: number;
      images: number;
      videos: number;
      audio: number;
    }> = [];
    const spending: Array<{ day: number; total: number }> = [];
    for (let day = 1; day <= new Date(year, month, 0).getDate(); day++) {
      const chat = map.get(`${day}:chat`) ?? { cnt: 0, cost: 0 };
      const image = map.get(`${day}:image`) ?? { cnt: 0, cost: 0 };
      const video = map.get(`${day}:video`) ?? { cnt: 0, cost: 0 };
      const audio = map.get(`${day}:audio`) ?? { cnt: 0, cost: 0 };
      generations.push({
        day,
        prompt: chat.cnt,
        images: image.cnt,
        videos: video.cnt,
        audio: audio.cnt,
      });
      spending.push({
        day,
        total: chat.cost + image.cost + video.cost + audio.cost,
      });
    }
    return { generations, spending };
  }

  async getEmployeeStats() {
    const now = new Date();
    const [total, active, banned, rows] = await Promise.all([
      this.userRepository.count({ where: { roleId: 2 } }),
      this.userRepository.count({ where: { roleId: 2, status: 'active' } }),
      this.userRepository.count({ where: { roleId: 2, status: 'banned' } }),
      this.dataSource.query(
        `SELECT COALESCE(SUM(g.charged_vnd), 0)::bigint AS monthly_spending
         FROM ai_generations g JOIN users u ON u.id = g.user_id
         WHERE u.role_id = 2 AND g.status = 'succeeded'
           AND EXTRACT(MONTH FROM g.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') = $1
           AND EXTRACT(YEAR FROM g.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') = $2`,
        [now.getMonth() + 1, now.getFullYear()],
      ),
    ]);
    return {
      total,
      active,
      banned,
      monthlySpending: Number(rows[0]?.monthly_spending ?? 0),
    };
  }
}
