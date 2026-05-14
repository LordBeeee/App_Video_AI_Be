import { Controller, Get, UseGuards, Req} from '@nestjs/common'
import { UserService } from './user.service'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: any) {
    return this.userService.findMe(req.user.id);
  }

  @Get()
  findAll() {
    return this.userService.findAll()
  }
}