// HS256 JWT 서명/검증 — node:crypto만 사용한다(신규 라이브러리 승인 절차 회피 목적,
// CLAUDE.md Dependencies). 검증은 항상 우리 시크릿으로 HMAC을 재계산하므로
// alg 헤더 조작(none/RS256 혼동) 공격이 성립하지 않는다.
// Cognito 전환 시 이 파일은 passport-jwt + jwks-rsa 검증으로 대체된다(architecture-v3 §3).
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface JwtPayload {
  /** employee.id 문자열 */
  sub: string;
  iat: number;
  exp: number;
}

function hmac(data: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(data).digest();
}

export function signJwt(
  sub: string,
  secret: string,
  ttlSeconds: number,
  now: number = Date.now(),
): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
  ).toString('base64url');
  const iat = Math.floor(now / 1000);
  const payload = Buffer.from(
    JSON.stringify({ sub, iat, exp: iat + ttlSeconds } satisfies JwtPayload),
  ).toString('base64url');
  const signature = hmac(`${header}.${payload}`, secret).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

/** 서명·만료를 검증하고 페이로드를 반환한다. 실패 사유는 구분하지 않고 null(전부 401 처리) */
export function verifyJwt(
  token: string,
  secret: string,
  now: number = Date.now(),
): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const [header, payload, signature] = parts;
  const expected = hmac(`${header}.${payload}`, secret);
  const actual = Buffer.from(signature, 'base64url');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const candidate = parsed as Record<string, unknown>;
  if (
    typeof candidate.sub !== 'string' ||
    typeof candidate.iat !== 'number' ||
    typeof candidate.exp !== 'number'
  ) {
    return null;
  }
  if (candidate.exp * 1000 <= now) {
    return null;
  }
  return { sub: candidate.sub, iat: candidate.iat, exp: candidate.exp };
}
