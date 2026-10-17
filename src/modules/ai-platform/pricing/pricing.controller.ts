import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../auth/decorators/current-user.decorator';
import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PricingService } from './pricing.service';
import { CreateQuoteDto } from './dto/create-quote.dto';

@Controller('pricing')
@UseGuards(JwtAuthGuard)
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Post('quotes')
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateQuoteDto) {
    return this.pricing.createQuote(user.id, body);
  }
}
