import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { OperationsService } from './operations.service';

@Controller('operations')
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(1)
  @Get('overview')
  @Header('Cache-Control', 'no-store')
  overview() {
    return this.operations.getOverview();
  }
}
