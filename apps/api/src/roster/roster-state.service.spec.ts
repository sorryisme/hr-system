import { BadRequestException, ConflictException } from '@nestjs/common';
import { RosterStateService } from './roster-state.service';
import { PrismaService } from '../prisma/prisma.service';
import { ApplyPresetDto } from './dto/apply-preset.dto';

// §4.6/§4.8 프리셋 적용 검증. $transaction은 콜백에 동일한 prisma mock을 tx로 넘겨
// 호출하는 것으로 대체한다(roster-reflection.service.spec.ts와 동일한 패턴).

type ScheduleEntryRow = {
  workDate: Date;
  shiftTypeId: bigint;
  source: 'MANUAL' | 'PRESET' | 'APPROVAL';
};

type PrismaMock = {
  roster: { findUnique: jest.Mock; update: jest.Mock };
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

  it('COMPLETED 상태에서 적용하면 DRAFT로 복귀한다', async () => {
    prisma.roster.findUnique.mockResolvedValue({
      ...rosterRow,
      status: 'COMPLETED',
    });

    await service.applyPreset('100', facilityId, baseDto());

    expect(prisma.roster.update).toHaveBeenCalledWith({
      where: { id: 100n },
      data: { status: 'DRAFT' },
    });
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
