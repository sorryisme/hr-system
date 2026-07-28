import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  ApprovalRequestType,
  Prisma,
  ScheduleEntrySource,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventBus } from '../events/domain-event-bus';
import {
  ApprovalReflectionPayload,
  ApprovalRevertPayload,
  REQUEST_APPROVED,
  REQUEST_REVERTED,
  REQUEST_STEP_APPROVED,
} from '../events/domain-events';

/// 결재 승인 이벤트 → 근무표 셀 반영(§4.10).
///   REQUEST_STEP_APPROVED(1차) → 가반영: is_provisional=true(글자만)
///   REQUEST_APPROVED(최종)     → 확정 반영: is_provisional=false(셀 색칠)
///   REQUEST_REVERTED(반려/취소)→ 원복: sourceRequestId가 일치하는 셀만 복원(또는 삭제)
/// 결재 유형별 근무유형 매핑은 §4.7. 반영/원복 실패는 로그만 남기고 결재 결과(이미 커밋됨)에 영향 주지 않는다.
/// 여러 대상일을 한 트랜잭션으로 묶어, 중간에 실패해도 일부 날짜만 반영/원복되는 상태를 막는다.

/// 결재가 셀을 최초로 덮어쓰기 직전 상태의 스냅샷(§4.10 원복). BigInt/Date는 JSON에 담을 수
/// 없어 문자열로 직렬화한다. 원복 시 이 값으로 복원하고 컬럼을 다시 NULL로 비운다.
interface CellSnapshot {
  shiftTypeId: string;
  source: ScheduleEntrySource;
  isProvisional: boolean;
  overrideStartTime: string | null;
  overrideEndTime: string | null;
  sourceRequestId: string | null;
  sourceLedgerId: string | null;
}

@Injectable()
export class RosterReflectionService implements OnModuleInit {
  private readonly logger = new Logger(RosterReflectionService.name);

  /// 결재 유형 → shift_type.code(§4.7). SHIFT_CHANGE는 desiredShiftId를 그대로 쓰고,
  /// CANCEL은 셀 반영 대상이 아니다.
  private static readonly TYPE_TO_CODE: Partial<
    Record<ApprovalRequestType, string>
  > = {
    ANNUAL: 'AL',
    HALF_AM: 'HAM',
    HALF_PM: 'HPM',
    SUBSTITUTE_HOLIDAY: 'SUB',
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: DomainEventBus,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe<ApprovalReflectionPayload>(REQUEST_STEP_APPROVED, (p) =>
      this.reflect(p, true),
    );
    this.bus.subscribe<ApprovalReflectionPayload>(REQUEST_APPROVED, (p) =>
      this.reflect(p, false),
    );
    this.bus.subscribe<ApprovalRevertPayload>(REQUEST_REVERTED, (p) =>
      this.revert(p),
    );
  }

