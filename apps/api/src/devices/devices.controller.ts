import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AUTH_COOKIE_NAME, authCookieOptions } from '../auth/auth.constants';
import { Public } from '../auth/decorators';
import { SessionUserDto } from '../auth/dto/session-user.dto';
import { DEVICE_SESSION_TTL_SECONDS } from './devices.constants';
import { DevicesService } from './devices.service';
import { RegisterDeviceDto } from './dto/register-device.dto';

@ApiTags('devices')
@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  /**
   * 관리자 발급 코드로 최초 1회 기기 등록 → 즉시 로그인(C-13/N-10).
   * 토큰은 auth/login과 동일하게 응답 바디가 아닌 httpOnly 쿠키로만 전달한다(CLAUDE.md).
   */
  @Public()
  @Post('register')
  @HttpCode(200)
  @ApiOkResponse({ type: SessionUserDto })
  async register(
    @Body() body: RegisterDeviceDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionUserDto> {
    const { token, user } = await this.devicesService.registerDevice(
      body.code,
      body.deviceUid,
      body.deviceLabel,
    );
    res.cookie(
      AUTH_COOKIE_NAME,
      token,
      authCookieOptions(DEVICE_SESSION_TTL_SECONDS),
    );
    return user;
  }
}
