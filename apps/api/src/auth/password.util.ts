// 비밀번호 해시 — node:crypto scrypt만 사용한다.
// bcrypt/argon2 등 신규 라이브러리 도입은 사람 승인 대상(CLAUDE.md Dependencies)이라
// 표준 라이브러리로 구현한다. Cognito 전환 시 이 파일 전체가 폐기 대상이다.
// prisma/seed.ts에서도 재사용하므로 NestJS 의존성 없는 순수 함수로 둔다.
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 32;

/** 저장 형식: `scrypt:<salt b64>:<hash b64>` (employee.password_hash) */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt:${salt.toString('base64')}:${derived.toString('base64')}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, saltPart, hashPart] = stored.split(':');
  if (scheme !== 'scrypt' || !saltPart || !hashPart) {
    return false;
  }
  const salt = Buffer.from(saltPart, 'base64');
  const expected = Buffer.from(hashPart, 'base64');
  if (expected.length !== KEY_LENGTH) {
    return false;
  }
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return timingSafeEqual(derived, expected);
}
