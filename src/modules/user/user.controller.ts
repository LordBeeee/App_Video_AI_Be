// import { Controller, Get, UseGuards, Req, Query } from '@nestjs/common'
// import { UserService } from './user.service'
// import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
// import { RolesGuard } from '../auth/guards/roles.guard';
// import { Roles } from '../auth/decorators/roles.decorator';

// @Controller('users')
// export class UserController {
//   constructor(private readonly userService: UserService) {}

//   @UseGuards(JwtAuthGuard)
//   @Get('me')
//   me(@Req() req: any) {
//     return this.userService.findMe(req.user.id);
//   }

//   @UseGuards(JwtAuthGuard)
//   @Get('me/stats')
//   getStats(@Req() req: any) {
//     return this.userService.getStats(req.user.id);
//   }

//   @UseGuards(JwtAuthGuard)
//   @Get('me/daily-stats')
//   getDailyStats(
//     @Req() req: any,
//     @Query('month') month: string,
//     @Query('year') year: string,
//   ) {
//     const now = new Date();
//     return this.userService.getDailyStats(
//       req.user.id,
//       parseInt(month) || now.getMonth() + 1,
//       parseInt(year) || now.getFullYear(),
//     );
//   }

//   @UseGuards(JwtAuthGuard, RolesGuard)
//   @Roles(1) // chỉ admin
//   @Get()
//   findAll() {
//     return this.userService.findAll();
//   }
// }
import { Controller, Get, Post, Patch, Param, Body, UseGuards, Req, Query } from '@nestjs/common'
import { CreateUserDto } from './dto/create-user.dto'
import { UserService } from './user.service';
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
    return this.userService.getDailyStats(
      req.user.id,
      parseInt(month) || now.getMonth() + 1,
      parseInt(year) || now.getFullYear(),
    );
  }

  // ── Admin: employee stats ──────────────────────────────────────
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(1)
  @Get('employee-stats')          // đặt trước :id để tránh conflict
  getEmployeeStats() {
    return this.userService.getEmployeeStats();
  }

  // ── Admin: list employees ──────────────────────────────────────
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(1)
  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.userService.findAllEmployees(
      parseInt(page ?? '1'),
      parseInt(limit ?? '6'),
      search,
    );
  }

  // ── Admin: toggle lock/unlock ──────────────────────────────────
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(1)
  @Patch(':id/toggle-status')
  toggleStatus(@Param('id') id: string) {
    return this.userService.toggleUserStatus(parseInt(id));
  }

  // thêm sau getEmployeeStats
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(1)
  @Post()
  createEmployee(@Body() dto: CreateUserDto) {
    return this.userService.createEmployee(dto)
  }
}