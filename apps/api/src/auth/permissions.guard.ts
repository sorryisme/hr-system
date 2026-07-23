import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SystemRole } from '@prisma/client';
import { PERMISSIONS_KEY } from './decorators';
import { SessionUserDto } from './dto/session-user.dto';

/**
 * @RequirePermissions 검사(CLAUDE.md Auth). 권한 소스는 현재 employee.system_role의
 * 코드 매핑이다 — RBAC 테이블(users/roles/permissions/user_roles/role_permissions)은
 * 미도입 상태(architecture-v3 §3)라, 도입 시 이 매핑을 DB 조회로 교체한다.
 * 데코레이터·권한 문자열은 그대로 유지된다.
 */
const ROLE_PERMISSIONS: Record<SystemRole, readonly string[]> = {
  // roster:write/close 는 §1.3상 사회복지사(작성) vs 사무국장·시설장(마감)로 나뉘나,
  // system_role이 둘 다 ADMIN이라 현재는 동일 부여 — 세부 차등은 job_role 앱 레벨 검사 또는 RBAC 도입 시.
  SUPER_ADMIN: [
    'approvals:read',
    'approvals:decide',
    'roster:read',
    'roster:write',
    'roster:close',
  ],
  ADMIN: [
    'approvals:read',
    'approvals:decide',
    'roster:read',
    'roster:write',
    'roster:close',
  ],
  STAFF: [],
};

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: SessionUserDto }>();
    // JwtAuthGuard(선등록)가 붙인 사용자. @Public 경로에는 권한 요구를 걸지 않는다
    const user = request.user;
    if (!user) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: '접근 권한이 없습니다.',
      });
    }

    const granted = ROLE_PERMISSIONS[user.systemRole];
    const missing = required.filter((p) => !granted.includes(p));
    if (missing.length > 0) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: '접근 권한이 없습니다.',
      });
    }
    return true;
  }
}
