import { Controller, Get, UseGuards, Req, Query } from '@nestjs/common'
import { UserService } from './user.service'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: any) {
    return this.userService.findMe(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/stats')
  getStats(@Req() req: any) {
    return this.userService.getStats(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/daily-stats')
  getDailyStats(
    @Req() req: any,
    @Query('month') month: string,
    @Query('year') year: string,
  ) {
    const now = new Date();
    const m = parseInt(month) || now.getMonth() + 1;
    const y = parseInt(year) || now.getFullYear();
    return this.userService.getDailyStats(req.user.id, m, y);
  }

  // Chỉ admin (roleId = 1) mới truy cập được
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(1)
  @Get()
  findAll() {
    return this.userService.findAll();
  }
}