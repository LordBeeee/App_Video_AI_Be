import { Injectable, NotFoundException } from '@nestjs/common';
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
  async getExpenseOverview(daysInput: number, from?: string, to?: string) {
    const r = this.rangeOf(daysInput, from, to);
    const days = r.days;
    const tz = 'Asia/Ho_Chi_Minh';
    const range = `g.created_at >= (${r.end} - ($1::int - 1) * interval '1 day') AT TIME ZONE '${tz}' AND g.created_at < (${r.end} + interval '1 day') AT TIME ZONE '${tz}'`;
    const [kpiRows, trend, byModel, byTask, byEmployee, dayTask] = await Promise.all([
      this.dataSource.query(
        `SELECT COALESCE(SUM(g.charged_vnd) FILTER (WHERE g.status = 'succeeded'), 0)::bigint AS total_cost,
          COUNT(*)::int AS total_requests,
          COUNT(*) FILTER (WHERE g.status = 'succeeded')::int AS succeeded,
          COUNT(*) FILTER (WHERE g.status = 'failed')::int AS failed,
          COUNT(DISTINCT g.user_id) FILTER (WHERE g.status = 'succeeded')::int AS active_spenders
         FROM ai_generations g JOIN users u ON u.id = g.user_id
         WHERE u.role_id = 2 AND ${range}`,
        [days],
      ),
      this.dataSource.query(
        `SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
          COALESCE(SUM(g.charged_vnd), 0)::bigint AS cost,
          COUNT(g.id)::int AS requests
         FROM generate_series(
           ${r.end} - ($1::int - 1) * interval '1 day',
           ${r.end}, interval '1 day') AS d(day)
         LEFT JOIN (
           SELECT g.id, g.charged_vnd, date_trunc('day', g.created_at AT TIME ZONE '${tz}') AS day
           FROM ai_generations g JOIN users u ON u.id = g.user_id
           WHERE u.role_id = 2 AND g.status = 'succeeded' AND ${range}
         ) g ON g.day = d.day
         GROUP BY d.day ORDER BY d.day`,
        [days],
      ),
      this.dataSource.query(
        `SELECT COALESCE(g.model_name_snapshot, g.model_slug) AS name, g.modality,
          COUNT(*)::int AS requests, COALESCE(SUM(g.charged_vnd), 0)::bigint AS cost
         FROM ai_generations g JOIN users u ON u.id = g.user_id
         WHERE u.role_id = 2 AND g.status = 'succeeded' AND ${range}
         GROUP BY 1, 2 ORDER BY cost DESC LIMIT 8`,
        [days],
      ),
      this.dataSource.query(
        `SELECT g.modality, COUNT(*)::int AS requests, COALESCE(SUM(g.charged_vnd), 0)::bigint AS cost
         FROM ai_generations g JOIN users u ON u.id = g.user_id
         WHERE u.role_id = 2 AND g.status = 'succeeded' AND ${range}
         GROUP BY 1 ORDER BY cost DESC`,
        [days],
      ),
      this.dataSource.query(
        `SELECT u.id, u.full_name, u.email, u.avatar_url, u.status,
          COUNT(g.id)::int AS requests,
          COUNT(g.id) FILTER (WHERE g.status = 'succeeded')::int AS succeeded,
          COUNT(g.id) FILTER (WHERE g.status = 'failed')::int AS failed,
          COALESCE(SUM(g.charged_vnd) FILTER (WHERE g.status = 'succeeded'), 0)::bigint AS cost,
          COALESCE(SUM(g.charged_vnd) FILTER (WHERE g.status = 'succeeded' AND g.modality = 'chat'), 0)::bigint AS cost_chat,
          COALESCE(SUM(g.charged_vnd) FILTER (WHERE g.status = 'succeeded' AND g.modality = 'image'), 0)::bigint AS cost_image,
          COALESCE(SUM(g.charged_vnd) FILTER (WHERE g.status = 'succeeded' AND g.modality = 'video'), 0)::bigint AS cost_video,
          COALESCE(SUM(g.charged_vnd) FILTER (WHERE g.status = 'succeeded' AND g.modality = 'audio'), 0)::bigint AS cost_audio,
          COUNT(g.id) FILTER (WHERE g.status = 'succeeded' AND g.modality = 'chat')::int AS req_chat,
          COUNT(g.id) FILTER (WHERE g.status = 'succeeded' AND g.modality = 'image')::int AS req_image,
          COUNT(g.id) FILTER (WHERE g.status = 'succeeded' AND g.modality = 'video')::int AS req_video,
          COUNT(g.id) FILTER (WHERE g.status = 'succeeded' AND g.modality = 'audio')::int AS req_audio,
          MAX(g.created_at) AS last_used_at
         FROM users u
         LEFT JOIN ai_generations g ON g.user_id = u.id AND ${range}
         WHERE u.role_id = 2
         GROUP BY u.id ORDER BY cost DESC, u.id`,
        [days],
      ),
      this.dataSource.query(
        `SELECT to_char(date_trunc('day', g.created_at AT TIME ZONE '${tz}'), 'YYYY-MM-DD') AS day,
          g.modality, COUNT(*)::int AS requests, COALESCE(SUM(g.charged_vnd), 0)::bigint AS cost
         FROM ai_generations g JOIN users u ON u.id = g.user_id
         WHERE u.role_id = 2 AND g.status = 'succeeded' AND ${range}
         GROUP BY 1, 2`,
        [days],
      ),
    ]);
    const efficiency = await this.efficiency(r);
    const hourly = days === 1 ? await this.hourly(r) : [];
    const k = kpiRows[0] ?? {};
    const totalCost = Number(k.total_cost ?? 0);
    const succeeded = Number(k.succeeded ?? 0);
    return {
      days,
      hourly,
      efficiency,
      kpis: {
        totalCost,
        totalRequests: Number(k.total_requests ?? 0),
        succeeded,
        failed: Number(k.failed ?? 0),
        activeSpenders: Number(k.active_spenders ?? 0),
        avgCostPerSuccess: succeeded ? Math.round(totalCost / succeeded) : 0,
      },
      trend: trend.map((r: any) => ({
        day: r.day,
        cost: Number(r.cost),
        requests: Number(r.requests),
      })),
      byModel: byModel.map((r: any) => ({
        name: r.name,
        modality: r.modality,
        requests: Number(r.requests),
        cost: Number(r.cost),
      })),
      byTask: byTask.map((r: any) => ({
        modality: r.modality,
        requests: Number(r.requests),
        cost: Number(r.cost),
      })),
      trendByTask: this.mergeDayTask(trend, dayTask),
      employees: byEmployee.map((r: any) => ({
        id: Number(r.id),
        fullName: r.full_name,
        email: r.email,
        avatarUrl: r.avatar_url,
        status: r.status,
        requests: Number(r.requests),
        succeeded: Number(r.succeeded),
        failed: Number(r.failed),
        cost: Number(r.cost),
        costByTask: {
          chat: Number(r.cost_chat),
          image: Number(r.cost_image),
          video: Number(r.cost_video),
          audio: Number(r.cost_audio),
        },
        requestsByTask: {
          chat: Number(r.req_chat),
          image: Number(r.req_image),
          video: Number(r.req_video),
          audio: Number(r.req_audio),
        },
        lastUsedAt: r.last_used_at,
      })),
    };
  }
  private mergeDayTask(trend: Array<{ day: string }>, rows: any[]) {
    const map = new Map<string, Record<string, { requests: number; cost: number }>>();
    rows.forEach((r: any) => {
      const day = map.get(r.day) ?? {};
      day[r.modality] = { requests: Number(r.requests), cost: Number(r.cost) };
      map.set(r.day, day);
    });
    return trend.map((t) => ({ day: t.day, tasks: map.get(t.day) ?? {} }));
  }

  async getEmployeeAiUsage(userId: number, daysInput: number, from?: string, to?: string) {
    const r = this.rangeOf(daysInput, from, to);
    const days = r.days;
    const tz = 'Asia/Ho_Chi_Minh';
    const range = `g.created_at >= (${r.end} - ($2::int - 1) * interval '1 day') AT TIME ZONE '${tz}' AND g.created_at < (${r.end} + interval '1 day') AT TIME ZONE '${tz}'`;
    const [user] = await this.dataSource.query(
      `SELECT id, full_name, email, avatar_url, status, last_login_at
       FROM users WHERE id = $1 AND role_id = 2`,
      [userId],
    );
    if (!user) throw new NotFoundException('Không tìm thấy nhân viên');
    const [kpiRows, trend, byModel, byTask, teamModel, teamTask, dayTask] =
      await Promise.all([
        this.dataSource.query(
          `SELECT COUNT(*)::int AS requests,
            COUNT(*) FILTER (WHERE g.status = 'succeeded')::int AS succeeded,
            COUNT(*) FILTER (WHERE g.status = 'failed')::int AS failed,
            COALESCE(SUM(g.charged_vnd) FILTER (WHERE g.status = 'succeeded'), 0)::bigint AS cost,
            SUM((g.usage->>'total_tokens')::numeric) FILTER (WHERE g.status = 'succeeded' AND g.usage ? 'total_tokens')::bigint AS tokens,
            MAX(g.created_at) AS last_used_at
           FROM ai_generations g WHERE g.user_id = $1 AND ${range}`,
          [userId, days],
        ),
        this.dataSource.query(
          `SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
            COALESCE(SUM(g.charged_vnd) FILTER (WHERE g.status = 'succeeded'), 0)::bigint AS cost,
            COUNT(g.id)::int AS requests,
            COUNT(g.id) FILTER (WHERE g.status = 'failed')::int AS failed
           FROM generate_series(
             ${r.end} - ($2::int - 1) * interval '1 day',
             ${r.end}, interval '1 day') AS d(day)
           LEFT JOIN (
             SELECT g.id, g.status, g.charged_vnd, date_trunc('day', g.created_at AT TIME ZONE '${tz}') AS day
             FROM ai_generations g WHERE g.user_id = $1 AND ${range}
           ) g ON g.day = d.day
           GROUP BY d.day ORDER BY d.day`,
          [userId, days],
        ),
        this.dataSource.query(
          `SELECT COALESCE(g.model_name_snapshot, g.model_slug) AS name, g.modality,
            COUNT(*)::int AS requests, COALESCE(SUM(g.charged_vnd), 0)::bigint AS cost
           FROM ai_generations g
           WHERE g.user_id = $1 AND g.status = 'succeeded' AND ${range}
           GROUP BY 1, 2 ORDER BY cost DESC`,
          [userId, days],
        ),
        this.dataSource.query(
          `SELECT g.modality, COUNT(*)::int AS requests, COALESCE(SUM(g.charged_vnd), 0)::bigint AS cost
           FROM ai_generations g
           WHERE g.user_id = $1 AND g.status = 'succeeded' AND ${range}
           GROUP BY 1 ORDER BY cost DESC`,
          [userId, days],
        ),
        this.dataSource.query(
          `SELECT COALESCE(g.model_name_snapshot, g.model_slug) AS name, g.modality,
            COUNT(*)::int AS requests, COALESCE(SUM(g.charged_vnd), 0)::bigint AS cost
           FROM ai_generations g JOIN users u ON u.id = g.user_id
           WHERE u.role_id = 2 AND g.user_id <> $1 AND g.status = 'succeeded' AND ${range}
           GROUP BY 1, 2`,
          [userId, days],
        ),
        this.dataSource.query(
          `SELECT g.modality, COUNT(*)::int AS requests, COALESCE(SUM(g.charged_vnd), 0)::bigint AS cost
           FROM ai_generations g JOIN users u ON u.id = g.user_id
           WHERE u.role_id = 2 AND g.user_id <> $1 AND g.status = 'succeeded' AND ${range}
           GROUP BY 1`,
          [userId, days],
        ),
        this.dataSource.query(
          `SELECT to_char(date_trunc('day', g.created_at AT TIME ZONE '${tz}'), 'YYYY-MM-DD') AS day,
            g.modality, COUNT(*)::int AS requests, COALESCE(SUM(g.charged_vnd), 0)::bigint AS cost
           FROM ai_generations g
           WHERE g.user_id = $1 AND g.status = 'succeeded' AND ${range}
           GROUP BY 1, 2`,
          [userId, days],
        ),
      ]);
    const [efficiency, team] = await Promise.all([
      this.efficiency(r, userId),
      this.effSummary(r),
    ]);
    const k = kpiRows[0] ?? {};
    const cost = Number(k.cost ?? 0);
    const succeeded = Number(k.succeeded ?? 0);
    const requests = Number(k.requests ?? 0);
    const teamModelMap = new Map<string, { requests: number; cost: number }>(
      teamModel.map((r: any) => [
        `${r.name}|${r.modality}`,
        { requests: Number(r.requests), cost: Number(r.cost) },
      ]),
    );
    const teamTaskMap = new Map<string, { requests: number; cost: number }>(
      teamTask.map((r: any) => [
        r.modality,
        { requests: Number(r.requests), cost: Number(r.cost) },
      ]),
    );
    const withCompare = (
      row: any,
      team?: { requests: number; cost: number },
    ) => ({
      requests: Number(row.requests),
      cost: Number(row.cost),
      avgCost: Number(row.requests)
        ? Math.round(Number(row.cost) / Number(row.requests))
        : 0,
      teamRequests: team?.requests ?? 0,
      teamAvgCost: team?.requests ? Math.round(team.cost / team.requests) : null,
    });
    const hourly = days === 1 ? await this.hourly(r, userId) : [];
    return {
      days,
      hourly,
      efficiency: { ...efficiency, team },
      employee: {
        id: Number(user.id),
        fullName: user.full_name,
        email: user.email,
        avatarUrl: user.avatar_url,
        status: user.status,
        lastLoginAt: user.last_login_at,
      },
      kpis: {
        cost,
        requests,
        succeeded,
        failed: Number(k.failed ?? 0),
        avgCostPerSuccess: succeeded ? Math.round(cost / succeeded) : 0,
        successRate: requests ? succeeded / requests : null,
        totalTokens: k.tokens === null || k.tokens === undefined ? null : Number(k.tokens),
        lastUsedAt: k.last_used_at,
      },
      trend: trend.map((r: any) => ({
        day: r.day,
        cost: Number(r.cost),
        requests: Number(r.requests),
        failed: Number(r.failed),
      })),
      byModel: byModel.map((r: any) => ({
        name: r.name,
        modality: r.modality,
        ...withCompare(r, teamModelMap.get(`${r.name}|${r.modality}`)),
      })),
      byTask: byTask.map((r: any) => ({
        modality: r.modality,
        ...withCompare(r, teamTaskMap.get(r.modality)),
      })),
      trendByTask: this.mergeDayTask(trend, dayTask),
    };
  }

  async getMySpending(userId: number) {
    const tz = 'Asia/Ho_Chi_Minh';
    const [[sum], daily, byTask] = await Promise.all([
      this.dataSource.query(
        `WITH t AS (SELECT date_trunc('day', now() AT TIME ZONE '${tz}') AS today),
         g AS (
           SELECT g.charged_vnd, date_trunc('day', g.created_at AT TIME ZONE '${tz}') AS d
           FROM ai_generations g, t
           WHERE g.user_id = $1 AND g.status = 'succeeded'
             AND g.created_at >= (date_trunc('month', t.today) - interval '1 month') AT TIME ZONE '${tz}'
         )
         SELECT
          COALESCE(SUM(charged_vnd) FILTER (WHERE d = t.today), 0)::bigint AS today_cost,
          COUNT(*) FILTER (WHERE d = t.today)::int AS today_n,
          COALESCE(SUM(charged_vnd) FILTER (WHERE d = t.today - interval '1 day'), 0)::bigint AS yday_cost,
          COALESCE(SUM(charged_vnd) FILTER (WHERE d >= t.today - interval '6 day'), 0)::bigint AS week_cost,
          COUNT(*) FILTER (WHERE d >= t.today - interval '6 day')::int AS week_n,
          COALESCE(SUM(charged_vnd) FILTER (WHERE d >= date_trunc('month', t.today)), 0)::bigint AS month_cost,
          COUNT(*) FILTER (WHERE d >= date_trunc('month', t.today))::int AS month_n,
          COALESCE(SUM(charged_vnd) FILTER (WHERE d < date_trunc('month', t.today) AND d <= t.today - interval '1 month'), 0)::bigint AS prev_same_cost
         FROM g, t`,
        [userId],
      ),
      this.dataSource.query(
        `SELECT to_char(s.day, 'YYYY-MM-DD') AS day,
          COALESCE(SUM(g.charged_vnd), 0)::bigint AS cost, COUNT(g.id)::int AS n
         FROM generate_series(
           date_trunc('day', now() AT TIME ZONE '${tz}') - interval '6 day',
           date_trunc('day', now() AT TIME ZONE '${tz}'), interval '1 day') AS s(day)
         LEFT JOIN ai_generations g ON g.user_id = $1 AND g.status = 'succeeded'
           AND date_trunc('day', g.created_at AT TIME ZONE '${tz}') = s.day
         GROUP BY s.day ORDER BY s.day`,
        [userId],
      ),
      this.dataSource.query(
        `SELECT modality, COALESCE(SUM(charged_vnd), 0)::bigint AS cost, COUNT(*)::int AS n
         FROM ai_generations
         WHERE user_id = $1 AND status = 'succeeded'
           AND created_at >= date_trunc('month', now() AT TIME ZONE '${tz}') AT TIME ZONE '${tz}'
         GROUP BY 1 ORDER BY cost DESC`,
        [userId],
      ),
    ]);
    return {
      today: { cost: Number(sum?.today_cost ?? 0), requests: Number(sum?.today_n ?? 0) },
      yesterday: { cost: Number(sum?.yday_cost ?? 0) },
      week: { cost: Number(sum?.week_cost ?? 0), requests: Number(sum?.week_n ?? 0) },
      month: {
        cost: Number(sum?.month_cost ?? 0),
        requests: Number(sum?.month_n ?? 0),
        prevSameCost: Number(sum?.prev_same_cost ?? 0),
      },
      daily: daily.map((r: any) => ({ day: r.day, cost: Number(r.cost), requests: Number(r.n) })),
      byTask: byTask.map((r: any) => ({ modality: r.modality, cost: Number(r.cost), requests: Number(r.n) })),
    };
  }

  private rangeOf(daysInput: number, from?: string, to?: string) {
    const tz = 'Asia/Ho_Chi_Minh';
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    const ok = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
    if (ok(from) && ok(to)) {
      const end = to! > today ? today : to!;
      if (from! <= end) {
        const span = Math.round((Date.parse(end) - Date.parse(from!)) / 86400000) + 1;
        if (span <= 366) return { days: span, end: `'${end}'::timestamp` };
      }
    }
    const days = Math.min(Math.max(Math.trunc(daysInput) || 30, 1), 365);
    return { days, end: `date_trunc('day', now() AT TIME ZONE '${tz}')` };
  }

  private async hourly(r: { days: number; end: string }, userId?: number) {
    const s = this.effScope(r, userId);
    const rows = await this.dataSource.query(
      `SELECT h.hr::int AS hr,
        COALESCE(SUM(g.charged_vnd) FILTER (WHERE g.status = 'succeeded'), 0)::bigint AS cost,
        COUNT(g.id)::int AS requests
       FROM generate_series(0, 23) AS h(hr)
       LEFT JOIN (
         SELECT g.id, g.status, g.charged_vnd, EXTRACT(HOUR FROM g.created_at AT TIME ZONE '${s.tz}')::int AS hr
         ${s.base}
       ) g ON g.hr = h.hr
       GROUP BY h.hr ORDER BY h.hr`,
      s.params(),
    );
    return rows.map((x: any) => ({ hr: Number(x.hr), cost: Number(x.cost), requests: Number(x.requests) }));
  }

  private effScope(r: { days: number; end: string }, userId?: number) {
    const tz = 'Asia/Ho_Chi_Minh';
    return {
      tz,
      params: () => (userId ? [r.days, userId] : [r.days]),
      base: `FROM ai_generations g JOIN users u ON u.id = g.user_id
        WHERE ${userId ? 'g.user_id = $2' : 'u.role_id = 2'}
          AND g.created_at >= (${r.end} - ($1::int - 1) * interval '1 day') AT TIME ZONE '${tz}'
          AND g.created_at < (${r.end} + interval '1 day') AT TIME ZONE '${tz}'`,
    };
  }

  private async effSummary(rg: { days: number; end: string }, userId?: number) {
    const s = this.effScope(rg, userId);
    const [r] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE g.status = 'succeeded')::int AS ok,
        COUNT(DISTINCT (g.user_id, lower(btrim(g.prompt))))::int AS uniq,
        COALESCE(SUM(g.charged_vnd) FILTER (WHERE g.status = 'succeeded'), 0)::bigint AS cost
       ${s.base} AND g.status IN ('succeeded', 'failed')`,
      s.params(),
    );
    const total = Number(r?.total ?? 0);
    const ok = Number(r?.ok ?? 0);
    return {
      total,
      succeeded: ok,
      successRate: total ? ok / total : null,
      retryRate: total ? (total - Number(r?.uniq ?? 0)) / total : null,
      costPerSuccess: ok ? Math.round(Number(r?.cost ?? 0) / ok) : 0,
    };
  }

  private async efficiency(r: { days: number; end: string }, userId?: number) {
    const s = this.effScope(r, userId);
    const p = s.params();
    const done = `g.status IN ('succeeded', 'failed')`;
    const [summary, heat, daily, latency, models, reasons, people] =
      await Promise.all([
        this.effSummary(r, userId),
        this.dataSource.query(
          `SELECT EXTRACT(ISODOW FROM g.created_at AT TIME ZONE '${s.tz}')::int AS dow,
            EXTRACT(HOUR FROM g.created_at AT TIME ZONE '${s.tz}')::int AS hr,
            COUNT(*)::int AS n
           ${s.base} AND g.status = 'succeeded' GROUP BY 1, 2`,
          p,
        ),
        this.dataSource.query(
          `SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
            COUNT(g.id) FILTER (WHERE g.status = 'succeeded')::int AS ok,
            COUNT(g.id) FILTER (WHERE g.status = 'failed')::int AS failed,
            COALESCE(SUM(g.charged_vnd) FILTER (WHERE g.status = 'succeeded'), 0)::bigint AS cost
           FROM generate_series(
             ${r.end} - ($1::int - 1) * interval '1 day',
             ${r.end}, interval '1 day') AS d(day)
           LEFT JOIN (
             SELECT g.id, g.status, g.charged_vnd, date_trunc('day', g.created_at AT TIME ZONE '${s.tz}') AS day
             ${s.base} AND ${done}
           ) g ON g.day = d.day
           GROUP BY d.day ORDER BY d.day`,
          p,
        ),
        this.dataSource.query(
          `SELECT t.modality, COUNT(*)::int AS n, AVG(t.sec)::float AS avg,
            percentile_cont(0.9) WITHIN GROUP (ORDER BY t.sec)::float AS p90
           FROM (
             SELECT g.modality, EXTRACT(EPOCH FROM (g.completed_at - g.created_at)) AS sec
             ${s.base} AND g.status = 'succeeded' AND g.completed_at IS NOT NULL
           ) t GROUP BY 1`,
          p,
        ),
        this.dataSource.query(
          `SELECT COALESCE(g.model_name_snapshot, g.model_slug) AS name, g.modality,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE g.status = 'succeeded')::int AS ok,
            COALESCE(SUM(g.charged_vnd) FILTER (WHERE g.status = 'succeeded'), 0)::bigint AS cost
           ${s.base} AND ${done} GROUP BY 1, 2 ORDER BY total DESC LIMIT 6`,
          p,
        ),
        this.dataSource.query(
          `SELECT LEFT(COALESCE(NULLIF(btrim(g.error_message), ''), 'Không rõ nguyên nhân'), 90) AS reason,
            COUNT(*)::int AS n
           ${s.base} AND g.status = 'failed' GROUP BY 1 ORDER BY n DESC LIMIT 5`,
          p,
        ),
        userId
          ? Promise.resolve([])
          : this.dataSource.query(
              `SELECT g.user_id AS id, COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE g.status = 'succeeded')::int AS ok,
                COUNT(DISTINCT lower(btrim(g.prompt)))::int AS uniq,
                COALESCE(SUM(g.charged_vnd) FILTER (WHERE g.status = 'succeeded'), 0)::bigint AS cost
               ${s.base} AND ${done} GROUP BY 1`,
              p,
            ),
      ]);
    return {
      summary,
      heat: heat.map((r: any) => ({
        dow: Number(r.dow),
        hr: Number(r.hr),
        n: Number(r.n),
      })),
      daily: daily.map((r: any) => {
        const ok = Number(r.ok);
        const cost = Number(r.cost);
        return {
          day: r.day,
          ok,
          failed: Number(r.failed),
          cost,
          costPerSuccess: ok ? Math.round(cost / ok) : null,
        };
      }),
      latency: latency.map((r: any) => ({
        modality: r.modality,
        n: Number(r.n),
        avg: Number(r.avg ?? 0),
        p90: Number(r.p90 ?? 0),
      })),
      models: models.map((r: any) => ({
        name: r.name,
        modality: r.modality,
        total: Number(r.total),
        ok: Number(r.ok),
        cost: Number(r.cost),
      })),
      reasons: reasons.map((r: any) => ({
        reason: r.reason,
        n: Number(r.n),
      })),
      people: people.map((r: any) => ({
        id: Number(r.id),
        total: Number(r.total),
        ok: Number(r.ok),
        successRate: Number(r.total) ? Number(r.ok) / Number(r.total) : null,
        retryRate: Number(r.total)
          ? (Number(r.total) - Number(r.uniq)) / Number(r.total)
          : null,
        cost: Number(r.cost),
      })),
    };
  }

  async getEmployeeAiTimeline(userId: number, daysInput: number, from?: string, to?: string) {
    const r = this.rangeOf(daysInput, from, to);
    const s = this.effScope(r, userId);
    const rows = await this.dataSource.query(
      `SELECT g.id, g.modality, g.status,
        COALESCE(g.model_name_snapshot, g.model_slug) AS model,
        g.charged_vnd,
        to_char(g.created_at AT TIME ZONE '${s.tz}', 'YYYY-MM-DD') AS day,
        (EXTRACT(EPOCH FROM (g.created_at AT TIME ZONE '${s.tz}') - date_trunc('day', g.created_at AT TIME ZONE '${s.tz}')) / 60)::int AS minute,
        CASE WHEN g.completed_at IS NOT NULL THEN EXTRACT(EPOCH FROM (g.completed_at - g.created_at))::int END AS sec
       ${s.base} ORDER BY g.created_at LIMIT 3000`,
      s.params(),
    );
    return {
      items: rows.map((x: any) => ({
        id: x.id,
        day: x.day,
        minute: Number(x.minute),
        sec: x.sec === null ? null : Number(x.sec),
        modality: x.modality,
        status: x.status,
        model: x.model,
        cost: x.charged_vnd === null ? 0 : Number(x.charged_vnd),
      })),
    };
  }

  async getEmployeeAiHistory(
    userId: number,
    page: number,
    limit: number,
    status?: string,
    modality?: string,
  ) {
    const take = Math.min(Math.max(limit || 10, 1), 50);
    const current = Math.max(page || 1, 1);
    const params: unknown[] = [userId];
    let where = 'WHERE g.user_id = $1';
    if (status && ['succeeded', 'failed', 'pending'].includes(status)) {
      params.push(status);
      where += ` AND g.status = $${params.length}`;
    }
    if (modality && ['chat', 'image', 'video', 'audio'].includes(modality)) {
      params.push(modality);
      where += ` AND g.modality = $${params.length}`;
    }
    const [countRow] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM ai_generations g ${where}`,
      params,
    );
    const rows = await this.dataSource.query(
      `SELECT g.id, g.created_at, g.modality, g.status,
        COALESCE(g.model_name_snapshot, g.model_slug) AS model,
        g.charged_vnd, g.error_message
       FROM ai_generations g ${where}
       ORDER BY g.created_at DESC
       LIMIT ${take} OFFSET ${(current - 1) * take}`,
      params,
    );
    return {
      total: Number(countRow?.total ?? 0),
      page: current,
      limit: take,
      items: rows.map((r: any) => ({
        id: r.id,
        createdAt: r.created_at,
        modality: r.modality,
        status: r.status,
        model: r.model,
        chargedVnd: r.charged_vnd === null ? null : Number(r.charged_vnd),
        errorMessage: r.error_message,
      })),
    };
  }
}
