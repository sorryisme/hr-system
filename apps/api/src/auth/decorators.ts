import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';
import { SessionUserDto } from './dto/session-user.dto';

export const IS_PUBLIC_KEY = 'isPublic';
/** 인증 없이 허용하는 엔드포인트(로그인·헬스체크 등) 표시 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISSIONS_KEY = 'requiredPermissions';
/**
 * 엔드포인트별 필요 권한(CLAUDE.md Auth). 현재 권한 소스는 employee.system_role의
 * 코드 매핑(permissions.guard.ts)이며, RBAC 테이블(users/roles/permissions) 도입 시
 * 이 데코레이터 시그니처는 유지한 채 가드의 조회처만 교체한다.
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** JwtAuthGuard가 request.user로 붙인 세션 사용자 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionUserDto => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user?: SessionUserDto }>();
    if (!request.user) {
      // 가드가 적용되지 않은 곳에서 @CurrentUser를 쓴 코딩 오류
      throw new Error('CurrentUser는 JwtAuthGuard 통과 후에만 사용할 수 있다');
    }
    return request.user;
  },
);
