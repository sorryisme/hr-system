import { BadRequestException, ConflictException } from '@nestjs/common';
import { RosterStateService } from './roster-state.service';
import { PrismaService } from '../prisma/prisma.service';
import { RosterEntryInputDto } from './dto/update-entries.dto';

// §4.8 셀 다건 편집 검증. $transaction은 콜백에 동일한 prisma mock을 tx로 넘겨
// 호출하는 것으로 대체한다(roster-reflection.service.spec.ts와 동일한 패턴).

type PrismaMock = {
  roster: { findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
  shiftType: { findMany: jest.Mock };
  employee: { findMany: jest.Mock };
  scheduleEntry: { upsert: jest.Mock };
  $transaction: jest.Mock;
};

describe('RosterStateService.updateEntries', () => {
  let prisma: PrismaMock;
  let service: RosterStateService;

  const facilityId = '1';
  const rosterRow = {
    id: 100n,
    facilityId: 1n,
    yearMonth: '2026-08',
    status: 'DRAFT',
  };

  const entries = (): RosterEntryInputDto[] => [
    { employeeId: '4', workDate: '2026-08-01', shiftCode: 'D' },
  ];

  beforeEach(() => {
    prisma = {
      roster: {
        findUnique: jest.fn().mockResolvedValue(rosterRow),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      shiftType: {
        findMany: jest.fn().mockResolvedValue([{ id: 10n, code: 'D' }]),
      },
      employee: {
        findMany: jest.fn().mockResolvedValue([{ id: 4n }]),
      },
      scheduleEntry: {
        upsert: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn((cb: (tx: PrismaMock) => Promise<unknown>) =>
        cb(prisma),
      ),
    };
    service = new RosterStateService(prisma as unknown as PrismaService);
  });

  it('정상 입력은 셀을 upsert하고 현재 상태를 반환한다', async () => {
    const result = await service.updateEntries('100', facilityId, entries());

    expect(result.status).toBe('DRAFT');
    expect(prisma.scheduleEntry.upsert).toHaveBeenCalledTimes(1);
  });

  it('COMPLETED 상태에서 편집하면 DRAFT로 복귀한다', async () => {
    prisma.roster.findUnique.mockResolvedValue({
      ...rosterRow,
      status: 'COMPLETED',
    });

    const result = await service.updateEntries('100', facilityId, entries());

    expect(result.status).toBe('DRAFT');
    expect(prisma.roster.update).toHaveBeenCalledWith({
      where: { id: 100n },
      data: { status: 'DRAFT' },
    });
  });

  it('트랜잭션 시작 직전 다른 요청이 상태를 바꾸면(동시성 가드) 셀을 쓰지 않고 중단한다', async () => {
    // loadOwned 시점엔 DRAFT였으나, 트랜잭션 진입 시점엔 이미 다른 요청이 마감 등으로
    // 전이시켜 status WHERE 조건이 더 이상 매치되지 않는 상황(guard.count=0)을 시뮬레이션.
    prisma.roster.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.updateEntries('100', facilityId, entries()),
    ).rejects.toThrow(ConflictException);

    expect(prisma.scheduleEntry.upsert).not.toHaveBeenCalled();
  });

  it('CLOSED 근무표는 편집을 거부한다', async () => {
    prisma.roster.findUnique.mockResolvedValue({
      ...rosterRow,
      status: 'CLOSED',
    });

    await expect(
      service.updateEntries('100', facilityId, entries()),
    ).rejects.toThrow(ConflictException);
  });

  it('CLOSING_APPROVAL 근무표는 편집을 거부한다', async () => {
    prisma.roster.findUnique.mockResolvedValue({
      ...rosterRow,
      status: 'CLOSING_APPROVAL',
    });

    await expect(
      service.updateEntries('100', facilityId, entries()),
    ).rejects.toThrow(ConflictException);
  });

  it('알 수 없는 근무유형 코드는 400', async () => {
    await expect(
      service.updateEntries('100', facilityId, [
        { employeeId: '4', workDate: '2026-08-01', shiftCode: 'ZZ' },
      ]),
    ).rejects.toThrow(BadRequestException);
  });

  it('타 시설 직원이 섞여 있으면 400', async () => {
    prisma.employee.findMany.mockResolvedValue([]); // 조회된 소속 직원 없음

    await expect(
      service.updateEntries('100', facilityId, entries()),
    ).rejects.toThrow(BadRequestException);
  });
});
