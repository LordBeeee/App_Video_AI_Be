import { Controller, Get, Head } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  getHello() {
    return {
      message: 'OK',
    };
  }

  @Head("/health")
  headHello() {
    return {
      message: 'OK',
    };
  }
}