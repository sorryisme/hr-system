import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  RosterCellDto,
  RosterDaySummaryDto,
  RosterResponseDto,
  RosterTeamGroupDto,
} from './dto/roster-response.dto';

/// 근무표 셀 조회 시 함께 읽는 관계. shiftType의 분류 필드(countsAsWork/crossesMidnight)는
/// 하단 요약(근무 인원·요양보호사 주/야) 계산에 쓰인다.
const entryInclude = {
  employee: { select: { id: true, jobRole: true } },
  shiftType: {
    select: {
      code: true,
      cellLabel: true,
      startTime: true,
      endTime: true,
      countsAsWork: true,
      crossesMidnight: true,
    },
  },
  sourceLedger: { select: { carryableMinutes: true } },
} satisfies Prisma.ScheduleEntryInclude;

type EntryRow = Prisma.ScheduleEntryGetPayload<{
  include: typeof entryInclude;
}>;

@Injectable()
export class RosterService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------
  // GET /rosters — 목업(근무표 승인) 렌더용 단일 조회
  // ---------------------------------------------------------------
  async getRoster(
    facilityId: string,
    yearMonth: string,
  ): Promise<RosterResponseDto> {
    const facility = this.parseId(facilityId);

    const roster = await this.prisma.roster.findUnique({
      where: { facilityId_yearMonth: { facilityId: facility, yearMonth } },
    });
    if (!roster) {
      throw new NotFoundException({
        code: 'ROSTER_NOT_FOUND',
        message: '해당 월의 근무표가 아직 없습니다. 먼저 생성해 주세요.',
      });
    }

    const [employees, entries, staffingRules] = await Promise.all([
      // 세로축: 재직 직원(팀 정렬 → 이름). 종사자 본인 팀 제한은 관리자 조회라 미적용(앱 레벨)
      this.prisma.employee.findMany({
        where: { facilityId: facility, status: 'ACTIVE' },
        select: {
          id: true,
          name: true,
          jobRole: true,
          teamId: true,
          team: { select: { id: true, name: true, sortOrder: true } },
        },
        orderBy: [{ team: { sortOrder: 'asc' } }, { name: 'asc' }],
      }),
      this.prisma.scheduleEntry.findMany({
        where: { rosterId: roster.id },
        include: entryInclude,
      }),
      // 시설 전체 기준(teamId=null) 최소 인원. 팀별 규칙 반영은 후속(§4.5)
      this.prisma.dailyStaffingRule.findMany({
        where: { facilityId: facility, teamId: null },
      }),
    ]);

    const daysInMonth = this.daysInMonth(yearMonth);

    return {
      id: roster.id.toString(),
      yearMonth: roster.yearMonth,
      status: roster.status,
      daysInMonth,
      teams: this.buildTeams(employees),
      cells: entries.map((e) => this.toCell(e)),
      summary: this.buildSummary(
        entries,
        yearMonth,
        daysInMonth,
        staffingRules,
      ),
    };
  }

  // ---------------------------------------------------------------
  // POST /rosters — 월 근무표 생성(빈 DRAFT). 셀은 이후 편집/프리셋/결재 반영으로 채운다
  // ---------------------------------------------------------------
  async createRoster(
    facilityId: string,
    yearMonth: string,
  ): Promise<{ id: string; yearMonth: string; status: string }> {
    const facility = this.parseId(facilityId);
    try {
      const roster = await this.prisma.roster.create({
        data: { facilityId: facility, yearMonth, status: 'DRAFT' },
      });
      return {
        id: roster.id.toString(),
        yearMonth: roster.yearMonth,
        status: roster.status,
      };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'ROSTER_ALREADY_EXISTS',
          message: '해당 월의 근무표가 이미 있습니다.',
        });
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------
  // 편집·상태머신 엔드포인트(§4.8)는 후속 슬라이스에서 구현한다.
  //   PATCH /rosters/:id/entries        — 셀 다건 편집(COMPLETED→DRAFT 복귀)
  //   POST  /rosters/:id/apply-preset   — 프리셋 적용(§4.6 월경계 연속성)
  //   POST  /rosters/:id/complete       — DRAFT→COMPLETED(검증 스냅샷)
  //   POST  /rosters/:id/submit-close   — COMPLETED→CLOSING_APPROVAL
  //   POST  /rosters/:id/close          — CLOSING_APPROVAL→CLOSED(위반 시 강행 사유 D-19)
  //   POST  /rosters/:id/reject-close   — CLOSING_APPROVAL→DRAFT
  // 결재 승인 이벤트(request.approved/step_approved) 구독 → 셀 반영(source=APPROVAL)도 이때 추가.
  // 선행 확정: D-21(지난 일자 변경 결재), roster:write/close 권한 차등(§1.3).
  // ---------------------------------------------------------------

  // ---------------------------------------------------------------
  // 매핑·집계 (BigInt/Decimal → string, Time → HH:mm 명시 변환)
  // ---------------------------------------------------------------

  private buildTeams(
    employees: Array<{
      id: bigint;
      name: string;
      jobRole: EntryRow['employee']['jobRole'];
      teamId: bigint | null;
      team: { id: bigint; name: string; sortOrder: number } | null;
    }>,
  ): RosterTeamGroupDto[] {
    const groups = new Map<string, RosterTeamGroupDto>();
    for (const e of employees) {
      const key = e.teamId?.toString() ?? 'none';
      if (!groups.has(key)) {
        groups.set(key, {
          teamId: e.team?.id.toString() ?? null,
          name: e.team?.name ?? '미배정',
          employees: [],
        });
      }
      groups.get(key)!.employees.push({
        id: e.id.toString(),
        name: e.name,
        jobRole: e.jobRole,
      });
    }
    return [...groups.values()];
  }

  private toCell(e: EntryRow): RosterCellDto {
    const start = e.overrideStartTime ?? e.shiftType.startTime;
    const end = e.overrideEndTime ?? e.shiftType.endTime;
    return {
      employeeId: e.employeeId.toString(),
      workDate: this.toDate(e.workDate),
      shiftCode: e.shiftType.code,
      cellLabel: e.shiftType.cellLabel,
      startTime: this.toTime(start),
      endTime: this.toTime(end),
      isTimeOverridden: e.overrideStartTime !== null,
      isProvisional: e.isProvisional,
      source: e.source,
      carryableMinutes: e.sourceLedger?.carryableMinutes ?? null,
    };
  }

  /// 날짜별 근무 인원 + 요양보호사 주/야 과부족(§4.5).
  /// 주간 = countsAsWork && !crossesMidnight, 야간 = countsAsWork && crossesMidnight.
  private buildSummary(
    entries: EntryRow[],
    yearMonth: string,
    daysInMonth: number,
    staffingRules: Array<{ period: 'DAY' | 'NIGHT'; minCount: number }>,
  ): RosterDaySummaryDto[] {
    const dayMin = staffingRules.find((r) => r.period === 'DAY')?.minCount ?? 0;
    const nightMin =
      staffingRules.find((r) => r.period === 'NIGHT')?.minCount ?? 0;

    type Acc = { working: number; careDay: number; careNight: number };
    const byDate = new Map<string, Acc>();
    for (const e of entries) {
      const key = this.toDate(e.workDate);
      const acc = byDate.get(key) ?? { working: 0, careDay: 0, careNight: 0 };
      if (e.shiftType.countsAsWork) {
        acc.working += 1;
        const isCaregiver = e.employee.jobRole === 'CAREGIVER';
        if (isCaregiver && e.shiftType.crossesMidnight) acc.careNight += 1;
        else if (isCaregiver) acc.careDay += 1;
      }
      byDate.set(key, acc);
    }

    const summary: RosterDaySummaryDto[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${yearMonth}-${String(d).padStart(2, '0')}`;
      const acc = byDate.get(key) ?? { working: 0, careDay: 0, careNight: 0 };
      summary.push({
        workDate: key,
        workingCount: acc.working,
        caregiverDay: acc.careDay,
        caregiverNight: acc.careNight,
        dayShortage: acc.careDay < dayMin,
        nightShortage: acc.careNight < nightMin,
      });
    }
    return summary;
  }

  // ---------------------------------------------------------------
  // 공통 유틸
  // ---------------------------------------------------------------

  private daysInMonth(yearMonth: string): number {
    const [y, m] = yearMonth.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }

  private toDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  /// @db.Time(0)은 1970-01-01T{time}Z 형태의 Date로 매핑된다 → UTC 기준 HH:mm 추출
  private toTime(t: Date | null): string | null {
    return t ? t.toISOString().slice(11, 16) : null;
  }

  private parseId(raw: string): bigint {
    try {
      return BigInt(raw);
    } catch {
      throw new BadRequestException({
        code: 'INVALID_ID',
        message: '잘못된 id 형식입니다.',
      });
    }
  }
}
