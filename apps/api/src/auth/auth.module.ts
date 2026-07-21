import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JWT_SECRET } from './auth.constants';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermissionsGuard } from './permissions.guard';

@Module({
  controllers: [AuthController],
  providers: [
    {
      provide: JWT_SECRET,
      // prisma.module의 DATABASE_URL 패턴. openapi export 스크립트는 DATABASE_URL처럼
      // 더미 값을 주입해 이 검증을 통과한다(scripts/export-openapi.ts)
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
          throw new Error('JWT_SECRET is not set');
        }
        return secret;
      },
    },
    AuthService,
    // 전역 가드 — 등록 순서대로 실행된다: 인증(JWT) → 인가(@RequirePermissions)
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  // devices 모듈(모바일 기기 등록 로그인)이 동일 시크릿으로 세션 JWT를 서명한다
  exports: [JWT_SECRET],
})
export class AuthModule {}
