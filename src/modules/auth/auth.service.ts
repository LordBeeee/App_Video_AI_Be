import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UserService } from '../user/user.service';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
  ) {}

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    const user = await this.userService.findByEmail(email);

    if (!user) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }

    if (user.status !== 'active') {
      throw new UnauthorizedException('Tài khoản không hoạt động');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }

    await this.userService.updateLastLogin(user.id);

    const payload = {
      sub: user.id,
      email: user.email,
      roleId: user.roleId,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      message: 'Đăng nhập thành công',
      access_token: accessToken,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.fullName,
        avatar_url: user.avatarUrl,
        role_id: user.roleId,
        status: user.status,
      },
    };
  }
}