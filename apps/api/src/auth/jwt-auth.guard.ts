import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AUTH_COOKIE_NAME, JWT_SECRET } from './auth.constants';
import { IS_PUBLIC_KEY } from './decorators';
import { SessionUserDto } from './dto/session-user.dto';
import { verifyJwt } from './jwt.util';

/**
 * 전역 인증 가드(CLAUDE.md Auth: 모든 API는 JWT 검증을 거친다). @Public()만 예외.
 * 토큰은 httpOnly 쿠키(cs_access_token)가 기본이고, Swagger 수동 테스트용으로
 * Authorization: Bearer도 허용한다.
 *
 * 검증 후 매 요청 DB에서 직원을 재조회한다 — 권한 변경·퇴사를 토큰 재발급 없이 즉시
 * 반영하기 위함(architecture-v3 §3: 권한의 단일 소스는 MySQL).
 * Cognito 전환 시 verifyJwt만 JWKS 서명 검증으로 교체한다.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    @Inject(JWT_SECRET) private readonly jwtSecret: string,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: SessionUserDto }>();
    const token = extractToken(request);
    const payload = token ? verifyJwt(token, this.jwtSecret) : null;
    if (!payload) {
      throw unauthorized();
    }

    let employeeId: bigint;
    try {
      employeeId = BigInt(payload.sub);
    } catch {
      throw unauthorized();
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        name: true,
        email: true,
        jobRole: true,
        systemRole: true,
        facilityId: true,
        status: true,
      },
    });
    if (!employee || employee.status !== 'ACTIVE') {
      throw unauthorized();
    }

    // 기기 등록 기반 세션(모바일 C-13/N-10)은 매 요청 기기 해제 여부를 확인한다 —
    // 기기 분실 시 관리자의 원격 로그아웃(엣지 7)을 토큰 만료 전에도 즉시 반영하기 위함
    if (payload.deviceId) {
      let deviceId: bigint;
      try {
        deviceId = BigInt(payload.deviceId);
      } catch {
        throw unauthorized();
      }
      const device = await this.prisma.userDevice.findUnique({
        where: { id: deviceId },
        select: { employeeId: true, revokedAt: true },
      });
      if (!device || device.revokedAt || device.employeeId !== employeeId) {
        throw unauthorized();
      }
    }

    request.user = {
      id: employee.id.toString(),
      name: employee.name,
      email: employee.email,
      jobRole: employee.jobRole,
      systemRole: employee.systemRole,
      facilityId: employee.facilityId.toString(),
    };
    return true;
  }
}

function unauthorized(): UnauthorizedException {
  return new UnauthorizedException({
    code: 'UNAUTHENTICATED',
    message: '로그인이 필요합니다.',
  });
}

function extractToken(request: Request): string | undefined {
  const fromCookie = readCookie(request.headers.cookie, AUTH_COOKIE_NAME);
  if (fromCookie) {
    return fromCookie;
  }
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length);
  }
  return undefined;
}

/** cookie-parser 미도입(신규 라이브러리 승인 절차) — 단일 쿠키 추출만 직접 구현 */
function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  if (!header) {
    return undefined;
  }
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return undefined;
}
