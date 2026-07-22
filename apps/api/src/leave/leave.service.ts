import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ApprovalAction,
  ApprovalRequestStatus,
  ApprovalRequestType,
  JobRole,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CancelLeaveRequestResponseDto,
  CancelResult,
} from './dto/cancel-leave-request-response.dto';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import {
  LeaveBalanceDetailDto,
  LeaveBalanceResponseDto,
} from './dto/leave-balance.dto';
import { MyLeaveRequestDto } from './dto/my-leave-request.dto';

const LEAVE_TYPES: ApprovalRequestType[] = [
  ApprovalRequestType.ANNUAL,
  ApprovalRequestType.HALF_AM,
  ApprovalRequestType.HALF_PM,
  ApprovalRequestType.SUBSTITUTE_HOLIDAY,
];

/// 취소는 아직 전이 로직이 없다(D-2 이중신청 방지 범위 밖) — 목록에서 제외
const EXCLUDED_STATUSES: ApprovalRequestStatus[] = [
  ApprovalRequestStatus.CANCELED,
  ApprovalRequestStatus.CANCELED_AFTER_APPROVAL,
];

/// 진행 중(대기·1차 이상 승인) — 제출 시 이중신청 차단(D-2)과 취소 가능 여부 판단에 공용으로 쓰인다
const OPEN_STATUSES: ApprovalRequestStatus[] = [
  ApprovalRequestStatus.PENDING,
  ApprovalRequestStatus.INTERIM_APPROVED,
];

const ZERO_DETAIL: LeaveBalanceDetailDto = {
  granted: '0.0',
  used: '0.0',
  reserved: '0.0',
  remaining: '0.0',
};

const APPROVER_ROLE_TO_JOB_ROLE: Record<string, JobRole> = {
  SOCIAL_WORKER: JobRole.SOCIAL_WORKER,
  OFFICE_MANAGER: JobRole.OFFICE_MANAGER,
  DIRECTOR: JobRole.DIRECTOR,
};

type BalanceRow = {
  granted: { toString(): string };
  used: { toString(): string };
  reserved: { toString(): string };
  remaining: { toString(): string };
};

type RequestRow = Prisma.ApprovalRequestGetPayload<{
  include: { targetDates: true };
}>;

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

@Injectable()
export class LeaveService {
  constructor(private readonly prisma: PrismaService) {}

  /// balanceYear 기본값은 현재 연도. §3.5 원칙(입사일 기준 연차연도)은 Phase 1 잔여 관리
  /// 본작업에서 반영 — 시드 데이터도 현재 이 단순화(달력 연도)로 채워져 있다(seed.ts 참고).
  async getBalance(
    employeeId: bigint,
    balanceYear = new Date().getFullYear(),
  ): Promise<LeaveBalanceResponseDto> {
    const [annual, substitute] = await Promise.all([
      this.prisma.leaveBalance.findUnique({
        where: { employeeId_balanceYear: { employeeId, balanceYear } },
      }),
      this.prisma.substituteHolidayBalance.findUnique({
        where: { employeeId_balanceYear: { employeeId, balanceYear } },
      }),
    ]);

    return {
      balanceYear,
      annual: annual ? this.toDetail(annual) : { ...ZERO_DETAIL },
      substituteHoliday: substitute ? this.toDetail(substitute) : { ...ZERO_DETAIL },
    };
  }

