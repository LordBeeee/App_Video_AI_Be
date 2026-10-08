import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GenerationsService } from './generations.service';

@Controller('generations')
@UseGuards(JwtAuthGuard)
export class GenerationsController {
  constructor(private readonly generations: GenerationsService) {}

  @Post()
  create(@Req() req: any, @Body() body: any) {
    return this.generations.create(req.user.id, body);
  }

  @Get()
  list(@Req() req: any, @Query('modality') modality?: string) {
    return this.generations.list(req.user.id, modality);
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.generations.findOne(req.user.id, id);
  }
}
