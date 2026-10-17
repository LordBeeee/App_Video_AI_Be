import {
  CurrentUser,
  type AuthenticatedUser,
} from '../auth/decorators/current-user.decorator';
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Query,
  UseInterceptors,
  UploadedFile,
  Header,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { UserService } from './user.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { StatisticsService } from './statistics.service';

@Controller('users')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly statistics: StatisticsService,
  ) {}

  // ── Bản thân user ─────────────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.userService.findMe(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/stats')
  getStats(@CurrentUser() user: AuthenticatedUser) {
    return this.statistics.getStats(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/daily-stats')
  getDailyStats(
    @CurrentUser() user: AuthenticatedUser,
    @Query('month') month: string,
    @Query('year') year: string,
  ) {
    const now = new Date();
    return this.statistics.getDailyStats(
      user.id,
      parseInt(month) || now.getMonth() + 1,
      parseInt(year) || now.getFullYear(),
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/spending')
  getMySpending(@CurrentUser() user: AuthenticatedUser) {
    return this.statistics.getMySpending(user.id);
  }

  // ── Cập nhật profile của bản thân ─────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Patch('me')
  @UseInterceptors(FileInterceptor('avatar', { storage: memoryStorage() }))
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateEmployeeDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.userService.updateProfile(user.id, dto, file?.buffer);
  }

  // ── Đổi mật khẩu của bản thân ─────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Patch('me/change-password')
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.userService.changePassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  // ── Admin: thống kê nhân viên (đặt TRƯỚC :id để tránh conflict) ───────────
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(1)
  @Get('employee-stats')
  getEmployeeStats() {
    return this.statistics.getEmployeeStats();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(1)
  @Get('expense-overview')
  getExpenseOverview(@Query('days') days?: string) {
    return this.statistics.getExpenseOverview(parseInt(days ?? '30'));
  }

  // ── Admin: thống kê toàn hệ thống ─────────────────────────────────────────
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(1)
  @Get('system-stats')
  getSystemStats() {
    return this.statistics.getSystemStats();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(1)
  @Get('system-daily-stats')
  getSystemDailyStats(
    @Query('month') month: string,
    @Query('year') year: string,
  ) {
    const now = new Date();
    return this.statistics.getSystemDailyStats(
      parseInt(month) || now.getMonth() + 1,
      parseInt(year) || now.getFullYear(),
    );
  }

  // ── Admin: danh sách nhân viên ────────────────────────────────────────────
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

  // ── Admin: tạo nhân viên ──────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(1)
  @Post()
  createEmployee(@Body() dto: CreateUserDto) {
    return this.userService.createEmployee(dto);
  }

  // ── Admin: toggle khóa/mở tài khoản ──────────────────────────────────────
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(1)
  @Patch(':id/toggle-status')
  toggleStatus(@Param('id') id: string) {
    return this.userService.toggleUserStatus(parseInt(id));
  }

  // ── Admin: tạo mật khẩu tạm ngẫu nhiên ───────────────────────────────────
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(1)
  @Patch(':id/reset-password')
  @Header('Cache-Control', 'no-store')
  resetPassword(@Param('id') id: string) {
    return this.userService.resetPassword(parseInt(id));
  }

  // ── Admin: cập nhật thông tin nhân viên (avatar + fields) ─────────────────
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(1)
  @Patch(':id')
  @UseInterceptors(FileInterceptor('avatar', { storage: memoryStorage() }))
  updateEmployee(
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.userService.updateEmployee(parseInt(id), dto, file?.buffer);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(1)
  @Get(':id/ai-usage')
  getEmployeeAiUsage(@Param('id') id: string, @Query('days') days?: string) {
    return this.statistics.getEmployeeAiUsage(
      parseInt(id),
      parseInt(days ?? '30'),
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(1)
  @Get(':id/ai-usage/history')
  getEmployeeAiHistory(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('modality') modality?: string,
  ) {
    return this.statistics.getEmployeeAiHistory(
      parseInt(id),
      parseInt(page ?? '1'),
      parseInt(limit ?? '10'),
      status,
      modality,
    );
  }

  // ── Admin: chi tiết 1 nhân viên ───────────────────────────────────────────
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(1)
  @Get(':id')
  findEmployee(@Param('id') id: string) {
    return this.userService.findEmployee(parseInt(id));
  }

  // ── Admin: xóa nhân viên ──────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(1)
  @Delete(':id')
  deleteEmployee(@Param('id') id: string) {
    return this.userService.deleteEmployee(parseInt(id));
  }
}
