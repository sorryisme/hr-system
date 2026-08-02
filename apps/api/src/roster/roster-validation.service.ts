import { Injectable } from '@nestjs/common';
import { Facility, JobRole, RegulationParamSet } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  BonusScoreDto,
  MonthlyStaffingItemDto,
  RosterValidationDto,
  STAFFING_CATEGORIES,
  StaffingCategory,
} from './dto/roster-validation.dto';

type RegulationParamSetRow = RegulationParamSet;
type FacilityRow = Facility;

/// §4.2 표의 JobRole → 직군행 매핑. NURSE/NURSE_AIDE, PHYSICAL/OCCUPATIONAL_THERAPIST는 한 행으로 합산.
const CATEGORY_BY_JOB_ROLE: Record<JobRole, StaffingCategory> = {
  DIRECTOR: 'DIRECTOR',
  OFFICE_MANAGER: 'OFFICE_MANAGER',
  SOCIAL_WORKER: 'SOCIAL_WORKER',
  NURSE: 'NURSE_OR_AIDE',
  NURSE_AIDE: 'NURSE_OR_AIDE',
  PHYSICAL_THERAPIST: 'THERAPIST',
  OCCUPATIONAL_THERAPIST: 'THERAPIST',
  CAREGIVER: 'CAREGIVER',
  CLERK: 'CLERK',
  DIETITIAN: 'DIETITIAN',
  COOK: 'COOK',
  HYGIENIST: 'HYGIENIST',
  JANITOR: 'JANITOR',
};

/// §4.3②에서 주/야 인력수 계산 대상(요양보호사 + 간호(조무)사)
const NIGHT_ADDON_ROLES: readonly JobRole[] = ['CAREGIVER', 'NURSE', 'NURSE_AIDE'];

interface EmployeeAgg {
  jobRole: JobRole;
  isRn: boolean;
  /// §4.1 인정 근무시간 합(분) — 근무자 산정 방식(§4.2)의 충족/미달 판정 기준
  recognizedMinutes: number;
  /// §4.3② 22~06시 근무 추정 분(계획 기준 — crossesMidnight 유형을 야간으로 취급)
  nightMinutes: number;
  /// §4.3② 06~22시 근무 추정 분
  dayMinutes: number;
}

/// 근무표 실시간 검증 패널(§4.8) 계산 — §4.1 월 기준근무시간, §4.2 월별 적정 근무자 수,
/// §4.3 가산 산정. §4.5 일별 주/야 미달은 RosterService.buildSummary가 이미 담당한다(중복 계산 안 함).
/// RegulationParamSet·MonthlyCensus는 A-6 설정 화면이 아직 없어 시드/DB에 값이 없을 수 있다 —
/// 그 경우 configMissing=true로 응답해 프론트가 "설정 필요" 안내를 띄운다(에러로 막지 않음).
@Injectable()
export class RosterValidationService {
  constructor(private readonly prisma: PrismaService) {}

  async compute(
    facilityId: bigint,
    rosterId: bigint,
    yearMonth: string,
  ): Promise<RosterValidationDto> {
    const [facility, regParams, census, entries] = await Promise.all([
      this.prisma.facility.findUniqueOrThrow({ where: { id: facilityId } }),
      this.currentRegulationParamSet(yearMonth),
      this.prisma.monthlyCensus.findUnique({
        where: { facilityId_yearMonth: { facilityId, yearMonth } },
      }),
      this.prisma.scheduleEntry.findMany({
        where: { rosterId },
        select: {
          employeeId: true,
          employee: { select: { jobRole: true, isRn: true } },
          shiftType: {
            select: {
              recognizedMinutes: true,
              countsAsWork: true,
              crossesMidnight: true,
            },
          },
        },
      }),
    ]);

    const monthlyBaseHours = regParams
      ? await this.monthlyBaseHours(yearMonth, regParams)
      : null;

    if (!regParams || !census) {
      return {
        monthlyBaseHours,
        monthlyStaffing: [],
        bonusScore: null,
        configMissing: true,
      };
    }

    const byEmployee = this.aggregateByEmployee(entries);
    const baseMinutes = monthlyBaseHours! * 60;
    const residents = census.residentCount;

    const monthlyStaffing = STAFFING_CATEGORIES.map((category) =>
      this.staffingItem(category, byEmployee, baseMinutes, residents, facility, regParams),
    );

    const bonusScore = this.computeBonusScore(
      byEmployee,
      monthlyStaffing,
      baseMinutes,
      residents,
      census.serviceDays,
      facility,
      regParams,
    );

    return { monthlyBaseHours, monthlyStaffing, bonusScore, configMissing: false };
  }

