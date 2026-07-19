import type { CookieOptions } from 'express';

/** JWT 서명 시크릿 DI 토큰 (prisma.module의 DATABASE_URL 패턴과 동일) */
export const JWT_SECRET = 'JWT_SECRET';

/** httpOnly 세션 쿠키 이름 — 토큰을 localStorage에 두지 않는다(CLAUDE.md Frontend) */
export const AUTH_COOKIE_NAME = 'cs_access_token';

/** 관리자 웹 세션 수명(초) — 근무시간 커버 12h. Cognito 전환 시 토큰 수명 정책은 사람 검토 대상 */
export const TOKEN_TTL_SECONDS = 12 * 60 * 60;

/**
 * localhost:5173(Vite) → localhost:3000은 same-site cross-origin이라 SameSite=Lax로도
 * credentials 요청에 쿠키가 실린다. 운영(HTTPS 단일 도메인 뒤 CloudFront) 배포 시
 * secure를 켠다.
 */
export function authCookieOptions(): CookieOptions {
  return {
    ...clearAuthCookieOptions(),
    maxAge: TOKEN_TTL_SECONDS * 1000,
  };
}

/** clearCookie는 maxAge를 제외한 동일 속성으로 호출해야 브라우저가 같은 쿠키로 인식한다 */
export function clearAuthCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  };
}
