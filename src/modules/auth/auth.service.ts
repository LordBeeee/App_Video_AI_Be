import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import * as bcrypt from 'bcrypt';
import { UserService } from '../user/user.service';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(loginDto: LoginDto, res: Response) {
    const { email, password } = loginDto;

    const user = await this.userService.findByEmail(email);

    // Gộp 2 message lại — không để lộ email có tồn tại không
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }

    await this.userService.updateLastLogin(user.id);

    const payload = { sub: user.id, email: user.email, roleId: user.roleId };
    const isProduction = this.configService.get('NODE_ENV') === 'production';

    // Access token — ngắn hạn
    const accessToken = await this.jwtService.signAsync(payload, {
      expiresIn: '15m',
    });

    // Refresh token — dài hạn, secret riêng
    const refreshToken = await this.jwtService.signAsync(
      { sub: user.id },
      {
        secret: this.configService.getOrThrow('JWT_REFRESH_SECRET'),
        expiresIn: '7d',
      },
    );

    // Set httpOnly cookie — JS không đọc được
    const cookieOptions = {
      httpOnly: true,
      secure: true,        
      sameSite: 'none' as const,
    };

    res.cookie('access_token', accessToken, {
      ...cookieOptions,
      maxAge: 15 * 60 * 1000, // 15 phút
    });

    res.cookie('refresh_token', refreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 ngày
    });

    // Trả về user info (không có token)
    return {
      message: 'Đăng nhập thành công',
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
        roleId: user.roleId,
        roleName: user.role?.name,
        status: user.status,
      },
    };
  }

  async refresh(refreshToken: string, res: Response) {
    try {
      const payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.configService.getOrThrow('JWT_REFRESH_SECRET'),
      });

      const user = await this.userService.findById(payload.sub);
      if (!user || user.status !== 'active') {
        throw new UnauthorizedException();
      }

      const newAccessToken = await this.jwtService.signAsync(
        { sub: user.id, email: user.email, roleId: user.roleId },
        { expiresIn: '15m' },
      );

      res.cookie('access_token', newAccessToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        maxAge: 15 * 60 * 1000,
      });

      return { message: 'Token refreshed' };
    } catch {
      throw new UnauthorizedException('Refresh token không hợp lệ');
    }
  }

  logout(res: Response) {
    res.clearCookie('access_token');
    res.clearCookie('refresh_token');
    return { message: 'Đăng xuất thành công' };
  }
}