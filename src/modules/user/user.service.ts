import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { DataSource, Repository } from 'typeorm';
import { CloudinaryService } from '../../common/cloudinary/cloudinary.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { User } from './entities/user.entity';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly cloudinaryService: CloudinaryService,
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
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      username: user.username,
      avatarUrl: user.avatarUrl,
      phone: user.phone,
      roleId: user.roleId,
      roleName: user.role?.name,
      status: user.status,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async updateLastLogin(userId: number) {
    await this.userRepository.update(userId, {
      lastLoginAt: new Date(),
      updatedAt: new Date(),
    });
  }

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

  findById(id: number) {
    return this.userRepository.findOne({ where: { id }, relations: ['role'] });
  }

  findAll() {
    return this.userRepository.find({
      select: {
        id: true,
        email: true,
        fullName: true,
        avatarUrl: true,
        phone: true,
        roleId: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
      },
      relations: ['role'],
    });
  }

  async findAllEmployees(page = 1, limit = 10, search?: string) {
    const qb = this.userRepository
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.role', 'role')
      .where('u.roleId = :roleId', { roleId: 2 });
    if (search?.trim()) {
      qb.andWhere('(u.fullName ILIKE :search OR u.email ILIKE :search)', {
        search: `%${search.trim()}%`,
      });
    }
    const [users, total] = await qb
      .orderBy('u.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return { users, total, page, limit };
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

  async toggleUserStatus(id: number) {
    const user = await this.requireUser(id);
    const status = user.status === 'active' ? 'banned' : 'active';
    await this.userRepository.update(id, { status, updatedAt: new Date() });
    return { id, status };
  }

  async createEmployee(dto: CreateUserDto) {
    if (await this.userRepository.findOne({ where: { email: dto.email } })) {
      throw new ConflictException('Email đã được sử dụng');
    }
    const saved = await this.userRepository.save(
      this.userRepository.create({
        roleId: 2,
        email: dto.email,
        fullName: dto.fullName,
        phone: dto.phone,
        passwordHash: await bcrypt.hash(dto.password, 10),
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
    return this.findEmployee(saved.id);
  }

  async findEmployee(id: number) {
    const user = await this.requireUser(id);
    const { passwordHash: _passwordHash, ...safeUser } = user;
    return safeUser;
  }

  async updateEmployee(
    id: number,
    dto: UpdateEmployeeDto,
    avatarBuffer?: Buffer,
  ) {
    const user = await this.requireUser(id);
    await this.ensureUsernameAvailable(dto.username, id);
    let avatarUrl = user.avatarUrl;
    if (avatarBuffer) {
      avatarUrl = (
        await this.cloudinaryService.uploadBuffer(
          avatarBuffer,
          `avatar/users/${id}`,
          'avatar',
        )
      ).secure_url;
    }
    await this.userRepository.update(id, {
      fullName: dto.fullName ?? user.fullName,
      username: dto.username ?? user.username,
      phone: dto.phone ?? user.phone,
      avatarUrl,
      updatedAt: new Date(),
    });
    return this.findEmployee(id);
  }

  async resetPassword(id: number) {
    await this.requireUser(id);
    await this.userRepository.update(id, {
      passwordHash: await bcrypt.hash('Bideptrai123@@', 10),
      updatedAt: new Date(),
    });
    return { success: true, message: 'Reset mật khẩu thành công' };
  }

  async deleteEmployee(id: number) {
    await this.requireUser(id);
    await this.userRepository.delete(id);
    return { success: true, message: 'Xóa nhân viên thành công' };
  }

  async updateProfile(
    userId: number,
    dto: UpdateEmployeeDto,
    avatarBuffer?: Buffer,
  ) {
    await this.updateEmployee(userId, dto, avatarBuffer);
    return this.findMe(userId);
  }

  async changePassword(
    userId: number,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.requireUser(userId);
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Mật khẩu hiện tại không đúng');
    }
    await this.userRepository.update(userId, {
      passwordHash: await bcrypt.hash(newPassword, 10),
      updatedAt: new Date(),
    });
    return { success: true, message: 'Đổi mật khẩu thành công' };
  }

  private async requireUser(id: number) {
    const user = await this.userRepository.findOne({
      where: { id },
      relations: ['role'],
    });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');
    return user;
  }

  private async ensureUsernameAvailable(
    username: string | undefined,
    userId: number,
  ) {
    if (!username) return;
    const existing = await this.userRepository.findOne({ where: { username } });
    if (existing && Number(existing.id) !== Number(userId)) {
      throw new ConflictException('Username đã được sử dụng');
    }
  }
}
