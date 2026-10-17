import {
  CurrentUser,
  type AuthenticatedUser,
} from '../auth/decorators/current-user.decorator';
import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PayosService } from './payos.service';
import { WalletService } from './wallet.service';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(
    private readonly wallets: WalletService,
    private readonly payos: PayosService,
  ) {}

  @Get()
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.wallets.summary(user.id);
  }

  @Get('transactions')
  transactions(@CurrentUser() user: AuthenticatedUser) {
    return this.wallets.history(user.id);
  }

  @Get('topups')
  topups(@CurrentUser() user: AuthenticatedUser) {
    return this.payos.history(user.id);
  }

  @Post('topups')
  createTopup(
    @CurrentUser() user: AuthenticatedUser,
    @Body('amountVnd') amountVnd: number,
  ) {
    return this.payos.createTopup(user.id, Number(amountVnd));
  }

  @Post('admin/adjust')
  @UseGuards(RolesGuard)
  @Roles(1)
  adjust(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { userId: number; amountVnd: number; note?: string },
  ) {
    return this.wallets.credit(
      Number(body.userId),
      Number(body.amountVnd),
      `admin:${user.id}:${Date.now()}`,
      'adjustment',
      { note: body.note, adminUserId: user.id },
    );
  }
}
