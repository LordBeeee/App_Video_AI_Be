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
  Res,
  UseGuards,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { extractChatDocument } from './chat-documents';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ChatService } from './chat.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';

@Controller('chat/conversations')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post('documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  document(@UploadedFile() file?: { originalname: string; buffer: Buffer }) {
    return extractChatDocument(file);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateConversationDto,
  ) {
    return this.chat.createConversation(user.id, body);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.chat.list(user.id);
  }

  @Get(':id/messages')
  messages(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.chat.getMessages(user.id, id);
  }

  @Post(':id/messages')
  stream(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: SendMessageDto,
    @Res() res: Response,
  ) {
    return this.chat.streamMessage(user.id, id, body, res);
  }
}
