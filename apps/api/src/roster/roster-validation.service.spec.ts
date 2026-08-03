import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RosterValidationService } from './roster-validation.service';
import { MonthlyStaffingItemDto } from './dto/roster-validation.dto';

// §4.1~4.3 계산 검증. RosterService/RosterStateService의 spec과 동일하게 prisma mock을
// 직접 넘겨 서비스를 생성한다(NestJS TestingModule 없이 — DI 대상이 PrismaService 하나뿐).

type PrismaMock = {
  facility: { findUniqueOrThrow: jest.Mock };
  regulationParamSet: { findFirst: jest.Mock };
  monthlyCensus: { findUnique: jest.Mock };
  scheduleEntry: { findMany: jest.Mock };
  publicHoliday: { findMany: jest.Mock };
};

const dec = (n: number) => new Prisma.Decimal(n);

const facilityRow = {
  id: 1n,
  capacity: 60,
  staffingRatio: dec(2.1),
  outsourcedMeal: false,
  outsourcedLaundry: false,
  addonTargetScore: dec(15),
};

// 스키마 @default 값 그대로(§4.2~4.4 원문 수치)
const regParamsRow = {
  id: 1n,
  effectiveFrom: new Date('2026-01-01T00:00:00Z'),
  effectiveTo: null,
  hoursPerDay: 8,
  monthlyBaseHours: null as Prisma.Decimal | null,
  ratioCaregiver: dec(2.1),
  ratioNursePer: 25,
  ratioCookPer: 25,
  addonNurseExtraPt: dec(1.2),
  addonNurseRatioMax: dec(19.0),
  addonSwPt: dec(1.4),
  addonPtPt: dec(1.4),
  addonNightPt: dec(0.9),
  nightRatioMax: 20,
  dayNightMultiple: 2,
  nightDivisor: 7,
  dayDivisor: 14,
  addonRnPt: dec(0.6),
  addonRnBonus50: dec(0.2),
  subHolidayMaxHours: dec(8),
  annualLeaveCapDays: 25,
  roundingRules: null,
};

const censusRow = { facilityId: 1n, yearMonth: '2026-02', residentCount: 55, serviceDays: 20 };

const D = { recognizedMinutes: 480, countsAsWork: true, crossesMidnight: false };
const N = { recognizedMinutes: 580, countsAsWork: true, crossesMidnight: true };

function entriesOf(
  employeeId: bigint,
  jobRole: string,
  shift: typeof D | typeof N,
  count: number,
  isRn = false,
) {
  return Array.from({ length: count }, () => ({
    employeeId,
    employee: { jobRole, isRn },
    shiftType: shift,
  }));
}

