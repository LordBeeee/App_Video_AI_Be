import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../auth/decorators/current-user.decorator';
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { GenerationsService } from './generations.service';
import { CreateGenerationDto } from './dto/create-generation.dto';

@Controller('generations')
@UseGuards(JwtAuthGuard)
export class GenerationsController {
  constructor(private readonly generations: GenerationsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateGenerationDto,
  ) {
    return this.generations.create(user.id, body);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('modality') modality?: string,
  ) {
    return this.generations.list(user.id, modality);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.generations.findOne(user.id, id);
  }
}
