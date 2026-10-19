import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

type Health = 'ok' | 'degraded' | 'down' | 'idle';

const ACTIVE = ['pending', 'queued', 'processing', 'running'];
const STUCK_MINUTES = 30;

// Suy luận từ dữ liệu 24h gần nhất (không ping dịch vụ bên ngoài).
function inferHealth(total: number, failed: number): Health {
  if (total === 0) return 'idle';
  const rate = failed / total;
  if (total >= 3 && rate >= 0.5) return 'down';
  if (total >= 5 && rate >= 0.2) return 'degraded';
  return 'ok';
}

@Injectable()
export class OperationsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getOverview() {
    const started = Date.now();
    await this.dataSource.query('SELECT 1');
    const dbLatencyMs = Date.now() - started;

    const [
      sources,
      queue,
      active,
      recent,
      errors,
      topups,
      employees,
      today,
    ] = await Promise.all([
      this.dataSource.query(
        `SELECT source, COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
          COUNT(*) FILTER (WHERE status = 'succeeded')::int AS succeeded,
          MAX(created_at) FILTER (WHERE status = 'succeeded') AS last_success_at,
          MAX(created_at) FILTER (WHERE status = 'failed') AS last_failure_at
         FROM ai_generations WHERE created_at >= now() - interval '24 hours'
         GROUP BY source`,
      ),
      this.dataSource.query(
        `SELECT modality,
          COUNT(*) FILTER (WHERE status = ANY($1))::int AS active,
          COUNT(*) FILTER (WHERE status = ANY($1) AND created_at < now() - ($2::int * interval '1 minute'))::int AS stuck,
          COUNT(*) FILTER (WHERE status = 'succeeded' AND created_at >= now() - interval '24 hours')::int AS succeeded_24h,
          COUNT(*) FILTER (WHERE status = 'failed' AND created_at >= now() - interval '24 hours')::int AS failed_24h
         FROM ai_generations GROUP BY modality`,
        [ACTIVE, STUCK_MINUTES],
      ),
      this.dataSource.query(
        `SELECT g.id, g.modality, g.status, g.created_at,
          COALESCE(g.model_name_snapshot, g.model_slug) AS model,
          COALESCE(u.full_name, u.email) AS user_name
         FROM ai_generations g LEFT JOIN users u ON u.id = g.user_id
         WHERE g.status = ANY($1) ORDER BY g.created_at ASC LIMIT 8`,
        [ACTIVE],
      ),
      this.dataSource.query(
        `SELECT g.id, g.modality, g.status, g.created_at,
          COALESCE(g.model_name_snapshot, g.model_slug) AS model,
          COALESCE(u.full_name, u.email) AS user_name
         FROM ai_generations g LEFT JOIN users u ON u.id = g.user_id
         ORDER BY g.created_at DESC LIMIT 10`,
      ),
      this.dataSource.query(
        `SELECT g.id, g.modality, g.created_at, left(g.error_message, 200) AS message,
          COALESCE(g.model_name_snapshot, g.model_slug) AS model,
          COALESCE(u.full_name, u.email) AS user_name
         FROM ai_generations g LEFT JOIN users u ON u.id = g.user_id
         WHERE g.status = 'failed' ORDER BY g.created_at DESC LIMIT 8`,
      ),
      this.dataSource.query(
        `SELECT
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
          COUNT(*) FILTER (WHERE status = 'pending' AND created_at < now() - interval '1 hour')::int AS pending_old,
          COUNT(*) FILTER (WHERE status = 'paid' AND created_at >= now() - interval '24 hours')::int AS paid_24h,
          COUNT(*) FILTER (WHERE status = 'cancelled' AND created_at >= now() - interval '24 hours')::int AS cancelled_24h
         FROM topup_orders`,
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'active')::int AS active,
          COUNT(*) FILTER (WHERE status = 'banned')::int AS banned
         FROM users WHERE role_id = 2`,
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS requests,
          COUNT(DISTINCT user_id)::int AS users
         FROM ai_generations
         WHERE (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`,
      ),
    ]);

    const srcMap = new Map<string, any>(sources.map((s: any) => [s.source, s]));
    const providerService = (key: string, label: string, names: string[]) => {
      const rows = names.map((n) => srcMap.get(n)).filter(Boolean);
      const total = rows.reduce((a, r) => a + Number(r.total), 0);
      const failed = rows.reduce((a, r) => a + Number(r.failed), 0);
      const max = (k: string) =>
        rows
          .map((r) => r[k])
          .filter(Boolean)
          .sort()
          .pop() ?? null;
      return {
        key,
        label,
        status: inferHealth(total, failed),
        inferred: true,
        total24h: total,
        failed24h: failed,
        lastSuccessAt: max('last_success_at'),
        lastFailureAt: max('last_failure_at'),
      };
    };

    const t = topups[0] ?? {};
    const services = [
      {
        key: 'database',
        label: 'Cơ sở dữ liệu',
        status: 'ok' as Health,
        inferred: false,
        latencyMs: dbLatencyMs,
      },
      providerService('openrouter', 'OpenRouter (chat, ảnh, giọng nói)', [
        'openrouter',
      ]),
      providerService('kling', 'Kling (video)', ['kling', 'legacy_kling']),
      {
        key: 'payments',
        label: 'Thanh toán nạp ví',
        status: (Number(t.pending_old ?? 0) > 0 ? 'degraded' : 'ok') as Health,
        inferred: true,
        pending: Number(t.pending ?? 0),
        pendingOld: Number(t.pending_old ?? 0),
        paid24h: Number(t.paid_24h ?? 0),
        cancelled24h: Number(t.cancelled_24h ?? 0),
      },
    ];

    const sum = (k: string) =>
      queue.reduce((a: number, r: any) => a + Number(r[k]), 0);
    const stuck = sum('stuck');
    const alerts: Array<{
      level: 'critical' | 'warning';
      code: string;
      message: string;
    }> = [];
    if (stuck > 0)
      alerts.push({
        level: 'warning',
        code: 'stuck_tasks',
        message: `${stuck} tác vụ chạy quá ${STUCK_MINUTES} phút chưa hoàn tất`,
      });
    for (const s of services) {
      if (s.status === 'down')
        alerts.push({
          level: 'critical',
          code: `${s.key}_down`,
          message: `${s.label}: tỷ lệ lỗi rất cao trong 24 giờ qua`,
        });
      else if (s.status === 'degraded' && s.key !== 'payments')
        alerts.push({
          level: 'warning',
          code: `${s.key}_degraded`,
          message: `${s.label}: tỷ lệ lỗi tăng trong 24 giờ qua`,
        });
    }
    if (Number(t.pending_old ?? 0) > 0)
      alerts.push({
        level: 'warning',
        code: 'topups_pending',
        message: `${t.pending_old} lệnh nạp ví chờ thanh toán quá 1 giờ`,
      });

    const mapGen = (r: any) => ({
      id: r.id,
      modality: r.modality,
      status: r.status,
      model: r.model,
      userName: r.user_name,
      createdAt: r.created_at,
    });
    const e = employees[0] ?? {};
    const d = today[0] ?? {};
    return {
      generatedAt: new Date().toISOString(),
      stuckThresholdMinutes: STUCK_MINUTES,
      services,
      tasks: {
        active: sum('active'),
        stuck,
        succeeded24h: sum('succeeded_24h'),
        failed24h: sum('failed_24h'),
        byModality: queue.map((r: any) => ({
          modality: r.modality,
          active: Number(r.active),
          stuck: Number(r.stuck),
          succeeded24h: Number(r.succeeded_24h),
          failed24h: Number(r.failed_24h),
        })),
        running: active.map(mapGen),
      },
      alerts,
      recent: recent.map(mapGen),
      errors: errors.map((r: any) => ({
        ...mapGen({ ...r, status: 'failed' }),
        message: r.message,
      })),
      admin: {
        employees: {
          total: Number(e.total ?? 0),
          active: Number(e.active ?? 0),
          banned: Number(e.banned ?? 0),
        },
        todayRequests: Number(d.requests ?? 0),
        todayUsers: Number(d.users ?? 0),
        pendingTopups: Number(t.pending ?? 0),
      },
    };
  }
}
