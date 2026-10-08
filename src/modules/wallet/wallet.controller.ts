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
  summary(@Req() req: any) {
    return this.wallets.summary(req.user.id);
  }

  @Get('transactions')
  transactions(@Req() req: any) {
    return this.wallets.history(req.user.id);
  }

  @Get('topups')
  topups(@Req() req: any) {
    return this.payos.history(req.user.id);
  }

  @Post('topups')
  createTopup(@Req() req: any, @Body('amountVnd') amountVnd: number) {
    return this.payos.createTopup(req.user.id, Number(amountVnd));
  }

  @Post('admin/adjust')
  @UseGuards(RolesGuard)
  @Roles(1)
  adjust(
    @Req() req: any,
    @Body() body: { userId: number; amountVnd: number; note?: string },
  ) {
    return this.wallets.credit(
      Number(body.userId),
      Number(body.amountVnd),
      `admin:${req.user.id}:${Date.now()}`,
      'adjustment',
      { note: body.note, adminUserId: req.user.id },
    );
  }
}
