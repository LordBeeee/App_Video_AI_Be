import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChatService } from './chat.service';

@Controller('chat/conversations')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post()
  create(@Req() req: any, @Body() body: any) {
    return this.chat.createConversation(req.user.id, body);
  }

  @Get()
  list(@Req() req: any) {
    return this.chat.list(req.user.id);
  }

  @Get(':id/messages')
  messages(@Req() req: any, @Param('id') id: string) {
    return this.chat.getMessages(req.user.id, id);
  }

  @Post(':id/messages')
  stream(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: any,
    @Res() res: Response,
  ) {
    return this.chat.streamMessage(req.user.id, id, body, res);
  }
}
