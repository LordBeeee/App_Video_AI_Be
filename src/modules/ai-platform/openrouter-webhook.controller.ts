import { Body, Controller, Headers, Post, Req } from '@nestjs/common';
import { GenerationsService } from './generations.service';

@Controller('openrouter/webhooks')
export class OpenRouterWebhookController {
  constructor(private readonly generations: GenerationsService) {}

  @Post('video')
  video(
    @Body() body: any,
    @Headers('x-openrouter-signature') signature: string,
    @Req() req: any,
  ) {
    return this.generations.handleVideoWebhook(body, signature, req.rawBody);
  }
}
