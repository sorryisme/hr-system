import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from './password.util';
import { verifyJwt } from './jwt.util';

// 로그인 분기(자격 오류/비활성/관리자 전용) 검증. PrismaService는 employee 델리게이트 목으로 대체한다.

const SECRET = 'test-secret';

describe('AuthService.login', () => {
  let findUnique: jest.Mock;
  let service: AuthService;
  let passwordHash: string;

  const adminRow = (over: Record<string, unknown> = {}) => ({
    id: 1n,
    name: '김평온',
    email: 'director@careshift.kr',
    jobRole: 'DIRECTOR',
    systemRole: 'ADMIN',
    facilityId: 1n,
    status: 'ACTIVE',
    passwordHash,
    ...over,
  });

  beforeAll(async () => {
    passwordHash = await hashPassword('correct-password');
  });

  beforeEach(() => {
    findUnique = jest.fn();
    const prisma = { employee: { findUnique } } as unknown as PrismaService;
    service = new AuthService(prisma, SECRET);
  });

  it('올바른 자격증명이면 세션 사용자와 유효한 토큰을 반환한다', async () => {
    findUnique.mockResolvedValue(adminRow());
    const { token, user } = await service.login(
      'director@careshift.kr',
      'correct-password',
    );
    expect(user).toEqual({
      id: '1',
      name: '김평온',
      email: 'director@careshift.kr',
      jobRole: 'DIRECTOR',
      systemRole: 'ADMIN',
      facilityId: '1',
    });
    expect(verifyJwt(token, SECRET)?.sub).toBe('1');
  });

  it('없는 이메일이면 INVALID_CREDENTIALS(401) — 계정 존재를 노출하지 않는다', async () => {
    findUnique.mockResolvedValue(null);
    await expect(service.login('nobody@x.kr', 'pw')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('비밀번호가 틀리면 INVALID_CREDENTIALS(401)', async () => {
    findUnique.mockResolvedValue(adminRow());
    await expect(
      service.login('director@careshift.kr', 'wrong-password'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('비밀번호가 등록되지 않은 계정은 INVALID_CREDENTIALS(401)', async () => {
    findUnique.mockResolvedValue(adminRow({ passwordHash: null }));
    await expect(
      service.login('director@careshift.kr', 'correct-password'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('퇴사(RESIGNED) 계정은 ACCOUNT_INACTIVE(403)', async () => {
    findUnique.mockResolvedValue(adminRow({ status: 'RESIGNED' }));
    await expect(
      service.login('director@careshift.kr', 'correct-password'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('STAFF 계정은 ADMIN_ONLY(403) — 관리자 웹 로그인 대상이 아니다', async () => {
    findUnique.mockResolvedValue(adminRow({ systemRole: 'STAFF' }));
    await expect(
      service.login('director@careshift.kr', 'correct-password'),
    ).rejects.toThrow(ForbiddenException);
  });
});
