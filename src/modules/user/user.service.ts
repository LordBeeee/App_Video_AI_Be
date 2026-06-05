import { Injectable, NotFoundException, ConflictException } from '@nestjs/common'
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm'
import { DataSource, Repository } from 'typeorm'
import { User } from './entities/user.entity'
import * as bcrypt from 'bcrypt'
import { CreateUserDto } from './dto/create-user.dto'
import { UpdateEmployeeDto } from './dto/update-employee.dto'
import { CloudinaryService } from '../../common/cloudinary/cloudinary.service'

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    @InjectDataSource()
    private readonly dataSource: DataSource,

    private readonly cloudinaryService: CloudinaryService, // ← THÊM
  ) {}

  findByEmail(email: string) {
    return this.userRepository.findOne({
      where: { email },
      relations: ['role'],
    })
  }

  async findMe(userId: number) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['role'],
    })
    if (!user) return null

    return {
      id:          user.id,
      email:       user.email,
      fullName:    user.fullName,
      username:    user.username,
      avatarUrl:   user.avatarUrl,
      phone:       user.phone,
      roleId:      user.roleId,
      roleName:    user.role?.name,
      status:      user.status,
      lastLoginAt: user.lastLoginAt,
      createdAt:   user.createdAt,
      updatedAt:   user.updatedAt,
    }
  }

  async updateLastLogin(userId: number) {
    await this.userRepository.update(userId, {
      lastLoginAt: new Date(),
      updatedAt:   new Date(),
    })
  }

  async getStats(userId: number) {
    const rows = await this.dataSource.query(
      `SELECT total_prompts, total_images, total_videos, total_cost
       FROM v_user_stats
       WHERE user_id = $1`,
      [userId],
    )

    const row = rows[0] ?? {
      total_prompts: 0,
      total_images:  0,
      total_videos:  0,
      total_cost:    0,
    }

    return {
      totalPrompts: Number(row.total_prompts),
      totalImages:  Number(row.total_images),
      totalVideos:  Number(row.total_videos),
      totalCost:    Number(row.total_cost),
    }
  }

  async getDailyStats(userId: number, month: number, year: number) {
    const daysInMonth = new Date(year, month, 0).getDate()
    const TZ = 'Asia/Ho_Chi_Minh'

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
    ])

    type DayEntry = { cnt: number; cost: number }
    const toMap = (rows: any[]): Record<number, DayEntry> =>
      Object.fromEntries(
        rows.map((r) => [r.day, { cnt: Number(r.cnt), cost: Number(r.cost) }]),
      )

    const pm = toMap(promptRows)
    const im = toMap(imageRows)
    const vm = toMap(videoRows)

    const generations: { day: number; prompt: number; images: number; videos: number }[] = []
    const spending:    { day: number; total: number }[] = []

    for (let d = 1; d <= daysInMonth; d++) {
      generations.push({ day: d, prompt: pm[d]?.cnt ?? 0, images: im[d]?.cnt ?? 0, videos: vm[d]?.cnt ?? 0 })
      spending.push({ day: d, total: (pm[d]?.cost ?? 0) + (im[d]?.cost ?? 0) + (vm[d]?.cost ?? 0) })
    }

    return { generations, spending }
  }

  findById(id: number) {
    return this.userRepository.findOne({ where: { id }, relations: ['role'] })
  }

  findAll() {
    return this.userRepository.find({
      select: { id: true, email: true, fullName: true, avatarUrl: true, phone: true, roleId: true, status: true, lastLoginAt: true, createdAt: true },
      relations: ['role'],
    })
  }

  async findAllEmployees(page = 1, limit = 10, search?: string) {
    const skip = (page - 1) * limit

    const qb = this.userRepository
      .createQueryBuilder('u')
      .select(['u.id', 'u.email', 'u.fullName', 'u.avatarUrl', 'u.phone', 'u.roleId', 'u.username', 'u.status', 'u.lastLoginAt', 'u.createdAt'])
      .leftJoinAndSelect('u.role', 'role')
      .where('u.roleId = :roleId', { roleId: 2 })

    if (search?.trim()) {
      qb.andWhere('(u.fullName ILIKE :search OR u.email ILIKE :search)', {
        search: `%${search.trim()}%`,
      })
    }

    const [users, total] = await qb
      .orderBy('u.createdAt', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount()

    return { users, total, page, limit }
  }

  async getEmployeeStats() {
    const TZ = 'Asia/Ho_Chi_Minh'
    const now = new Date()
    const month = now.getMonth() + 1
    const year = now.getFullYear()

    const [total, active, banned, spendingRows] = await Promise.all([
      this.userRepository.count({ where: { roleId: 2 } }),
      this.userRepository.count({ where: { roleId: 2, status: 'active' } }),
      this.userRepository.count({ where: { roleId: 2, status: 'banned' } }),
      this.dataSource.query(
        `SELECT COALESCE(
          (SELECT SUM(pg.cost) FROM prompt_generations pg
            JOIN projects p ON p.id = pg.project_id JOIN users u ON u.id = p.user_id
            WHERE u.role_id = 2 AND pg.status = 'succeeded'
              AND EXTRACT(MONTH FROM pg.created_at AT TIME ZONE $3) = $1
              AND EXTRACT(YEAR  FROM pg.created_at AT TIME ZONE $3) = $2), 0
        ) + COALESCE(
          (SELECT SUM(ig.cost) FROM image_generations ig
            JOIN projects p ON p.id = ig.project_id JOIN users u ON u.id = p.user_id
            WHERE u.role_id = 2 AND ig.status = 'succeeded'
              AND EXTRACT(MONTH FROM ig.created_at AT TIME ZONE $3) = $1
              AND EXTRACT(YEAR  FROM ig.created_at AT TIME ZONE $3) = $2), 0
        ) + COALESCE(
          (SELECT SUM(vg.cost) FROM video_generations vg
            JOIN projects p ON p.id = vg.project_id JOIN users u ON u.id = p.user_id
            WHERE u.role_id = 2 AND vg.status = 'succeeded'
              AND EXTRACT(MONTH FROM vg.created_at AT TIME ZONE $3) = $1
              AND EXTRACT(YEAR  FROM vg.created_at AT TIME ZONE $3) = $2), 0
        ) AS monthly_spending`,
        [month, year, TZ],
      ),
    ])

    return { total, active, banned, monthlySpending: Number(spendingRows[0]?.monthly_spending ?? 0) }
  }

  async toggleUserStatus(id: number) {
    const user = await this.userRepository.findOne({ where: { id } })
    if (!user) throw new NotFoundException('Không tìm thấy người dùng')

    const newStatus = user.status === 'active' ? 'banned' : 'active'
    await this.userRepository.update(id, { status: newStatus, updatedAt: new Date() })

    return { id, status: newStatus }
  }

  async createEmployee(dto: CreateUserDto) {
    const exists = await this.userRepository.findOne({ where: { email: dto.email } })
    if (exists) throw new ConflictException('Email đã được sử dụng')

    const passwordHash = await bcrypt.hash(dto.password, 10)
    const user = this.userRepository.create({
      roleId: 2, email: dto.email, fullName: dto.fullName,
      phone: dto.phone, passwordHash, status: 'active',
      createdAt: new Date(), updatedAt: new Date(),
    })
    const saved = await this.userRepository.save(user)

    return { id: saved.id, email: saved.email, fullName: saved.fullName, phone: saved.phone, status: saved.status, createdAt: saved.createdAt }
  }

  // ─── MỚI: Lấy chi tiết nhân viên ────────────────────────────────────────────
  async findEmployee(id: number) {
    const user = await this.userRepository.findOne({ where: { id }, relations: ['role'] })
    if (!user) throw new NotFoundException('Không tìm thấy nhân viên')

    return {
      id:          user.id,
      email:       user.email,
      fullName:    user.fullName,
      username:    user.username,
      avatarUrl:   user.avatarUrl,
      phone:       user.phone,
      status:      user.status,
      lastLoginAt: user.lastLoginAt,
      createdAt:   user.createdAt,
      updatedAt:   user.updatedAt,
    }
  }

  // ─── MỚI: Cập nhật thông tin nhân viên ──────────────────────────────────────
  async updateEmployee(id: number, dto: UpdateEmployeeDto, avatarBuffer?: Buffer) {
    const user = await this.userRepository.findOne({ where: { id } })
    if (!user) throw new NotFoundException('Không tìm thấy nhân viên')

    // Kiểm tra username trùng (ngoại trừ chính user này)
    if (dto.username && dto.username !== user.username) {
      const existing = await this.userRepository.findOne({ where: { username: dto.username } })
      if (existing && existing.id !== id) throw new ConflictException('Username đã được sử dụng')
    }

    // Upload avatar lên Cloudinary nếu có file mới
    let avatarUrl = user.avatarUrl
    if (avatarBuffer) {
      const result = await this.cloudinaryService.uploadBuffer(
        avatarBuffer,
        `avatar/users/${id}`,
        'avatar',
      )
      avatarUrl = result.secure_url
    }

    await this.userRepository.update(id, {
      fullName:  dto.fullName  ?? user.fullName,
      username:  dto.username  ?? user.username,
      phone:     dto.phone     ?? user.phone,
      avatarUrl,
      updatedAt: new Date(),
    })

    return this.findEmployee(id)
  }

  // ─── MỚI: Reset mật khẩu về Bideptrai123@@ ──────────────────────────────────
  async resetPassword(id: number) {
    const user = await this.userRepository.findOne({ where: { id } })
    if (!user) throw new NotFoundException('Không tìm thấy nhân viên')

    const passwordHash = await bcrypt.hash('Bideptrai123@@', 10)
    await this.userRepository.update(id, { passwordHash, updatedAt: new Date() })

    return { success: true, message: 'Reset mật khẩu thành công' }
  }
}