import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { KlingService } from './kling.service';

@Controller('references')
@UseGuards(JwtAuthGuard)
export class ReferencesController {
  constructor(private readonly kling: KlingService) {}

  @Get()
  list(@Req() req: any) {
    return this.kling.listReferences(req.user.id);
  }

  @Post('elements')
  createElement(@Req() req: any, @Body() body: any) {
    return this.kling.createElement(req.user.id, body);
  }

  @Post('voices')
  createVoice(@Req() req: any, @Body() body: any) {
    return this.kling.createVoice(req.user.id, body);
  }
}
