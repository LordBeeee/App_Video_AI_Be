import { Body, Controller, Post } from '@nestjs/common';
import { PayosService } from './payos.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payos: PayosService) {}

  @Post('payos/webhook')
  webhook(@Body() body: any) {
    return this.payos.handleWebhook(body);
  }
}
