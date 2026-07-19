import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './auth/decorators';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /** 헬스체크 용도 — 인증 제외 */
  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
