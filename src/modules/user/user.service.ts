import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import { CloudinaryService } from '../../common/cloudinary/cloudinary.service';
import { UploadLimitsService } from '../../common/cloudinary/upload-limits.service';
import { BadRequestException } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { User } from './entities/user.entity';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly cloudinaryService: CloudinaryService,
    private readonly uploadLimits: UploadLimitsService,
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
      .select([
        'u.id',
        'u.roleId',
        'u.email',
        'u.fullName',
        'u.username',
        'u.avatarUrl',
        'u.phone',
        'u.status',
        'u.lastLoginAt',
        'u.createdAt',
        'u.updatedAt',
        'role.id',
        'role.name',
      ])
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
      const limits = await this.uploadLimits.getLimits();
      if (avatarBuffer.length > limits.image) {
        throw new BadRequestException(`Ảnh đại diện không được vượt quá ${limits.image / 1_000_000} MB`);
      }
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
    const temporaryPassword = `Aa1!${randomBytes(18).toString('base64url')}`;
    await this.userRepository.update(id, {
      passwordHash: await bcrypt.hash(temporaryPassword, 12),
      updatedAt: new Date(),
    });
    return {
      success: true,
      message:
        'Reset mật khẩu thành công. Gửi mật khẩu tạm cho nhân viên qua kênh an toàn.',
      temporaryPassword,
    };
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