describe('RosterValidationService.compute', () => {
  let prisma: PrismaMock;
  let service: RosterValidationService;

  beforeEach(() => {
    prisma = {
      facility: { findUniqueOrThrow: jest.fn().mockResolvedValue(facilityRow) },
      regulationParamSet: { findFirst: jest.fn().mockResolvedValue(regParamsRow) },
      monthlyCensus: { findUnique: jest.fn().mockResolvedValue(censusRow) },
      scheduleEntry: { findMany: jest.fn().mockResolvedValue([]) },
      publicHoliday: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new RosterValidationService(prisma as unknown as PrismaService);
  });

  const staffing = (items: MonthlyStaffingItemDto[], category: string) =>
    items.find((i) => i.category === category)!;

  it('RegulationParamSet 미설정 시 configMissing=true, 계산 결과는 모두 빈 값', async () => {
    prisma.regulationParamSet.findFirst.mockResolvedValue(null);
    const result = await service.compute(1n, 100n, '2026-02');
    expect(result).toEqual({
      monthlyBaseHours: null,
      monthlyStaffing: [],
      bonusScore: null,
      configMissing: true,
    });
  });

  it('MonthlyCensus 미설정 시 configMissing=true — 월 기준근무시간은 계산되지만 인력산정은 비운다', async () => {
    prisma.monthlyCensus.findUnique.mockResolvedValue(null);
    const result = await service.compute(1n, 100n, '2026-02');
    expect(result.configMissing).toBe(true);
    expect(result.monthlyBaseHours).toBe(160); // 2026-02: 주말 8일 제외 20 근무일 × 8h
    expect(result.monthlyStaffing).toEqual([]);
    expect(result.bonusScore).toBeNull();
  });

  it('§4.1 월 기준근무시간 = (일수 − 토·일 − 공휴일) × hoursPerDay', async () => {
    const result = await service.compute(1n, 100n, '2026-02');
    expect(result.monthlyBaseHours).toBe(160);
  });

  it('§4.1 RegulationParamSet.monthlyBaseHours가 있으면 산식 대신 그 값을 그대로 쓴다', async () => {
    prisma.regulationParamSet.findFirst.mockResolvedValue({
      ...regParamsRow,
      monthlyBaseHours: dec(176),
    });
    const result = await service.compute(1n, 100n, '2026-02');
    expect(result.monthlyBaseHours).toBe(176);
    expect(prisma.publicHoliday.findMany).not.toHaveBeenCalled();
  });

  it('§4.2 근무자 산정 — 충족 인원 + 미달자 근무시간 합산 환산(소수점 버림)', async () => {
    // baseMinutes = 160h × 60 = 9600분. CAREGIVER 3명: 1명은 충족(9600), 2명은 절반(4800)씩 미달
    // → 미달 합산 9600 ÷ 9600 = 1명 환산. actual = 1(충족) + 1(환산) = 2. required = ceil(55/2.1) = 27.
    prisma.scheduleEntry.findMany.mockResolvedValue([
      ...entriesOf(1n, 'CAREGIVER', D, 20), // 20×480=9600 충족
      ...entriesOf(2n, 'CAREGIVER', D, 10), // 10×480=4800 미달
      ...entriesOf(3n, 'CAREGIVER', D, 10), // 10×480=4800 미달
    ]);
    const result = await service.compute(1n, 100n, '2026-02');
    const caregiver = staffing(result.monthlyStaffing, 'CAREGIVER');
    expect(caregiver.required).toBe(27);
    expect(caregiver.actual).toBe(2);
    expect(caregiver.met).toBe(false);
  });

  it('§4.2 요양보호사 배치비율 — Facility.staffingRatio가 고시 기본값(ratioCaregiver)과 다르면 시설별 override로 우선 적용', async () => {
    prisma.facility.findUniqueOrThrow.mockResolvedValue({ ...facilityRow, staffingRatio: dec(2.3) });
    const result = await service.compute(1n, 100n, '2026-02');
    expect(staffing(result.monthlyStaffing, 'CAREGIVER').required).toBe(24); // ceil(55/2.3)
  });

  it('§4.2 요양보호사 배치비율 — Facility.staffingRatio가 고시 기본값과 같으면(override 없음) ratioCaregiver 개정치를 그대로 따른다', async () => {
    prisma.regulationParamSet.findFirst.mockResolvedValue({ ...regParamsRow, ratioCaregiver: dec(2.5) });
    prisma.facility.findUniqueOrThrow.mockResolvedValue({ ...facilityRow, staffingRatio: dec(2.5) });
    const result = await service.compute(1n, 100n, '2026-02');
    expect(staffing(result.monthlyStaffing, 'CAREGIVER').required).toBe(22); // ceil(55/2.5)
  });

  it('§4.2 NURSE·NURSE_AIDE는 간호(조무)사 1행으로 합산, PT·OT는 물리(작업)치료사 1행으로 합산', async () => {
    prisma.scheduleEntry.findMany.mockResolvedValue([
      ...entriesOf(1n, 'NURSE', D, 20),
      ...entriesOf(2n, 'NURSE_AIDE', D, 20),
      ...entriesOf(3n, 'PHYSICAL_THERAPIST', D, 20),
    ]);
    const result = await service.compute(1n, 100n, '2026-02');
    const nurseOrAide = staffing(result.monthlyStaffing, 'NURSE_OR_AIDE');
    const therapist = staffing(result.monthlyStaffing, 'THERAPIST');
    expect(nurseOrAide.actual).toBe(2); // NURSE 1 + NURSE_AIDE 1
    expect(nurseOrAide.required).toBe(3); // ceil(55/25)
    expect(therapist.actual).toBe(1);
    expect(therapist.required).toBe(1); // residents(55) <= 100
  });

  it('§4.2 필요 인원 임계값 — 입소자 50명 이상이면 사무국장·사무원·관리인 1명 필요', async () => {
    const result = await service.compute(1n, 100n, '2026-02');
    expect(staffing(result.monthlyStaffing, 'OFFICE_MANAGER').required).toBe(1);
    expect(staffing(result.monthlyStaffing, 'CLERK').required).toBe(1);
    expect(staffing(result.monthlyStaffing, 'JANITOR').required).toBe(1);
    expect(staffing(result.monthlyStaffing, 'DIRECTOR').required).toBe(1);
  });

  it('§4.2 위탁급식·위탁세탁 이용 시 영양사·조리원·위생원 면제', async () => {
    prisma.facility.findUniqueOrThrow.mockResolvedValue({
      ...facilityRow,
      outsourcedMeal: true,
      outsourcedLaundry: true,
    });
    const result = await service.compute(1n, 100n, '2026-02');
    expect(staffing(result.monthlyStaffing, 'DIETITIAN').required).toBe(0);
    expect(staffing(result.monthlyStaffing, 'COOK').required).toBe(0);
    expect(staffing(result.monthlyStaffing, 'HYGIENIST').required).toBe(0);
  });

  it('§4.3① 사회복지사가 배치기준을 초과하면 초과 인원 × 1.4점 가산', async () => {
    // required(SOCIAL_WORKER) = 1 (residents=55 ≤ 100). 2명 모두 충족 → actual=2 → extra=1 → 1.4점
    // ③의 "입소자 50인 이상 +0.2점"은 RN 유무와 무관하게 적용되므로(§4.3③ 원문) nurseAddon=0.2도 함께 반영된다.
    prisma.scheduleEntry.findMany.mockResolvedValue([
      ...entriesOf(1n, 'SOCIAL_WORKER', D, 20),
      ...entriesOf(2n, 'SOCIAL_WORKER', D, 20),
    ]);
    const result = await service.compute(1n, 100n, '2026-02');
    expect(result.bonusScore!.breakdown.staffAddon).toBe(1.4);
    expect(result.bonusScore!.breakdown.nurseAddon).toBe(0.2);
    expect(result.bonusScore!.estimated).toBe(1.6);
    expect(result.bonusScore!.target).toBe(15);
    expect(result.bonusScore!.isPlanBased).toBe(true);
  });

  it('§4.3② 야간직원배치 — 야간·주간 인력수·비율 조건을 모두 충족해야 0.9점', async () => {
    // nightDivisor=7, dayDivisor=14, serviceDays=20.
    // 야간(N, 580분) 20건: nightHeadcount = floor(11600/60/7/20) = floor(1.38) = 1
    // 주간(D, 480분) 20건×6명: dayHeadcount = floor(57600/60/14/20) = floor(3.43) = 3 ≥ 1×2 (충족)
    // 입소자 55명 ÷ 야간 1명 = 55 > nightRatioMax(20) → 비율 조건만 불충족 → 0점(음성 케이스)
    prisma.scheduleEntry.findMany.mockResolvedValue([
      ...entriesOf(1n, 'CAREGIVER', N, 20),
      ...[1, 2, 3, 4, 5, 6].flatMap((i) => entriesOf(BigInt(10 + i), 'CAREGIVER', D, 20)),
    ]);
    const result = await service.compute(1n, 100n, '2026-02');
    expect(result.bonusScore!.breakdown.nightAddon).toBe(0);
  });

  it('§4.3② 입소자 대비 야간 인력 비율까지 충족하면 0.9점', async () => {
    prisma.monthlyCensus.findUnique.mockResolvedValue({ ...censusRow, residentCount: 15 });
    prisma.scheduleEntry.findMany.mockResolvedValue([
      ...entriesOf(1n, 'CAREGIVER', N, 20), // nightHeadcount=1, 15÷1=15 ≤ 20
      ...[1, 2, 3, 4, 5, 6].flatMap((i) => entriesOf(BigInt(10 + i), 'CAREGIVER', D, 20)), // dayHeadcount=24 ≥ 2
    ]);
    const result = await service.compute(1n, 100n, '2026-02');
    expect(result.bonusScore!.breakdown.nightAddon).toBe(0.9);
  });

  it('§4.3③ 간호사(RN)만 집계 — 간호조무사는 제외, 입소자 50인 이상이면 +0.2점', async () => {
    prisma.scheduleEntry.findMany.mockResolvedValue([
      ...entriesOf(1n, 'NURSE', D, 20, true), // RN, 충족
      ...entriesOf(2n, 'NURSE', D, 20, false), // RN 아님 → 제외
      ...entriesOf(3n, 'NURSE_AIDE', D, 20, true), // isRn 플래그가 있어도 직군이 NURSE_AIDE면 제외
    ]);
    const result = await service.compute(1n, 100n, '2026-02');
    // rnActual=1 → 1×0.6 + (residents 55≥50 → +0.2) = 0.8
    expect(result.bonusScore!.breakdown.nurseAddon).toBe(0.8);
  });
});
