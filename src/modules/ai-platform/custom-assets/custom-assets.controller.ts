import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../auth/decorators/current-user.decorator';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { KlingService } from '../kling.service';

@Controller('elements')
@UseGuards(JwtAuthGuard)
export class ElementsController {
  constructor(private readonly kling: KlingService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.kling.listCustomAssets(user.id, 'element');
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: any) {
    return this.kling.createElement(user.id, body);
  }

  @Delete(':id')
  delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.kling.deleteCustomAsset(user.id, Number(id), 'element');
  }
}

@Controller('voices')
@UseGuards(JwtAuthGuard)
export class VoicesController {
  constructor(private readonly kling: KlingService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.kling.listCustomAssets(user.id, 'voice');
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: any) {
    return this.kling.createVoice(user.id, body);
  }

  @Delete(':id')
  delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.kling.deleteCustomAsset(user.id, Number(id), 'voice');
  }
}
