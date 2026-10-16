import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../auth/decorators/current-user.decorator';
import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { KlingService } from '../kling.service';

@Controller('references')
@UseGuards(JwtAuthGuard)
export class ReferencesController {
  constructor(private readonly kling: KlingService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.kling.listReferences(user.id);
  }

  @Post('elements')
  createElement(@CurrentUser() user: AuthenticatedUser, @Body() body: any) {
    return this.kling.createElement(user.id, body);
  }

  @Post('voices')
  createVoice(@CurrentUser() user: AuthenticatedUser, @Body() body: any) {
    return this.kling.createVoice(user.id, body);
  }
}
