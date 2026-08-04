import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  JobRole,
  Prisma,
  Roster,
  RosterStatus,
  ValidationSeverity,
  ValidationSnapshotStage,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ApplyPresetDto,
  ApplyPresetResultDto,
  ApplyPresetSkipDto,
} from './dto/apply-preset.dto';
import {
  RosterTransitionResultDto,
  ValidationFindingDto,
} from './dto/roster-transition.dto';
import { RosterEntryInputDto } from './dto/update-entries.dto';

interface Finding {
  ruleCode: string;
  severity: ValidationSeverity;
  detail: Record<string, unknown>;
}

/// 마감/마감취소를 수행할 수 있는 직책(§1.3) — system_role은 둘 다 ADMIN이라 permissions.guard의
/// roster:close만으로는 차등이 안 돼, 앱 레벨에서 job_role을 추가로 검사한다.
const CLOSER_JOB_ROLES: readonly JobRole[] = ['DIRECTOR', 'OFFICE_MANAGER'];

/// 근무표 상태머신(§4.8) + 검증(§4.5)·마감 처리(D-19).
///   DRAFT(작성중) ─마감→ CLOSED(마감)
///        ▲───────마감취소───────┘
/// 권한: 편집=roster:write, 마감/마감취소=roster:close + job_role(시설장·사무국장)(컨트롤러+본 서비스에서 검사).
/// [결정 대기] D-21(지난 일자 변경 결재).
@Injectable()
export class RosterStateService {
  private readonly logger = new Logger(RosterStateService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------
  // 셀 편집 — 드래그 다건 입력. DRAFT에서만 허용(§4.8)
  // ---------------------------------------------------------------
  async updateEntries(
    id: string,
    facilityId: string,
    entries: RosterEntryInputDto[],
  ): Promise<RosterTransitionResultDto> {
    const roster = await this.loadOwned(id, facilityId);
    // 편집은 DRAFT에서만 허용(§4.8). CLOSED=결재 경유만(마감취소 후 편집).
    if (roster.status === RosterStatus.CLOSED) {
      throw new ConflictException({
        code: 'ROSTER_CLOSED',
        message: '마감된 근무표는 직접 수정할 수 없습니다(마감취소 후 편집).',
      });
    }

    // 트랜잭션 밖에서 입력을 선검증한다(형식·달력·월범위·시설 소속 → 400).
    const daysInMonth = this.daysInMonth(roster.yearMonth);
    const shiftId = await this.shiftCodeMap(roster.facilityId);
    const normalized = entries.map((e) => {
      const shiftTypeId = shiftId.get(e.shiftCode);
      if (!shiftTypeId) {
        throw new BadRequestException({
          code: 'UNKNOWN_SHIFT_CODE',
          message: `알 수 없는 근무유형 코드: ${e.shiftCode}`,
        });
      }
      // override 시각은 둘 다 또는 둘 다 생략(§4.8)
      if (!!e.overrideStartTime !== !!e.overrideEndTime) {
        throw new BadRequestException({
          code: 'OVERRIDE_TIME_PAIR',
          message: '조정 시각은 시작·종료를 함께 입력해야 합니다.',
        });
      }
      return {
        employeeId: this.parseId(e.employeeId),
        workDate: this.parseWorkDate(e.workDate, roster.yearMonth, daysInMonth),
        shiftTypeId,
        overrideStartTime: this.toTime(e.overrideStartTime),
        overrideEndTime: this.toTime(e.overrideEndTime),
      };
    });

    // 멀티테넌트 격리: 입력 직원이 모두 이 시설 소속인지 검증(타 시설 셀 덮어쓰기 차단)
    const empIds = [
      ...new Set(normalized.map((n) => n.employeeId.toString())),
    ].map((s) => BigInt(s));
    const owned = await this.prisma.employee.findMany({
      where: { id: { in: empIds }, facilityId: roster.facilityId },
      select: { id: true },
    });
    if (owned.length !== empIds.length) {
      throw new BadRequestException({
        code: 'EMPLOYEE_NOT_IN_FACILITY',
        message: '현재 시설 소속이 아닌 직원이 포함되어 있습니다.',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      // 동시성 가드: loadOwned로 상태를 확인한 시점과 이 트랜잭션 시작 사이에 다른 요청이
      // 마감(CLOSED)으로 전이시켰을 수 있다. status를 WHERE
      // 조건에 포함한 UPDATE는 DB 행 잠금 하에 원자적으로 검사되므로, 그 사이 상태가
      // 바뀌었다면 count=0으로 감지해 셀 쓰기 전에 즉시 중단한다.
      const guard = await tx.roster.updateMany({
        where: { id: roster.id, status: roster.status },
        data: { status: roster.status },
      });
      if (guard.count === 0) {
        throw new ConflictException({
          code: 'ROSTER_STATUS_CHANGED',
          message:
            '처리 중 근무표 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.',
        });
      }

      for (const n of normalized) {
        // TODO(D-21): 이미 지난 일자(달력 경과일) 변경은 결재 필요(사유 기재) — 결재 유형·결재선 확정 대기.
        // rosterId를 update에도 명시해, (직원, 날짜) 셀을 항상 이 근무표로 귀속시킨다(교차 근무표 오염 방지).
        const cell = {
          rosterId: roster.id,
          shiftTypeId: n.shiftTypeId,
          source: 'MANUAL' as const,
          isProvisional: false,
          overrideStartTime: n.overrideStartTime,
          overrideEndTime: n.overrideEndTime,
          // 수동 편집은 결재/대장 연동을 해제한다(관리자 의도적 덮어쓰기)
          sourceRequestId: null,
          sourceLedgerId: null,
        };
        await tx.scheduleEntry.upsert({
          where: {
            employeeId_workDate: {
              employeeId: n.employeeId,
              workDate: n.workDate,
            },
          },
          update: cell,
          create: {
            employeeId: n.employeeId,
            workDate: n.workDate,
            ...cell,
          },
        });
      }
    });

    this.logger.log(
      `근무표 셀 편집: roster ${roster.id}, ${entries.length}건, status=${roster.status}`,
    );
    return { id: roster.id.toString(), status: roster.status, violations: [] };
  }

  // ---------------------------------------------------------------
  // 프리셋 적용 — 직원별 근무 패턴 일괄 입력(§4.6/§4.8). DRAFT에서만 허용.
  // 승인 반영(APPROVAL)·수동 편집(MANUAL) 셀은 관리자 의도적 확정이므로 덮어쓰지 않고 건너뛴다
  // (DDL v1.3 schedule_entry 코멘트 — "승인 연차가 있는 셀은 프리셋이 덮어쓰지 않음").
  // ---------------------------------------------------------------
  async applyPreset(
    id: string,
    facilityId: string,
    dto: ApplyPresetDto,
  ): Promise<ApplyPresetResultDto> {
    const roster = await this.loadOwned(id, facilityId);
    if (roster.status === RosterStatus.CLOSED) {
      throw new ConflictException({
        code: 'ROSTER_CLOSED',
        message: '마감된 근무표는 직접 수정할 수 없습니다(마감취소 후 편집).',
      });
    }

    const presetId = this.parseId(dto.presetId);
    const preset = await this.prisma.shiftPatternPreset.findUnique({
      where: { id: presetId },
      include: { items: true },
    });
    if (!preset || preset.facilityId !== roster.facilityId) {
      throw new NotFoundException({
        code: 'PRESET_NOT_FOUND',
        message: '근무 패턴 프리셋을 찾을 수 없습니다.',
      });
    }
    if (dto.teamNo < 1 || dto.teamNo > preset.teamCount) {
      throw new BadRequestException({
        code: 'INVALID_TEAM_NO',
        message: `이 프리셋의 조 번호는 1~${preset.teamCount} 범위여야 합니다.`,
      });
    }

    const itemsByDay = new Map<number, bigint>(
      preset.items
        .filter((i) => i.teamNo === dto.teamNo)
        .map((i) => [i.dayIndex, i.shiftTypeId]),
    );
    const missingDays = Array.from(
      { length: preset.cycleDays },
      (_, i) => i + 1,
    ).filter((d) => !itemsByDay.has(d));
    if (missingDays.length > 0) {
      throw new ConflictException({
        code: 'PRESET_INCOMPLETE',
        message: `프리셋 ${dto.teamNo}조에 정의되지 않은 일차가 있습니다: ${missingDays.join(', ')}`,
      });
    }

    // 입력 날짜 검증(형식·달력·월범위 → 400). endDate 생략 시 근무표 월 말일까지.
    const daysInMonth = this.daysInMonth(roster.yearMonth);
    const startDate = this.parseWorkDate(
      dto.startDate,
      roster.yearMonth,
      daysInMonth,
    );
    const endDate = dto.endDate
      ? this.parseWorkDate(dto.endDate, roster.yearMonth, daysInMonth)
      : new Date(
          Date.UTC(
            startDate.getUTCFullYear(),
            startDate.getUTCMonth(),
            daysInMonth,
          ),
        );
    if (endDate.getTime() < startDate.getTime()) {
      throw new BadRequestException({
        code: 'INVALID_DATE_RANGE',
        message: 'endDate는 startDate보다 앞설 수 없습니다.',
      });
    }

    // 멀티테넌트 격리: 대상 직원이 모두 이 시설 소속인지 검증
    const employeeIds = [...new Set(dto.employeeIds)].map((s) =>
      this.parseId(s),
    );
    const owned = await this.prisma.employee.findMany({
      where: { id: { in: employeeIds }, facilityId: roster.facilityId },
      select: { id: true },
    });
    if (owned.length !== employeeIds.length) {
      throw new BadRequestException({
        code: 'EMPLOYEE_NOT_IN_FACILITY',
        message: '현재 시설 소속이 아닌 직원이 포함되어 있습니다.',
      });
    }

    const targetDates: Date[] = [];
    for (
      let d = new Date(startDate);
      d.getTime() <= endDate.getTime();
      d = this.addDays(d, 1)
    ) {
      targetDates.push(d);
    }

    const skipped: ApplyPresetSkipDto[] = [];
    let appliedCount = 0;

    await this.prisma.$transaction(async (tx) => {
      // 동시성 가드: 최초 상태 확인(loadOwned)과 이 트랜잭션 시작 사이에 다른 요청이
      // 마감(CLOSED)으로 전이시켰을 수 있다. status를 WHERE 조건에
      // 포함한 UPDATE는 DB 행 잠금 하에 원자적으로 검사되므로, 그 사이 상태가 바뀌었다면
      // count=0으로 감지해 셀 쓰기 전에 즉시 중단한다(그렇지 않으면 이미 마감된 근무표가
      // 프리셋으로 조용히 덮어써질 수 있다).
      const guard = await tx.roster.updateMany({
        where: { id: roster.id, status: roster.status },
        data: { status: roster.status },
      });
      if (guard.count === 0) {
        throw new ConflictException({
          code: 'ROSTER_STATUS_CHANGED',
          message:
            '처리 중 근무표 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.',
        });
      }

      for (const employeeId of employeeIds) {
        // 연속성 판정(§4.6 A-2): startDate 이전 최대 cycleDays일의 PRESET 셀을 역순으로 모은다.
        // 하루라도 비거나 PRESET이 아니면 그 시점에서 수집을 멈춘다(연속 구간만 근거로 인정).
        const lookbackFrom = this.addDays(startDate, -preset.cycleDays);
        const priorEntries = await tx.scheduleEntry.findMany({
          where: {
            employeeId,
            workDate: { gte: lookbackFrom, lt: startDate },
          },
          select: { workDate: true, shiftTypeId: true, source: true },
          orderBy: { workDate: 'desc' },
        });
        const priorByDate = new Map(
          priorEntries.map((e) => [this.toDateKey(e.workDate), e]),
        );
        const trailing: Array<{ shiftTypeId: bigint }> = [];
        for (let i = 1; i <= preset.cycleDays; i++) {
          const day = this.addDays(startDate, -i);
          const entry = priorByDate.get(this.toDateKey(day));
          if (!entry || entry.source !== 'PRESET') break;
          trailing.push({ shiftTypeId: entry.shiftTypeId });
        }
        const startDayIndex = this.resolveStartDayIndex(
          trailing,
          itemsByDay,
          preset.cycleDays,
        );

        // 대상 기간 기존 셀을 한 번에 조회해 보호 대상(APPROVAL/MANUAL) 여부를 미리 판단한다.
        const existingEntries = await tx.scheduleEntry.findMany({
          where: { employeeId, workDate: { gte: startDate, lte: endDate } },
          select: { workDate: true, source: true },
        });
        const existingByDate = new Map(
          existingEntries.map((e) => [this.toDateKey(e.workDate), e.source]),
        );

        for (const workDate of targetDates) {
          const offset = this.diffDays(workDate, startDate);
          const dayIndex =
            this.mod(offset + startDayIndex - 1, preset.cycleDays) + 1;
          const shiftTypeId = itemsByDay.get(dayIndex)!;

          const existingSource = existingByDate.get(this.toDateKey(workDate));
          if (existingSource === 'APPROVAL' || existingSource === 'MANUAL') {
            skipped.push({
              employeeId: employeeId.toString(),
              workDate: this.toDateKey(workDate),
              reason: 'PROTECTED_CELL',
            });
            continue;
          }

          const cell = {
            rosterId: roster.id,
            shiftTypeId,
            source: 'PRESET' as const,
            isProvisional: false,
            overrideStartTime: null,
            overrideEndTime: null,
            sourceRequestId: null,
            sourceLedgerId: null,
          };
          await tx.scheduleEntry.upsert({
            where: { employeeId_workDate: { employeeId, workDate } },
            update: cell,
            create: { employeeId, workDate, ...cell },
          });
          appliedCount++;
        }
      }

    });

    this.logger.log(
      `근무표 프리셋 적용: roster ${roster.id}, preset ${preset.id}, ` +
        `대상 ${employeeIds.length}명, 적용 ${appliedCount}건, 건너뜀 ${skipped.length}건`,
    );
    return { id: roster.id.toString(), appliedCount, skipped };
  }

  // ---------------------------------------------------------------
  // 마감 — DRAFT → CLOSED. 위반(BLOCK) 시 강행 사유 필수(D-19). 시설장·사무국장만(§1.3)
  // ---------------------------------------------------------------
  async close(
    id: string,
    facilityId: string,
    actorId: string,
    actorJobRole: JobRole,
    force: boolean,
    reason: string | undefined,
  ): Promise<RosterTransitionResultDto> {
    this.assertCloserRole(actorJobRole);
    const roster = await this.loadOwned(id, facilityId);
    this.assertStatus(roster, [RosterStatus.DRAFT]);

    const findings = await this.validate(roster);
    const blocking = findings.filter(
      (f) => f.severity === ValidationSeverity.BLOCK,
    );

    if (blocking.length > 0 && !force) {
      throw new ConflictException({
        code: 'ROSTER_HAS_VIOLATIONS',
        message: `고시 기준 위반 ${blocking.length}건이 있어 마감할 수 없습니다. 강행하려면 사유가 필요합니다.`,
        violations: blocking.map((f) => this.toFindingDto(f)),
      });
    }
    if (blocking.length > 0 && force && !reason?.trim()) {
      throw new BadRequestException({
        code: 'REASON_REQUIRED',
        message: '강행 마감 사유는 필수입니다.',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await this.snapshot(
        tx,
        roster.id,
        ValidationSnapshotStage.CLOSE,
        findings,
      );
      await tx.roster.update({
        where: { id: roster.id },
        data: {
          status: RosterStatus.CLOSED,
          closedBy: BigInt(actorId),
          closedAt: new Date(),
          forceClosed: blocking.length > 0,
          forceCloseReason: blocking.length > 0 ? reason!.trim() : null,
        },
      });
    });
    // TODO(스키마 갭): 근무자 공지 알림(§4.8) — notification roster 종류·FK 부재로 후속.
    this.logger.log(
      `근무표 마감: roster ${roster.id}, by ${actorId}, 강행=${blocking.length > 0}`,
    );
    return {
      id: roster.id.toString(),
      status: RosterStatus.CLOSED,
      violations: findings.map((f) => this.toFindingDto(f)),
    };
  }

  // ---------------------------------------------------------------
  // 마감취소 — CLOSED → DRAFT. 사유 불필요, 즉시 편집 가능 상태로 복귀. 시설장·사무국장만(§1.3)
  // ---------------------------------------------------------------
  async reopen(
    id: string,
    facilityId: string,
    actorJobRole: JobRole,
  ): Promise<RosterTransitionResultDto> {
    this.assertCloserRole(actorJobRole);
    const roster = await this.loadOwned(id, facilityId);
    this.assertStatus(roster, [RosterStatus.CLOSED]);

    await this.prisma.roster.update({
      where: { id: roster.id },
      data: {
        status: RosterStatus.DRAFT,
        closedBy: null,
        closedAt: null,
        forceClosed: false,
        forceCloseReason: null,
      },
    });
    this.logger.log(`근무표 마감취소: roster ${roster.id}`);
    return {
      id: roster.id.toString(),
      status: RosterStatus.DRAFT,
      violations: [],
    };
  }

  // ---------------------------------------------------------------
  // 검증(§4.5 일별 적정 인원). [주의] 현재는 daily_staffing_rule 미달을 BLOCK로 산정하는
  // 잠정 규칙셋이다. 고시 인력산정(§4.2)·야간/간호사 가산(§4.3) 규칙은 후속에서 확장한다.
  // ---------------------------------------------------------------
  private async validate(roster: Roster): Promise<Finding[]> {
    const [entries, rules] = await Promise.all([
      this.prisma.scheduleEntry.findMany({
        where: { rosterId: roster.id },
        select: {
          workDate: true,
          employee: { select: { jobRole: true } },
          shiftType: { select: { countsAsWork: true, crossesMidnight: true } },
        },
      }),
      this.prisma.dailyStaffingRule.findMany({
        where: { facilityId: roster.facilityId, teamId: null },
      }),
    ]);
    const dayMin = rules.find((r) => r.period === 'DAY')?.minCount ?? 0;
    const nightMin = rules.find((r) => r.period === 'NIGHT')?.minCount ?? 0;
    if (dayMin === 0 && nightMin === 0) return [];

    const daysInMonth = this.daysInMonth(roster.yearMonth);
    const day = new Map<string, number>();
    const night = new Map<string, number>();
    for (const e of entries) {
      if (!e.shiftType.countsAsWork || e.employee.jobRole !== 'CAREGIVER') {
        continue;
      }
      const key = e.workDate.toISOString().slice(0, 10);
      const bucket = e.shiftType.crossesMidnight ? night : day;
      bucket.set(key, (bucket.get(key) ?? 0) + 1);
    }

    const findings: Finding[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${roster.yearMonth}-${String(d).padStart(2, '0')}`;
      const dc = day.get(key) ?? 0;
      const nc = night.get(key) ?? 0;
      if (dayMin > 0 && dc < dayMin) {
        findings.push({
          ruleCode: 'MIN_STAFFING_DAY',
          severity: ValidationSeverity.BLOCK,
          detail: { date: key, period: 'DAY', actual: dc, required: dayMin },
        });
      }
      if (nightMin > 0 && nc < nightMin) {
        findings.push({
          ruleCode: 'MIN_STAFFING_NIGHT',
          severity: ValidationSeverity.BLOCK,
          detail: {
            date: key,
            period: 'NIGHT',
            actual: nc,
            required: nightMin,
          },
        });
      }
    }
    return findings;
  }

  // ---------------------------------------------------------------
  // 공통
  // ---------------------------------------------------------------

  /// 세션 시설 소유 근무표만 조회(타 시설 근무표는 404로 은닉)
  private async loadOwned(id: string, facilityId: string): Promise<Roster> {
    const rosterId = this.parseId(id);
    const roster = await this.prisma.roster.findUnique({
      where: { id: rosterId },
    });
    if (!roster || roster.facilityId !== this.parseId(facilityId)) {
      throw new NotFoundException({
        code: 'ROSTER_NOT_FOUND',
        message: '근무표를 찾을 수 없습니다.',
      });
    }
    return roster;
  }

  private assertStatus(roster: Roster, allowed: RosterStatus[]): void {
    if (!allowed.includes(roster.status)) {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        message: `현재 상태(${roster.status})에서 허용되지 않는 전이입니다.`,
      });
    }
  }

  /// 마감/마감취소는 roster:close 권한(ADMIN 이상)에 더해 시설장·사무국장만 수행할 수 있다(§1.3).
  /// system_role이 ADMIN 하나로 뭉뚱그려져 있어 job_role로 추가 차등한다(permissions.guard.ts 참고).
  private assertCloserRole(jobRole: JobRole): void {
    if (!CLOSER_JOB_ROLES.includes(jobRole)) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: '마감/마감취소는 시설장 또는 사무국장만 처리할 수 있습니다.',
      });
    }
  }

  private async snapshot(
    tx: Prisma.TransactionClient,
    rosterId: bigint,
    stage: ValidationSnapshotStage,
    findings: Finding[],
  ): Promise<void> {
    // 같은 단계의 이전 스냅샷은 최신으로 대체(재작성완료·재마감 대비)
    await tx.validationResult.deleteMany({
      where: { rosterId, snapshotStage: stage },
    });
    if (findings.length === 0) return;
    await tx.validationResult.createMany({
      data: findings.map((f) => ({
        rosterId,
        snapshotStage: stage,
        ruleCode: f.ruleCode,
        severity: f.severity,
        detail: f.detail as Prisma.InputJsonValue,
      })),
    });
  }

  private async shiftCodeMap(facilityId: bigint): Promise<Map<string, bigint>> {
    const rows = await this.prisma.shiftType.findMany({
      where: { facilityId },
      select: { id: true, code: true },
    });
    return new Map(rows.map((r) => [r.code, r.id]));
  }

  private toFindingDto(f: Finding): ValidationFindingDto {
    return { ruleCode: f.ruleCode, severity: f.severity, detail: f.detail };
  }

  private daysInMonth(yearMonth: string): number {
    const [y, m] = yearMonth.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }

  /// YYYY-MM-DD → 실제 달력 날짜 검증 + 해당 근무표 월 범위 검증(§4.8). @db.Date와 정합하도록 UTC 자정.
  private parseWorkDate(
    dateStr: string,
    yearMonth: string,
    daysInMonth: number,
  ): Date {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const isRealDate =
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === d;
    if (!isRealDate || d < 1 || d > daysInMonth) {
      throw new BadRequestException({
        code: 'INVALID_DATE',
        message: `유효하지 않은 날짜입니다: ${dateStr}`,
      });
    }
    if (dateStr.slice(0, 7) !== yearMonth) {
      throw new BadRequestException({
        code: 'DATE_OUT_OF_MONTH',
        message: `근무표(${yearMonth}) 범위를 벗어난 날짜입니다: ${dateStr}`,
      });
    }
    return dt;
  }

  private toTime(hhmm: string | undefined): Date | null {
    return hhmm ? new Date(`1970-01-01T${hhmm}:00Z`) : null;
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

  /// 연속성 판정(§4.6 A-2): trailing[0]=startDate 바로 전날 … 역순 근거로 startDate의 dayIndex를
  /// 역산한다. 후보 dayIndex가 정확히 하나로 좁혀질 때만 이어붙이고, 없거나 모호하면(동일 근무유형
  /// 반복 등으로 여러 후보가 남는 경우) startDate를 1일차로 하는 새 앵커로 취급한다.
  private resolveStartDayIndex(
    trailing: Array<{ shiftTypeId: bigint }>,
    itemsByDay: Map<number, bigint>,
    cycleDays: number,
  ): number {
    if (trailing.length === 0) return 1;
    const candidates: number[] = [];
    for (let candidate = 1; candidate <= cycleDays; candidate++) {
      let ok = true;
      for (let i = 0; i < trailing.length; i++) {
        const dayIndex = this.mod(candidate - 1 - i, cycleDays) + 1;
        if (itemsByDay.get(dayIndex) !== trailing[i].shiftTypeId) {
          ok = false;
          break;
        }
      }
      if (ok) candidates.push(candidate);
    }
    if (candidates.length !== 1) return 1;
    // candidates[0] = 전날의 dayIndex → startDate는 그다음 일차
    return this.mod(candidates[0], cycleDays) + 1;
  }

  private addDays(d: Date, days: number): Date {
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days),
    );
  }

  private diffDays(a: Date, b: Date): number {
    return Math.round((a.getTime() - b.getTime()) / 86_400_000);
  }

  private mod(n: number, m: number): number {
    return ((n % m) + m) % m;
  }

  private toDateKey(d: Date): string {
    return d.toISOString().slice(0, 10);
  }
}
