import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type { JobRole } from '@prisma/client';
import { RosterStateService } from './roster-state.service';
import { PrismaService } from '../prisma/prisma.service';
import { ApplyPresetDto } from './dto/apply-preset.dto';
import { RosterEntryInputDto } from './dto/update-entries.dto';

// §4.6/§4.8 프리셋 적용 검증. $transaction은 콜백에 동일한 prisma mock을 tx로 넘겨
// 호출하는 것으로 대체한다(roster-reflection.service.spec.ts와 동일한 패턴).

type ScheduleEntryRow = {
  workDate: Date;
  shiftTypeId: bigint;
  source: 'MANUAL' | 'PRESET' | 'APPROVAL';
};

type PrismaMock = {
  roster: { findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
  shiftPatternPreset: { findUnique: jest.Mock };
  employee: { findMany: jest.Mock };
  scheduleEntry: { findMany: jest.Mock; upsert: jest.Mock };
  $transaction: jest.Mock;
};

const date = (s: string) => new Date(`${s}T00:00:00Z`);

/** expect.objectContaining이 any를 반환해 no-unsafe-assignment에 걸리는 것을 우회하는 타입 헬퍼 */
const containing = <T extends object>(obj: T): T =>
  expect.objectContaining(obj) as T;

describe('RosterStateService.applyPreset', () => {
  let prisma: PrismaMock;
  let service: RosterStateService;

  const facilityId = '1';
  const rosterRow = {
    id: 100n,
    facilityId: 1n,
    yearMonth: '2026-08',
    status: 'DRAFT',
  };

  // 주야비 3조 2교대, 6일 주기: A조(teamNo=1) 주·주·야·야·휴·휴
  const shiftIds = { D: 10n, N: 20n, OFF: 30n };
  const presetRow = {
    id: 5n,
    facilityId: 1n,
    cycleDays: 6,
    teamCount: 3,
    items: [
      { teamNo: 1, dayIndex: 1, shiftTypeId: shiftIds.D },
      { teamNo: 1, dayIndex: 2, shiftTypeId: shiftIds.D },
      { teamNo: 1, dayIndex: 3, shiftTypeId: shiftIds.N },
      { teamNo: 1, dayIndex: 4, shiftTypeId: shiftIds.N },
      { teamNo: 1, dayIndex: 5, shiftTypeId: shiftIds.OFF },
      { teamNo: 1, dayIndex: 6, shiftTypeId: shiftIds.OFF },
    ],
  };

  const baseDto = (over: Partial<ApplyPresetDto> = {}): ApplyPresetDto => ({
    presetId: '5',
    teamNo: 1,
    employeeIds: ['4'],
    startDate: '2026-08-01',
    ...over,
  });

  beforeEach(() => {
    prisma = {
      roster: {
        findUnique: jest.fn().mockResolvedValue(rosterRow),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      shiftPatternPreset: {
        findUnique: jest.fn().mockResolvedValue(presetRow),
      },
      employee: {
        findMany: jest.fn().mockResolvedValue([{ id: 4n }]),
      },
      scheduleEntry: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn((cb: (tx: PrismaMock) => Promise<unknown>) =>
        cb(prisma),
      ),
    };
    service = new RosterStateService(prisma as unknown as PrismaService);
  });

  it('최초 적용: 이전 셀이 없으면 startDate를 1일차로 삼아 채운다', async () => {
    // 8/1~8/6, 이전(PRESET) 셀 없음 → D,D,N,N,OFF,OFF
    const result = await service.applyPreset(
      '100',
      facilityId,
      baseDto({ endDate: '2026-08-06' }),
    );

    expect(result.appliedCount).toBe(6);
    expect(result.skipped).toEqual([]);
    const expected = [
      shiftIds.D,
      shiftIds.D,
      shiftIds.N,
      shiftIds.N,
      shiftIds.OFF,
      shiftIds.OFF,
    ];
    expected.forEach((shiftTypeId, i) => {
      expect(prisma.scheduleEntry.upsert).toHaveBeenNthCalledWith(
        i + 1,
        containing({ create: containing({ shiftTypeId }) }),
      );
    });
  });

  it('연속성(A-2): 전월 마지막 PRESET 셀이 패턴과 일치하면 이어붙인다', async () => {
    // 7/31이 dayIndex=2(주간, D)였다면 8/1은 dayIndex=3(야간, N)부터 이어져야 한다.
    const prior: ScheduleEntryRow[] = [
      {
        workDate: date('2026-07-31'),
        shiftTypeId: shiftIds.D,
        source: 'PRESET',
      },
      {
        workDate: date('2026-07-30'),
        shiftTypeId: shiftIds.D,
        source: 'PRESET',
      },
      {
        workDate: date('2026-07-29'),
        shiftTypeId: shiftIds.OFF,
        source: 'PRESET',
      },
      {
        workDate: date('2026-07-28'),
        shiftTypeId: shiftIds.OFF,
        source: 'PRESET',
      },
      {
        workDate: date('2026-07-27'),
        shiftTypeId: shiftIds.N,
        source: 'PRESET',
      },
      {
        workDate: date('2026-07-26'),
        shiftTypeId: shiftIds.N,
        source: 'PRESET',
      },
    ];
    prisma.scheduleEntry.findMany.mockImplementation(
      ({ where }: { where: { workDate: { lt?: Date } } }) =>
        Promise.resolve(where.workDate.lt ? prior : []),
    );

    const result = await service.applyPreset(
      '100',
      facilityId,
      baseDto({ endDate: '2026-08-02' }),
    );

    expect(result.appliedCount).toBe(2);
    expect(prisma.scheduleEntry.upsert).toHaveBeenNthCalledWith(
      1,
      containing({ create: containing({ shiftTypeId: shiftIds.N }) }),
    );
    expect(prisma.scheduleEntry.upsert).toHaveBeenNthCalledWith(
      2,
      containing({ create: containing({ shiftTypeId: shiftIds.N }) }),
    );
  });

  it('APPROVAL/MANUAL 셀은 덮어쓰지 않고 건너뛴다', async () => {
    prisma.scheduleEntry.findMany.mockImplementation(
      ({ where }: { where: { workDate: { lt?: Date; gte?: Date } } }) =>
        where.workDate.lt
          ? Promise.resolve([])
          : Promise.resolve([
              { workDate: date('2026-08-02'), source: 'APPROVAL' },
            ] as ScheduleEntryRow[]),
    );

    const result = await service.applyPreset(
      '100',
      facilityId,
      baseDto({ endDate: '2026-08-03' }),
    );

    expect(result.appliedCount).toBe(2); // 8/1, 8/3만 적용
    expect(result.skipped).toEqual([
      { employeeId: '4', workDate: '2026-08-02', reason: 'PROTECTED_CELL' },
    ]);
  });

  it('트랜잭션 시작 직전 다른 요청이 상태를 바꾸면(동시성 가드) 셀을 쓰지 않고 중단한다', async () => {
    // loadOwned 시점엔 DRAFT였으나, 트랜잭션 진입 시점엔 이미 다른 요청이 마감 등으로
    // 전이시켜 status WHERE 조건이 더 이상 매치되지 않는 상황(guard.count=0)을 시뮬레이션.
    prisma.roster.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.applyPreset(
        '100',
        facilityId,
        baseDto({ endDate: '2026-08-06' }),
      ),
    ).rejects.toThrow(ConflictException);

    expect(prisma.scheduleEntry.upsert).not.toHaveBeenCalled();
  });

  it('CLOSED 근무표는 적용을 거부한다', async () => {
    prisma.roster.findUnique.mockResolvedValue({
      ...rosterRow,
      status: 'CLOSED',
    });

    await expect(
      service.applyPreset('100', facilityId, baseDto()),
    ).rejects.toThrow(ConflictException);
  });

  it('teamNo가 프리셋 범위를 벗어나면 400', async () => {
    await expect(
      service.applyPreset('100', facilityId, baseDto({ teamNo: 9 })),
    ).rejects.toThrow(BadRequestException);
  });

  it('타 시설 직원이 섞여 있으면 400', async () => {
    prisma.employee.findMany.mockResolvedValue([]); // 조회된 소속 직원 없음

    await expect(
      service.applyPreset('100', facilityId, baseDto()),
    ).rejects.toThrow(BadRequestException);
  });
});

// §4.8 셀 다건 편집 검증(applyPreset과 별개 mock 형태라 describe를 분리한다).
describe('RosterStateService.updateEntries', () => {
  type UpdateEntriesPrismaMock = {
    roster: { findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
    shiftType: { findMany: jest.Mock };
    employee: { findMany: jest.Mock };
    scheduleEntry: { upsert: jest.Mock };
    $transaction: jest.Mock;
  };

  let prisma: UpdateEntriesPrismaMock;
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
      $transaction: jest.fn(
        (cb: (tx: UpdateEntriesPrismaMock) => Promise<unknown>) => cb(prisma),
      ),
    };
    service = new RosterStateService(prisma as unknown as PrismaService);
  });

  it('정상 입력은 셀을 upsert하고 현재 상태를 반환한다', async () => {
    const result = await service.updateEntries('100', facilityId, entries());

    expect(result.status).toBe('DRAFT');
    expect(prisma.scheduleEntry.upsert).toHaveBeenCalledTimes(1);
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

// 마감/마감취소(§4.8, §1.3) — DIRECTOR/OFFICE_MANAGER만 수행 가능한지, DRAFT↔CLOSED 전이가
// 올바른지 검증한다.
describe('RosterStateService.close / reopen', () => {
  type CloseTxPrismaMock = {
    validationResult: { deleteMany: jest.Mock; createMany: jest.Mock };
    roster: { update: jest.Mock };
  };
  type PrismaMock = {
    roster: { findUnique: jest.Mock; update: jest.Mock };
    scheduleEntry: { findMany: jest.Mock };
    dailyStaffingRule: { findMany: jest.Mock };
    validationResult: { deleteMany: jest.Mock; createMany: jest.Mock };
    $transaction: jest.Mock;
  };

  let prisma: PrismaMock;
  let service: RosterStateService;

  const facilityId = '1';
  const draftRoster = {
    id: 100n,
    facilityId: 1n,
    yearMonth: '2026-08',
    status: 'DRAFT',
  };
  const closedRoster = { ...draftRoster, status: 'CLOSED' };

  beforeEach(() => {
    prisma = {
      roster: {
        findUnique: jest.fn().mockResolvedValue(draftRoster),
        update: jest.fn().mockResolvedValue({}),
      },
      scheduleEntry: { findMany: jest.fn().mockResolvedValue([]) },
      dailyStaffingRule: { findMany: jest.fn().mockResolvedValue([]) },
      validationResult: {
        deleteMany: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn((cb: (tx: CloseTxPrismaMock) => Promise<unknown>) =>
        cb(prisma as unknown as CloseTxPrismaMock),
      ),
    };
    service = new RosterStateService(prisma as unknown as PrismaService);
  });

  it('DIRECTOR/OFFICE_MANAGER가 아니면 마감을 거부한다(403)', async () => {
    await expect(
      service.close(
        '100',
        facilityId,
        '9',
        'SOCIAL_WORKER' as JobRole,
        false,
        undefined,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.roster.update).not.toHaveBeenCalled();
  });

  it('DIRECTOR는 위반 없는 DRAFT 근무표를 마감할 수 있다', async () => {
    const result = await service.close(
      '100',
      facilityId,
      '9',
      'DIRECTOR' as JobRole,
      false,
      undefined,
    );

    expect(result.status).toBe('CLOSED');
    expect(prisma.roster.update).toHaveBeenCalledWith({
      where: { id: 100n },
      data: {
        status: 'CLOSED',
        closedBy: 9n,
        closedAt: expect.any(Date) as Date,
        forceClosed: false,
        forceCloseReason: null,
      },
    });
  });

  it('DRAFT가 아닌(CLOSED) 근무표는 마감할 수 없다', async () => {
    prisma.roster.findUnique.mockResolvedValue(closedRoster);

    await expect(
      service.close(
        '100',
        facilityId,
        '9',
        'OFFICE_MANAGER' as JobRole,
        false,
        undefined,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('DIRECTOR/OFFICE_MANAGER가 아니면 마감취소도 거부한다(403)', async () => {
    prisma.roster.findUnique.mockResolvedValue(closedRoster);

    await expect(
      service.reopen('100', facilityId, 'SOCIAL_WORKER' as JobRole),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.roster.update).not.toHaveBeenCalled();
  });

  it('OFFICE_MANAGER는 마감취소로 DRAFT 복귀 + 마감 이력을 초기화한다', async () => {
    prisma.roster.findUnique.mockResolvedValue(closedRoster);

    const result = await service.reopen(
      '100',
      facilityId,
      'OFFICE_MANAGER' as JobRole,
    );

    expect(result.status).toBe('DRAFT');
    expect(prisma.roster.update).toHaveBeenCalledWith({
      where: { id: 100n },
      data: {
        status: 'DRAFT',
        closedBy: null,
        closedAt: null,
        forceClosed: false,
        forceCloseReason: null,
      },
    });
  });

  it('CLOSED가 아닌(DRAFT) 근무표는 마감취소할 수 없다', async () => {
    await expect(
      service.reopen('100', facilityId, 'DIRECTOR' as JobRole),
    ).rejects.toThrow(ConflictException);
  });
});