  private async reflect(
    payload: ApprovalReflectionPayload,
    provisional: boolean,
  ): Promise<void> {
    try {
      if (payload.type === ApprovalRequestType.CANCEL) return;

      const shiftTypeId = await this.resolveShiftTypeId(payload);
      if (!shiftTypeId) {
        this.logger.warn(
          `반영 스킵: 근무유형 매핑 없음 (req ${payload.requestId}, type ${payload.type})`,
        );
        return;
      }

      const isShiftChange = payload.type === ApprovalRequestType.SHIFT_CHANGE;
      const overrideStartTime = isShiftChange ? payload.desiredStartTime : null;
      const overrideEndTime = isShiftChange ? payload.desiredEndTime : null;

      let reflected = 0;
      await this.prisma.$transaction(async (tx) => {
        for (const dateStr of payload.targetDates) {
          const yearMonth = dateStr.slice(0, 7);
          const roster = await tx.roster.findUnique({
            where: {
              facilityId_yearMonth: {
                facilityId: payload.facilityId,
                yearMonth,
              },
            },
            select: { id: true },
          });
          if (!roster) {
            // 해당 월 근무표가 아직 없으면 셀을 놓을 곳이 없다 — 관리자가 근무표 생성 후 수기 반영(§2.3 과도기)
            this.logger.warn(
              `반영 스킵: ${yearMonth} 근무표 없음 (req ${payload.requestId})`,
            );
            continue;
          }

          const workDate = new Date(dateStr);
          const existing = await tx.scheduleEntry.findUnique({
            where: {
              employeeId_workDate: {
                employeeId: payload.requesterId,
                workDate,
              },
            },
          });

          if (existing) {
            // 같은 요청이 이미 한 번 덮어쓴 셀(가반영→확정 전환)이면 스냅샷을 다시 찍지 않는다 —
            // 그렇지 않으면 원래 수동/프리셋 상태가 아니라 가반영 상태가 "원본"으로 굳어버린다.
            const isFirstTouch = existing.sourceRequestId !== payload.requestId;
            await tx.scheduleEntry.update({
              where: { id: existing.id },
              data: {
                shiftTypeId,
                source: 'APPROVAL',
                isProvisional: provisional,
                sourceRequestId: payload.requestId,
                overrideStartTime,
                overrideEndTime,
                ...(isFirstTouch
                  ? {
                      preApprovalSnapshot: this.toSnapshot(
                        existing,
                      ) as unknown as Prisma.InputJsonValue,
                    }
                  : {}),
              },
            });
          } else {
            await tx.scheduleEntry.create({
              data: {
                rosterId: roster.id,
                employeeId: payload.requesterId,
                workDate,
                shiftTypeId,
                source: 'APPROVAL',
                isProvisional: provisional,
                sourceRequestId: payload.requestId,
                overrideStartTime,
                overrideEndTime,
              },
            });
          }
          reflected += 1;
        }
      });

      this.logger.log(
        `근무표 반영 완료 (req ${payload.requestId}, ${provisional ? '가반영' : '확정'}, ${reflected}/${payload.targetDates.length}일)`,
      );
    } catch (err) {
      this.logger.error(
        `근무표 반영 실패 (req ${payload.requestId})`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /// 반려·취소로 무효화된 신청 건이 만든 셀을 원복한다. sourceRequestId가 이 requestId와
  /// 일치하는 셀만 대상으로 삼아, 그 사이 수동 편집이나 다른 결재 건이 덮어쓴 셀은 건드리지
  /// 않는다. 스냅샷이 있으면(가반영이 기존 수동/프리셋 셀을 덮어쓴 경우) 그 상태로 복원하고,
  /// 없으면(애초에 셀이 없었던 경우) 셀 자체를 삭제한다. 대상일 전체를 한 트랜잭션으로 묶어
  /// 일부 날짜만 원복된 채로 끝나지 않게 한다.
  private async revert(payload: ApprovalRevertPayload): Promise<void> {
    try {
      let reverted = 0;
      await this.prisma.$transaction(async (tx) => {
        for (const dateStr of payload.targetDates) {
          const workDate = new Date(dateStr);
          const entry = await tx.scheduleEntry.findUnique({
            where: {
              employeeId_workDate: {
                employeeId: payload.requesterId,
                workDate,
              },
            },
          });
          if (!entry || entry.sourceRequestId !== payload.requestId) {
            continue;
          }

          const snapshot = this.parseSnapshot(entry.preApprovalSnapshot);
          if (!snapshot) {
            await tx.scheduleEntry.delete({ where: { id: entry.id } });
          } else {
            await tx.scheduleEntry.update({
              where: { id: entry.id },
              data: {
                shiftTypeId: BigInt(snapshot.shiftTypeId),
                source: snapshot.source,
                isProvisional: snapshot.isProvisional,
                overrideStartTime: snapshot.overrideStartTime
                  ? new Date(snapshot.overrideStartTime)
                  : null,
                overrideEndTime: snapshot.overrideEndTime
                  ? new Date(snapshot.overrideEndTime)
                  : null,
                sourceRequestId: snapshot.sourceRequestId
                  ? BigInt(snapshot.sourceRequestId)
                  : null,
                sourceLedgerId: snapshot.sourceLedgerId
                  ? BigInt(snapshot.sourceLedgerId)
                  : null,
                preApprovalSnapshot: Prisma.DbNull,
              },
            });
          }
          reverted += 1;
        }
      });

      this.logger.log(
        `근무표 원복 완료 (req ${payload.requestId}, ${reverted}/${payload.targetDates.length}일 처리)`,
      );
    } catch (err) {
      this.logger.error(
        `근무표 원복 실패 (req ${payload.requestId})`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  private toSnapshot(entry: {
    shiftTypeId: bigint;
    source: ScheduleEntrySource;
    isProvisional: boolean;
    overrideStartTime: Date | null;
    overrideEndTime: Date | null;
    sourceRequestId: bigint | null;
    sourceLedgerId: bigint | null;
  }): CellSnapshot {
    return {
      shiftTypeId: entry.shiftTypeId.toString(),
      source: entry.source,
      isProvisional: entry.isProvisional,
      overrideStartTime: entry.overrideStartTime?.toISOString() ?? null,
      overrideEndTime: entry.overrideEndTime?.toISOString() ?? null,
      sourceRequestId: entry.sourceRequestId?.toString() ?? null,
      sourceLedgerId: entry.sourceLedgerId?.toString() ?? null,
    };
  }

  /// 스냅샷 JSON을 방어적으로 파싱한다. 모양이 기대와 다르면(과거 데이터·수동 조작 등) 복원을
  /// 포기하고 null을 돌려줘 호출부가 삭제 경로로 넘어가게 한다 — 잘못된 값으로 셀을 복원하는
  /// 것보다 안전하다.
  private parseSnapshot(value: Prisma.JsonValue): CellSnapshot | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const { shiftTypeId, source, isProvisional } = value;
    if (
      typeof shiftTypeId !== 'string' ||
      typeof source !== 'string' ||
      typeof isProvisional !== 'boolean'
    ) {
      return null;
    }
    const overrideStartTime = value.overrideStartTime;
    const overrideEndTime = value.overrideEndTime;
    const sourceRequestId = value.sourceRequestId;
    const sourceLedgerId = value.sourceLedgerId;
    return {
      shiftTypeId,
      source: source as ScheduleEntrySource,
      isProvisional,
      overrideStartTime:
        typeof overrideStartTime === 'string' ? overrideStartTime : null,
      overrideEndTime:
        typeof overrideEndTime === 'string' ? overrideEndTime : null,
      sourceRequestId:
        typeof sourceRequestId === 'string' ? sourceRequestId : null,
      sourceLedgerId:
        typeof sourceLedgerId === 'string' ? sourceLedgerId : null,
    };
  }

  private async resolveShiftTypeId(
    payload: ApprovalReflectionPayload,
  ): Promise<bigint | null> {
    if (payload.type === ApprovalRequestType.SHIFT_CHANGE) {
      return payload.desiredShiftId;
    }
    const code = RosterReflectionService.TYPE_TO_CODE[payload.type];
    if (!code) return null;
    const shiftType = await this.prisma.shiftType.findUnique({
      where: { facilityId_code: { facilityId: payload.facilityId, code } },
      select: { id: true },
    });
    return shiftType?.id ?? null;
  }
}
