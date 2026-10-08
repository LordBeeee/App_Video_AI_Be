import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PricingService } from './pricing.service';
import type { QuoteRequest } from './pricing.service';

@Controller('pricing')
@UseGuards(JwtAuthGuard)
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Post('quotes')
  create(@Req() req: any, @Body() body: QuoteRequest) {
    return this.pricing.createQuote(req.user.id, body);
  }
}
