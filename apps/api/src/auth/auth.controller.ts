import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  AUTH_COOKIE_NAME,
  authCookieOptions,
  clearAuthCookieOptions,
} from './auth.constants';
import { AuthService } from './auth.service';
import { CurrentUser, Public } from './decorators';
import { LoginRequestDto } from './dto/login-request.dto';
import { SessionUserDto } from './dto/session-user.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** 토큰은 응답 바디가 아닌 httpOnly 쿠키로만 전달한다(localStorage 저장 금지 — CLAUDE.md) */
  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOkResponse({ type: SessionUserDto })
  async login(
    @Body() body: LoginRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionUserDto> {
    const { token, user } = await this.authService.login(
      body.email,
      body.password,
    );
    res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions());
    return user;
  }

  /** 만료된 세션에서도 쿠키 정리가 되도록 인증을 요구하지 않는다 */
  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiNoContentResponse()
  logout(@Res({ passthrough: true }) res: Response): void {
    res.clearCookie(AUTH_COOKIE_NAME, clearAuthCookieOptions());
  }

  @Get('me')
  @ApiOkResponse({ type: SessionUserDto })
  me(@CurrentUser() user: SessionUserDto): SessionUserDto {
    return user;
  }
}
