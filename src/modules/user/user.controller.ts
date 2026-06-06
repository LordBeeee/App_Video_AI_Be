import {
  Controller, Get, Post, Patch, Delete, Param, Body,
  UseGuards, Req, Query, UseInterceptors, UploadedFile,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { CreateUserDto } from './dto/create-user.dto'
import { UpdateEmployeeDto } from './dto/update-employee.dto'
import { UserService } from './user.service'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { Roles } from '../auth/decorators/roles.decorator'

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  // ── Bản thân user ─────────────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: any) {
    return this.userService.findMe(req.user.id)
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/stats')
  getStats(@Req() req: any) {
    return this.userService.getStats(req.user.id)
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/daily-stats')
  getDailyStats(
    @Req() req: any,
    @Query('month') month: string,
    @Query('year') year: string,
  ) {
    const now = new Date()
    return this.userService.getDailyStats(
      req.user.id,
      parseInt(month) || now.getMonth() + 1,
      parseInt(year) || now.getFullYear(),
    )
  }

  // ── Admin: thống kê nhân viên (đặt TRƯỚC :id để tránh conflict) ───────────
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(1)
  @Get('employee-stats')
  getEmployeeStats() {
    return this.userService.getEmployeeStats()
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
    )
  }

  // ── Admin: tạo nhân viên ──────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(1)
  @Post()
  createEmployee(@Body() dto: CreateUserDto) {
    return this.userService.createEmployee(dto)
  }

  // ── Admin: toggle khóa/mở tài khoản ──────────────────────────────────────
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(1)
  @Patch(':id/toggle-status')
  toggleStatus(@Param('id') id: string) {
    return this.userService.toggleUserStatus(parseInt(id))
  }

  // ── Admin: reset mật khẩu về Bideptrai123@@ ──────────────────────────────
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(1)
  @Patch(':id/reset-password')
  resetPassword(@Param('id') id: string) {
    return this.userService.resetPassword(parseInt(id))
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
    return this.userService.updateEmployee(parseInt(id), dto, file?.buffer)
  }

  // ── Admin: chi tiết 1 nhân viên ───────────────────────────────────────────
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(1)
  @Get(':id')
  findEmployee(@Param('id') id: string) {
    return this.userService.findEmployee(parseInt(id))
  }

  // ── Admin: xóa nhân viên ──────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(1)
  @Delete(':id')
  deleteEmployee(@Param('id') id: string) {
    return this.userService.deleteEmployee(parseInt(id))
  }
}