  async getMyRequests(employeeId: bigint): Promise<MyLeaveRequestDto[]> {
    const rows = await this.prisma.approvalRequest.findMany({
      where: {
        requesterId: employeeId,
        type: { in: LEAVE_TYPES },
        status: { notIn: EXCLUDED_STATUSES },
      },
      include: { targetDates: { orderBy: { targetDate: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });

    const pendingCancellationIds = await this.findPendingCancellationRefIds(
      this.prisma,
      rows.map((row) => row.id),
    );

    return rows.map((row) =>
      this.toMyRequest(row, pendingCancellationIds.has(row.id)),
    );
  }

  /// 신청 생성(SUBMIT) + 결재선 스냅샷 + 잔여 reserved 가산(D-2 이중신청 차단 포함).
  /// 자기결재 회피(D-6)는 별도 재배정 없이 기존 approve() 로직(대결자·상위 결재자 허용)이 그대로 처리한다.
  async submitRequest(
    employeeId: bigint,
    facilityId: bigint,
    dto: CreateLeaveRequestDto,
  ): Promise<MyLeaveRequestDto> {
    if (dto.idempotencyKey) {
      const existing = await this.prisma.approvalRequest.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
        include: { targetDates: { orderBy: { targetDate: 'asc' } } },
      });
      if (existing) {
        const pending = await this.findPendingCancellationRefIds(this.prisma, [existing.id]);
        return this.toMyRequest(existing, pending.has(existing.id));
      }
    }

    const targetDates = [...new Set(dto.targetDates)].sort();
    if (
      dto.type !== ApprovalRequestType.ANNUAL &&
      targetDates.length > 1
    ) {
      throw new BadRequestException({
        code: 'SINGLE_DATE_ONLY',
        message: '하루만 선택할 수 있어요.',
      });
    }

    const dateObjs = targetDates.map((d) => new Date(`${d}T00:00:00.000Z`));
    const today = startOfUtcDay(new Date());
    const isRetroactive = dateObjs.some((d) => d < today);
    const leaveDays =
      dto.type === ApprovalRequestType.ANNUAL
        ? targetDates.length.toFixed(1)
        : dto.type === ApprovalRequestType.SUBSTITUTE_HOLIDAY
          ? '1.0'
          : '0.5';
    const balanceYear = dateObjs[0].getUTCFullYear();

    return this.prisma.$transaction(async (tx) => {
      await this.assertNoOverlap(tx, employeeId, dateObjs);
      const requestLines = await this.resolveRequestLines(tx, facilityId);

      const created = await tx.approvalRequest.create({
        data: {
          facilityId,
          requesterId: employeeId,
          type: dto.type,
          reason: dto.reason ?? null,
          leaveDays,
          isRetroactive,
          idempotencyKey: dto.idempotencyKey,
          targetDates: { create: dateObjs.map((targetDate) => ({ targetDate })) },
          requestLines: { create: requestLines },
          histories: {
            create: [{ actorId: employeeId, action: ApprovalAction.SUBMIT }],
          },
        },
        include: { targetDates: { orderBy: { targetDate: 'asc' } } },
      });

      const balanceWhere = {
        employeeId_balanceYear: { employeeId, balanceYear },
      };
      if (dto.type === ApprovalRequestType.SUBSTITUTE_HOLIDAY) {
        await tx.substituteHolidayBalance.upsert({
          where: balanceWhere,
          update: { reserved: { increment: leaveDays } },
          create: { employeeId, balanceYear, granted: '0.0', used: '0.0', reserved: leaveDays },
        });
      } else {
        await tx.leaveBalance.upsert({
          where: balanceWhere,
          update: { reserved: { increment: leaveDays } },
          create: { employeeId, balanceYear, granted: '0.0', used: '0.0', reserved: leaveDays },
        });
      }

      return this.toMyRequest(created, false);
    });
  }

  /// 본인 신청 취소.
  /// - PENDING(아무도 승인 안 함): 즉시 취소 — 기존과 동일.
  /// - INTERIM_APPROVED(1차 이상 승인 완료): 즉시 취소하지 않고 관리자 승인이 필요한
  ///   별도 취소 요청(type=CANCEL, refRequestId=이 건)을 만든다. 원건은 그대로 두고
  ///   (reserved 유지) 취소 요청이 승인되면 그때 원건을 CANCELED로 전환한다
  ///   (approvals.service.ts applyCancellation). 취소 요청이 진행 중인 동안 원건 자체의
  ///   승인 진행은 approvals.service.ts의 결재 가드가 차단한다.
  /// - APPROVED 이후 취소(CANCELED_AFTER_APPROVAL)는 범위 밖 — 그대로 거부.
  async cancelRequest(
    employeeId: bigint,
    id: string,
  ): Promise<CancelLeaveRequestResponseDto> {
    const requestId = this.parseId(id);

    const result = await this.prisma.$transaction(
      async (tx): Promise<CancelResult> => {
        const req = await tx.approvalRequest.findUnique({
          where: { id: requestId },
          include: { targetDates: true },
        });
        if (!req || req.requesterId !== employeeId) {
          throw new NotFoundException({
            code: 'NOT_FOUND',
            message: '신청 건을 찾을 수 없습니다.',
          });
        }
        if (!OPEN_STATUSES.includes(req.status)) {
          throw this.conflict();
        }

        if (req.status === ApprovalRequestStatus.INTERIM_APPROVED) {
          await this.createCancellationRequest(tx, req);
          return 'CANCELLATION_REQUESTED';
        }

        // PENDING — 즉시 취소(낙관적 가드: 동시에 결재자가 처리 중일 수 있음)
        const updated = await tx.approvalRequest.updateMany({
          where: { id: requestId, status: req.status },
          data: {
            status: ApprovalRequestStatus.CANCELED,
            finalizedAt: new Date(),
          },
        });
        if (updated.count === 0) {
          throw this.conflict();
        }

        await tx.approvalHistory.create({
          data: { requestId, actorId: employeeId, action: ApprovalAction.CANCEL },
        });

        if (req.leaveDays !== null) {
          const firstDate = req.targetDates[0]?.targetDate ?? req.createdAt;
          const balanceYear = firstDate.getUTCFullYear();
          const where = { employeeId_balanceYear: { employeeId, balanceYear } };
          if (req.type === ApprovalRequestType.SUBSTITUTE_HOLIDAY) {
            await tx.substituteHolidayBalance.update({
              where,
              data: { reserved: { decrement: req.leaveDays } },
            });
          } else {
            await tx.leaveBalance.update({
              where,
              data: { reserved: { decrement: req.leaveDays } },
            });
          }
        }
        return 'CANCELED';
      },
    );

    return { result };
  }

  // ---------------------------------------------------------------
  // 내부 유틸
  // ---------------------------------------------------------------

  /// D-2 이중신청 차단: 본인의 진행 중·승인 완료 건과 날짜가 겹치면 거부
  private async assertNoOverlap(
    tx: Prisma.TransactionClient,
    employeeId: bigint,
    dateObjs: Date[],
  ): Promise<void> {
    const clash = await tx.approvalRequestDate.findFirst({
      where: {
        targetDate: { in: dateObjs },
        request: {
          requesterId: employeeId,
          type: { in: LEAVE_TYPES },
          status: { in: [...OPEN_STATUSES, ApprovalRequestStatus.APPROVED] },
        },
      },
    });
    if (clash) {
      throw new ConflictException({
        code: 'DOUBLE_BOOKING',
        message: '이미 신청한 날짜가 있어요.',
      });
    }
  }

  /// 제출 시점 결재선 스냅샷(§3.5 엣지 12). 역할 지정 라인은 현재 재직자로 해석해 고정한다.
  /// 자기결재 회피는 재배정하지 않고 그대로 스냅샷한다 — approve() 쪽의 대결자/상위 결재자
  /// 허용 로직이 이미 처리한다(D-6, approvals.service.ts resolveCurrentStep 참고).
  private async resolveRequestLines(
    tx: Prisma.TransactionClient,
    facilityId: bigint,
  ): Promise<
    { stepNo: number; approverId: bigint; deputyId: bigint | null; delegationEnabled: boolean }[]
  > {
    const today = startOfUtcDay(new Date());
    const lines = await tx.approvalLine.findMany({
      where: {
        facilityId,
        effectiveFrom: { lte: today },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
      },
      orderBy: { stepNo: 'asc' },
    });
    if (lines.length === 0) {
      throw new BadRequestException({
        code: 'APPROVAL_LINE_NOT_CONFIGURED',
        message: '결재선이 설정되어 있지 않습니다.',
      });
    }

    const result: {
      stepNo: number;
      approverId: bigint;
      deputyId: bigint | null;
      delegationEnabled: boolean;
    }[] = [];
    for (const line of lines) {
      let approverId = line.approverId;
      if (!approverId && line.approverRole) {
        // 동일 역할 재직자가 여럿이면 가장 먼저 등록된 사람을 결재자로 삼는다(현재 시설당 역할별 1인 가정)
        const holder = await tx.employee.findFirst({
          where: {
            facilityId,
            jobRole: APPROVER_ROLE_TO_JOB_ROLE[line.approverRole],
            status: 'ACTIVE',
          },
          orderBy: { id: 'asc' },
          select: { id: true },
        });
        approverId = holder?.id ?? null;
      }
      if (!approverId) {
        throw new BadRequestException({
          code: 'APPROVER_NOT_FOUND',
          message: `${line.stepNo}단계 결재자를 찾을 수 없습니다.`,
        });
      }
      result.push({
        stepNo: line.stepNo,
        approverId,
        deputyId: line.deputyId,
        delegationEnabled: line.delegationEnabled,
      });
    }
    return result;
  }

  private toDetail(row: BalanceRow): LeaveBalanceDetailDto {
    return {
      granted: row.granted.toString(),
      used: row.used.toString(),
      reserved: row.reserved.toString(),
      remaining: row.remaining.toString(),
    };
  }

  /// 취소 요청(type=CANCEL) 생성. resolveRequestLines를 그대로 재사용하고, 원건의 대상일을
  /// 그대로 복사해 관리자 결재함에서 무엇을 취소하려는지 바로 보이게 한다.
  /// 이미 진행 중인 취소 요청이 있으면 중복 생성하지 않고 거부한다.
  private async createCancellationRequest(
    tx: Prisma.TransactionClient,
    original: RequestRow,
  ): Promise<void> {
    const alreadyRequested = await tx.approvalRequest.findFirst({
      where: {
        refRequestId: original.id,
        type: ApprovalRequestType.CANCEL,
        status: { in: OPEN_STATUSES },
      },
    });
    if (alreadyRequested) {
      throw new ConflictException({
        code: 'CANCELLATION_ALREADY_REQUESTED',
        message: '이미 취소 요청이 진행 중입니다.',
      });
    }

    const requestLines = await this.resolveRequestLines(tx, original.facilityId);
    await tx.approvalRequest.create({
      data: {
        facilityId: original.facilityId,
        requesterId: original.requesterId,
        type: ApprovalRequestType.CANCEL,
        refRequestId: original.id,
        targetDates: {
          create: original.targetDates.map((d) => ({ targetDate: d.targetDate })),
        },
        requestLines: { create: requestLines },
        histories: {
          create: [{ actorId: original.requesterId, action: ApprovalAction.SUBMIT }],
        },
      },
    });
  }

  /// 주어진 id들 중 "진행 중인 취소 요청(type=CANCEL, status open)"이 걸려 있는 원건 id 집합
  private async findPendingCancellationRefIds(
    client: Prisma.TransactionClient | PrismaService,
    ids: bigint[],
  ): Promise<Set<bigint>> {
    if (ids.length === 0) return new Set();
    const rows = await client.approvalRequest.findMany({
      where: {
        type: ApprovalRequestType.CANCEL,
        status: { in: OPEN_STATUSES },
        refRequestId: { in: ids },
      },
      select: { refRequestId: true },
    });
    return new Set(rows.map((r) => r.refRequestId!));
  }

  private toMyRequest(row: RequestRow, pendingCancellation: boolean): MyLeaveRequestDto {
    return {
      id: row.id.toString(),
      type: row.type,
      status: row.status,
      targetDates: row.targetDates.map((d) => d.targetDate.toISOString().slice(0, 10)),
      reason: row.reason,
      isRetroactive: row.isRetroactive,
      pendingCancellation,
      createdAt: row.createdAt.toISOString(),
    };
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

  private conflict(): ConflictException {
    return new ConflictException({
      code: 'ALREADY_FINALIZED',
      message: '이미 종결되었거나 처리 중인 건입니다.',
    });
  }
}