  // ---------------------------------------------------------------
  // §4.1 월 기준근무시간 = (해당 월 일수 − 토·일 − 법정공휴일) × hoursPerDay. override 우선.
  // ---------------------------------------------------------------
  private async monthlyBaseHours(
    yearMonth: string,
    regParams: RegulationParamSetRow,
  ): Promise<number> {
    if (regParams.monthlyBaseHours != null) {
      return regParams.monthlyBaseHours.toNumber();
    }
    const [y, m] = yearMonth.split('-').map(Number);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const monthStart = new Date(Date.UTC(y, m - 1, 1));
    const monthEnd = new Date(Date.UTC(y, m - 1, daysInMonth));

    const holidays = await this.prisma.publicHoliday.findMany({
      where: { holidayDate: { gte: monthStart, lte: monthEnd } },
      select: { holidayDate: true },
    });
    const holidaySet = new Set(
      holidays.map((h) => h.holidayDate.toISOString().slice(0, 10)),
    );

    let workdays = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(Date.UTC(y, m - 1, d));
      const dow = date.getUTCDay(); // 0=일, 6=토
      const key = date.toISOString().slice(0, 10);
      if (dow === 0 || dow === 6 || holidaySet.has(key)) continue;
      workdays++;
    }
    return workdays * regParams.hoursPerDay;
  }

  // ---------------------------------------------------------------
  // 직원별 인정 근무시간(§4.1) + 주/야 실근무시간(§4.3② 계획 기준 추정치, crossesMidnight로 판정) 합산
  // ---------------------------------------------------------------
  private aggregateByEmployee(
    entries: Array<{
      employeeId: bigint;
      employee: { jobRole: JobRole; isRn: boolean };
      shiftType: {
        recognizedMinutes: number | null;
        countsAsWork: boolean;
        crossesMidnight: boolean;
      };
    }>,
  ): EmployeeAgg[] {
    const byId = new Map<string, EmployeeAgg>();
    for (const e of entries) {
      const key = e.employeeId.toString();
      const agg = byId.get(key) ?? {
        jobRole: e.employee.jobRole,
        isRn: e.employee.isRn,
        recognizedMinutes: 0,
        nightMinutes: 0,
        dayMinutes: 0,
      };
      const minutes = e.shiftType.recognizedMinutes ?? 0;
      agg.recognizedMinutes += minutes;
      if (e.shiftType.countsAsWork && NIGHT_ADDON_ROLES.includes(e.employee.jobRole)) {
        if (e.shiftType.crossesMidnight) agg.nightMinutes += minutes;
        else agg.dayMinutes += minutes;
      }
      byId.set(key, agg);
    }
    return [...byId.values()];
  }

  // ---------------------------------------------------------------
  // §4.2 근무자 산정 방식: 기준시간 충족 인원 + (미달자 근무시간 합 ÷ 기준시간, 소수점 버림)
  // ---------------------------------------------------------------
  private convertedHeadcount(employees: EmployeeAgg[], baseMinutes: number): number {
    if (baseMinutes <= 0) return employees.length;
    let met = 0;
    let shortfallSum = 0;
    for (const e of employees) {
      if (e.recognizedMinutes >= baseMinutes) met++;
      else shortfallSum += e.recognizedMinutes;
    }
    return met + Math.floor(shortfallSum / baseMinutes);
  }

  /// "100명 초과 시마다 1명 추가"(§4.2 사회복지사·물리(작업)치료사·위생원) — 100명 초과분을 100명
  /// 단위로 올림해 추가 인원을 산정한다(예: 101명→+1, 200명→+1, 201명→+2).
  private extraOverHundred(residents: number): number {
    return residents > 100 ? Math.ceil((residents - 100) / 100) : 0;
  }

  private requiredHeadcount(
    category: StaffingCategory,
    residents: number,
    facility: FacilityRow,
    params: RegulationParamSetRow,
  ): number {
    switch (category) {
      case 'DIRECTOR':
        return 1;
      case 'OFFICE_MANAGER':
        return residents >= 50 ? 1 : 0;
      case 'SOCIAL_WORKER':
        return 1 + this.extraOverHundred(residents);
      case 'NURSE_OR_AIDE':
        return Math.ceil(residents / params.ratioNursePer);
      case 'THERAPIST':
        return 1 + this.extraOverHundred(residents);
      case 'CAREGIVER': {
        // 기본값은 고시 파라미터(ratioCaregiver, 개정 시 자동 반영). Facility.staffingRatio는
        // CHECK(2.1/2.3)로 시설 유형(일반형/치매전담형)을 나타내며, 고시 기본값과 다를 때만
        // 시설별 override로 우선 적용한다.
        const baseRatio = params.ratioCaregiver.toNumber();
        const facilityRatio = facility.staffingRatio.toNumber();
        const ratio = facilityRatio !== baseRatio ? facilityRatio : baseRatio;
        return Math.ceil(residents / ratio);
      }
      case 'CLERK':
        return residents >= 50 ? 1 : 0;
      case 'DIETITIAN':
        return facility.outsourcedMeal ? 0 : 1;
      case 'COOK':
        return facility.outsourcedMeal ? 0 : Math.ceil(residents / params.ratioCookPer);
      case 'HYGIENIST':
        return facility.outsourcedLaundry ? 0 : 1 + this.extraOverHundred(residents);
      case 'JANITOR':
        return residents >= 50 ? 1 : 0;
    }
  }

  private staffingItem(
    category: StaffingCategory,
    byEmployee: EmployeeAgg[],
    baseMinutes: number,
    residents: number,
    facility: FacilityRow,
    params: RegulationParamSetRow,
  ): MonthlyStaffingItemDto {
    const employees = byEmployee.filter((e) => CATEGORY_BY_JOB_ROLE[e.jobRole] === category);
    const required = this.requiredHeadcount(category, residents, facility, params);
    const actual = this.convertedHeadcount(employees, baseMinutes);
    return { category, required, actual, met: actual >= required };
  }

  // ---------------------------------------------------------------
  // §4.3 가산 산정. 입소자 수 ÷ 근무인원 수는 소수점 셋째 자리에서 절사하지만, 임계값 비교이므로
  // 부동소수 비교로 충분하다(반올림 오차가 임계값 경계에 걸리는 경우는 A-6 설정 검토 대상).
  // ---------------------------------------------------------------
  private computeBonusScore(
    byEmployee: EmployeeAgg[],
    monthlyStaffing: MonthlyStaffingItemDto[],
    baseMinutes: number,
    residents: number,
    serviceDays: number,
    facility: FacilityRow,
    params: RegulationParamSetRow,
  ): BonusScoreDto {
    const byCategory = new Map(monthlyStaffing.map((i) => [i.category, i]));
    const round2 = (n: number) => Math.round(n * 100) / 100;

    // ① 인력배치추가
    let staffAddon = 0;
    const nurseRow = byCategory.get('NURSE_OR_AIDE')!;
    const nurseExtra = nurseRow.actual - nurseRow.required;
    if (nurseExtra > 0 && residents / nurseRow.actual < params.addonNurseRatioMax.toNumber()) {
      staffAddon += nurseExtra * params.addonNurseExtraPt.toNumber();
    }
    const swRow = byCategory.get('SOCIAL_WORKER')!;
    const swExtra = swRow.actual - swRow.required;
    if (swExtra > 0) staffAddon += swExtra * params.addonSwPt.toNumber();
    const ptRow = byCategory.get('THERAPIST')!;
    const ptExtra = ptRow.actual - ptRow.required;
    if (ptExtra > 0) staffAddon += ptExtra * params.addonPtPt.toNumber();

    // ② 야간직원배치(계획 기준 추정치)
    let totalNightMinutes = 0;
    let totalDayMinutes = 0;
    for (const e of byEmployee) {
      totalNightMinutes += e.nightMinutes;
      totalDayMinutes += e.dayMinutes;
    }
    const nightHeadcount =
      serviceDays > 0
        ? Math.floor(totalNightMinutes / 60 / params.nightDivisor / serviceDays)
        : 0;
    const dayHeadcount =
      serviceDays > 0 ? Math.floor(totalDayMinutes / 60 / params.dayDivisor / serviceDays) : 0;
    let nightAddon = 0;
    if (
      nightHeadcount >= 1 &&
      residents / nightHeadcount <= params.nightRatioMax &&
      dayHeadcount >= nightHeadcount * params.dayNightMultiple
    ) {
      nightAddon = params.addonNightPt.toNumber();
    }

    // ③ 간호사배치(RN만 — isRn=true)
    const rnEmployees = byEmployee.filter((e) => e.jobRole === 'NURSE' && e.isRn);
    const rnActual = this.convertedHeadcount(rnEmployees, baseMinutes);
    let nurseAddon = rnActual * params.addonRnPt.toNumber();
    if (residents >= 50) nurseAddon += params.addonRnBonus50.toNumber();

    return {
      estimated: round2(staffAddon + nightAddon + nurseAddon),
      target: facility.addonTargetScore ? facility.addonTargetScore.toNumber() : null,
      breakdown: {
        staffAddon: round2(staffAddon),
        nightAddon: round2(nightAddon),
        nurseAddon: round2(nurseAddon),
      },
      isPlanBased: true,
    };
  }

  private async currentRegulationParamSet(
    yearMonth: string,
  ): Promise<RegulationParamSetRow | null> {
    const [y, m] = yearMonth.split('-').map(Number);
    const monthEnd = new Date(Date.UTC(y, m, 0));
    return this.prisma.regulationParamSet.findFirst({
      where: {
        effectiveFrom: { lte: monthEnd },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: monthEnd } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
  }
}
