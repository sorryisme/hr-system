import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  Roster,
  RosterStatus,
  ValidationSeverity,
  ValidationSnapshotStage,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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

/// 근무표 상태머신(§4.8) + 검증(§4.5)·마감 처리(D-19).
///   DRAFT ─작성완료→ COMPLETED ─마감상신→ CLOSING_APPROVAL ─승인→ CLOSED
///                     └─셀수정→ DRAFT        └─반려→ DRAFT
/// 권한: 편집/작성완료/마감상신=roster:write, 마감승인/반려=roster:close(컨트롤러에서 부여).
/// [결정 대기] job_role 세부 차등(작성=사회복지사 / 마감=사무국장·시설장 §1.3), D-21(지난 일자 변경 결재).
@Injectable()
export class RosterStateService {
  private readonly logger = new Logger(RosterStateService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------
  // 셀 편집 — 드래그 다건 입력. COMPLETED에서 수정 시 DRAFT로 복귀(§4.8)
  // ---------------------------------------------------------------
  async updateEntries(
    id: string,
    facilityId: string,
    entries: RosterEntryInputDto[],
  ): Promise<RosterTransitionResultDto> {
    const roster = await this.loadOwned(id, facilityId);
    // 편집은 DRAFT/COMPLETED에서만 허용(§4.8). CLOSED=결재 경유만, CLOSING_APPROVAL=승인 중 불변.
    if (roster.status === RosterStatus.CLOSED) {
      throw new ConflictException({
        code: 'ROSTER_CLOSED',
        message: '마감된 근무표는 직접 수정할 수 없습니다(결재 경유만 가능).',
      });
    }
    if (roster.status === RosterStatus.CLOSING_APPROVAL) {
      throw new ConflictException({
        code: 'ROSTER_UNDER_APPROVAL',
        message:
          '마감 승인 중인 근무표는 수정할 수 없습니다(상신 취소·반려 후 편집).',
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
      // COMPLETED → 셀 수정 시 DRAFT 복귀(§4.8 전이표)
      if (roster.status === RosterStatus.COMPLETED) {
        await tx.roster.update({
          where: { id: roster.id },
          data: { status: RosterStatus.DRAFT },
        });
      }
    });

    const status =
      roster.status === RosterStatus.COMPLETED
        ? RosterStatus.DRAFT
        : roster.status;
    this.logger.log(
      `근무표 셀 편집: roster ${roster.id}, ${entries.length}건, status=${status}`,
    );
    return { id: roster.id.toString(), status, violations: [] };
  }

  // ---------------------------------------------------------------
  // 작성 완료 — DRAFT → COMPLETED. 검증 스냅샷(§4.8)
  // ---------------------------------------------------------------
  async complete(
    id: string,
    facilityId: string,
  ): Promise<RosterTransitionResultDto> {
    const roster = await this.loadOwned(id, facilityId);
    this.assertStatus(roster, [RosterStatus.DRAFT]);

    const findings = await this.validate(roster);
    await this.prisma.$transaction(async (tx) => {
      await this.snapshot(
        tx,
        roster.id,
        ValidationSnapshotStage.COMPLETED,
        findings,
      );
      await tx.roster.update({
        where: { id: roster.id },
        data: { status: RosterStatus.COMPLETED },
      });
    });

    this.logger.log(
      `근무표 작성완료: roster ${roster.id}, 위반 ${findings.length}건`,
    );
    return {
      id: roster.id.toString(),
      status: RosterStatus.COMPLETED,
      violations: findings.map((f) => this.toFindingDto(f)),
    };
  }

  // ---------------------------------------------------------------
  // 마감 상신 — COMPLETED → CLOSING_APPROVAL
  // ---------------------------------------------------------------
  async submitClose(
    id: string,
    facilityId: string,
    actorId: string,
  ): Promise<RosterTransitionResultDto> {
    const roster = await this.loadOwned(id, facilityId);
    this.assertStatus(roster, [RosterStatus.COMPLETED]);

    await this.prisma.roster.update({
      where: { id: roster.id },
      data: {
        status: RosterStatus.CLOSING_APPROVAL,
        submittedBy: BigInt(actorId),
        submittedAt: new Date(),
      },
    });
    // TODO(스키마 갭): 마감 결재자(사무국장/시설장) 알림 — notification에 roster 종류·FK가 없어 후속.
    this.logger.log(`근무표 마감 상신: roster ${roster.id}, by ${actorId}`);
    return {
      id: roster.id.toString(),
      status: RosterStatus.CLOSING_APPROVAL,
      violations: [],
    };
  }

  // ---------------------------------------------------------------
  // 마감 승인 — CLOSING_APPROVAL → CLOSED. 위반(BLOCK) 시 강행 사유 필수(D-19)
  // ---------------------------------------------------------------
  async close(
    id: string,
    facilityId: string,
    actorId: string,
    force: boolean,
    reason: string | undefined,
  ): Promise<RosterTransitionResultDto> {
    const roster = await this.loadOwned(id, facilityId);
    this.assertStatus(roster, [RosterStatus.CLOSING_APPROVAL]);

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
  // 마감 반려 — CLOSING_APPROVAL → DRAFT (사유 필수)
  // ---------------------------------------------------------------
  async rejectClose(
    id: string,
    facilityId: string,
    actorId: string,
    reason: string,
  ): Promise<RosterTransitionResultDto> {
    const roster = await this.loadOwned(id, facilityId);
    this.assertStatus(roster, [RosterStatus.CLOSING_APPROVAL]);

    await this.prisma.roster.update({
      where: { id: roster.id },
      data: {
        status: RosterStatus.DRAFT,
        submittedBy: null,
        submittedAt: null,
      },
    });
    // TODO(스키마 갭): 반려 사유 저장 + 사회복지사 알림 — roster에 반려사유 컬럼/알림 종류 부재로 후속(로그만).
    this.logger.log(
      `근무표 마감 반려: roster ${roster.id}, by ${actorId}, 사유="${reason.trim()}"`,
    );
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
}
