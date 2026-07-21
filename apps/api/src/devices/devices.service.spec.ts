import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { hashPassword } from '../auth/password.util';
import { verifyJwt } from '../auth/jwt.util';
import { PrismaService } from '../prisma/prisma.service';
import { DevicesService } from './devices.service';

// 코드 검증(계정 존재 여부를 노출하지 않는 매칭) + 기기 등록/해제 분기 검증.
// PrismaService는 employee/userDevice 델리게이트와 $transaction을 목으로 대체한다.

const SECRET = 'test-secret';

/** expect.objectContaining/any가 any를 반환해 no-unsafe-assignment에 걸리는 것을 우회하는 타입 헬퍼 */
const containing = <T extends object>(obj: T): T =>
  expect.objectContaining(obj) as T;
const anyDate = (): Date => expect.any(Date) as Date;

describe('DevicesService.registerDevice', () => {
  let findMany: jest.Mock;
  let deviceFindUnique: jest.Mock;
  let updateMany: jest.Mock;
  let upsert: jest.Mock;
  let employeeUpdate: jest.Mock;
  let service: DevicesService;
  let pinHash: string;

  const staffRow = (over: Record<string, unknown> = {}) => ({
    id: 4n,
    name: '최정성',
    email: null,
    jobRole: 'CAREGIVER',
    systemRole: 'STAFF',
    facilityId: 1n,
    pinHash,
    ...over,
  });

  beforeAll(async () => {
    pinHash = await hashPassword('123456');
  });

  beforeEach(() => {
    findMany = jest.fn();
    deviceFindUnique = jest.fn();
    updateMany = jest.fn().mockResolvedValue({ count: 0 });
    upsert = jest.fn().mockResolvedValue({ id: 10n });
    employeeUpdate = jest.fn();
    const tx = {
      userDevice: { updateMany, upsert },
      employee: { update: employeeUpdate },
    };
    const prisma = {
      employee: { findMany },
      userDevice: { findUnique: deviceFindUnique },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(tx)),
    } as unknown as PrismaService;
    service = new DevicesService(prisma, SECRET);
  });

  it('올바른 코드면 기기를 등록하고 기기 세션 토큰을 반환한다', async () => {
    findMany.mockResolvedValue([staffRow()]);
    deviceFindUnique.mockResolvedValue(null);

    const { token, user } = await service.registerDevice(
      '123456',
      'device-uuid-1',
      '갤럭시 A25',
    );

    expect(user).toEqual({
      id: '4',
      name: '최정성',
      email: null,
      jobRole: 'CAREGIVER',
      systemRole: 'STAFF',
      facilityId: '1',
    });
    const payload = verifyJwt(token, SECRET);
    expect(payload?.sub).toBe('4');
    expect(payload?.deviceId).toBe('10');
    expect(upsert).toHaveBeenCalledWith(
      containing({
        where: { deviceUid: 'device-uuid-1' },
        create: containing({
          employeeId: 4n,
          deviceUid: 'device-uuid-1',
        }),
      }),
    );
    // 코드는 1회용 — 성공 시 소진(재등록도 새 코드로만, C-13/엣지 7)
    expect(employeeUpdate).toHaveBeenCalledWith({
      where: { id: 4n },
      data: { pinHash: null },
    });
  });

  it('코드가 틀리면 INVALID_CODE(401) — 대상 직원 존재 여부를 노출하지 않는다', async () => {
    findMany.mockResolvedValue([staffRow()]);
    await expect(
      service.registerDevice('000000', 'device-uuid-1', undefined),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('대기 중인 코드가 없으면 INVALID_CODE(401)', async () => {
    findMany.mockResolvedValue([]);
    await expect(
      service.registerDevice('123456', 'device-uuid-1', undefined),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('이미 다른 직원에게 등록된 기기 식별자면 DEVICE_ALREADY_REGISTERED(409)', async () => {
    findMany.mockResolvedValue([staffRow()]);
    deviceFindUnique.mockResolvedValue({ employeeId: 999n });
    await expect(
      service.registerDevice('123456', 'device-uuid-1', undefined),
    ).rejects.toThrow(ConflictException);
  });

  it('등록 시 같은 직원의 다른 활성 기기는 해제한다(직원당 활성 기기 1대 원칙)', async () => {
    findMany.mockResolvedValue([staffRow()]);
    deviceFindUnique.mockResolvedValue(null);

    await service.registerDevice('123456', 'device-uuid-2', undefined);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        employeeId: 4n,
        revokedAt: null,
        NOT: { deviceUid: 'device-uuid-2' },
      },
      data: { revokedAt: anyDate() },
    });
  });
});
