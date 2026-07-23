import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ApprovalRequestType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventBus } from '../events/domain-event-bus';
import {
  ApprovalReflectionPayload,
  REQUEST_APPROVED,
  REQUEST_STEP_APPROVED,
} from '../events/domain-events';

/// 결재 승인 이벤트 → 근무표 셀 반영(§4.10).
///   REQUEST_STEP_APPROVED(1차) → 가반영: is_provisional=true(글자만)
///   REQUEST_APPROVED(최종)     → 확정 반영: is_provisional=false(셀 색칠)
/// 결재 유형별 근무유형 매핑은 §4.7. 반영 실패는 로그만 남기고 결재 결과(이미 커밋됨)에 영향 주지 않는다.
@Injectable()
export class RosterReflectionService implements OnModuleInit {
  private readonly logger = new Logger(RosterReflectionService.name);

  /// 결재 유형 → shift_type.code(§4.7). SHIFT_CHANGE는 desiredShiftId를 그대로 쓰고,
  /// CANCEL은 셀 반영 대상이 아니다(원건 취소 시 셀 원복은 후속 — TODO).
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
    this.bus.subscribe(REQUEST_STEP_APPROVED, (p) => this.reflect(p, true));
    this.bus.subscribe(REQUEST_APPROVED, (p) => this.reflect(p, false));
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

      for (const dateStr of payload.targetDates) {
        const yearMonth = dateStr.slice(0, 7);
        const roster = await this.prisma.roster.findUnique({
          where: {
            facilityId_yearMonth: { facilityId: payload.facilityId, yearMonth },
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
        await this.prisma.scheduleEntry.upsert({
          where: {
            employeeId_workDate: {
              employeeId: payload.requesterId,
              workDate,
            },
          },
          update: {
            shiftTypeId,
            source: 'APPROVAL',
            isProvisional: provisional,
            sourceRequestId: payload.requestId,
            overrideStartTime,
            overrideEndTime,
          },
          create: {
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
      this.logger.log(
        `근무표 반영 완료 (req ${payload.requestId}, ${provisional ? '가반영' : '확정'}, ${payload.targetDates.length}일)`,
      );
    } catch (err) {
      this.logger.error(
        `근무표 반영 실패 (req ${payload.requestId})`,
        err instanceof Error ? err.stack : String(err),
      );
    }
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
