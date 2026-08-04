import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ApprovalRequestStatus,
  ApprovalRequestType,
  Prisma,
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
import { InboxStatusFilter } from './dto/inbox-query.dto';
import {
  EmployeeSummaryDto,
  InboxCountsDto,
  RequestListItemDto,
  RequestListResponseDto,
} from './dto/request-list.dto';
import { RequestDetailDto } from './dto/request-detail.dto';

/// 대기 탭 = 진행 중 전체(§3.3 결재함 A-3)
const OPEN_STATUSES: ApprovalRequestStatus[] = [
  ApprovalRequestStatus.PENDING,
  ApprovalRequestStatus.INTERIM_APPROVED,
];

/// 취소 탭 = 종결된 취소 건 전체
const CANCELED_STATUSES: ApprovalRequestStatus[] = [
  ApprovalRequestStatus.CANCELED,
  ApprovalRequestStatus.CANCELED_AFTER_APPROVAL,
];

const listInclude = {
  requester: { select: { id: true, name: true, jobRole: true } },
  desiredShift: { select: { id: true, label: true } },
  targetDates: { orderBy: { targetDate: 'asc' } },
  requestLines: { select: { stepNo: true } },
} satisfies Prisma.ApprovalRequestInclude;

const detailInclude = {
  requester: { select: { id: true, name: true, jobRole: true } },
  desiredShift: { select: { id: true, label: true } },
  targetDates: { orderBy: { targetDate: 'asc' } },
  requestLines: {
    orderBy: { stepNo: 'asc' },
    include: {
      approver: { select: { id: true, name: true, jobRole: true } },
      deputy: { select: { id: true, name: true, jobRole: true } },
    },
  },
  histories: {
    orderBy: [{ actedAt: 'asc' }, { id: 'asc' }],
    include: { actor: { select: { id: true, name: true, jobRole: true } } },
  },
} satisfies Prisma.ApprovalRequestInclude;

type ListRow = Prisma.ApprovalRequestGetPayload<{
  include: typeof listInclude;
}>;
type DetailRow = Prisma.ApprovalRequestGetPayload<{
  include: typeof detailInclude;
}>;

/// 근무표 원복 이벤트를 발행하는 데 필요한 최소 필드(§4.10). 반려된 건 자신 또는
/// 취소가 확정된 원건(refRequestId 대상) 어느 쪽이든 이 모양이면 된다.
type RevertSource = {
  id: bigint;
  facilityId: bigint;
  requesterId: bigint;
  targetDates: { targetDate: Date }[];
};

type EmployeeRow = {
  id: bigint;
  name: string;
  jobRole: EmployeeSummaryDto['jobRole'];
};

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: DomainEventBus,
  ) {}

  async listRequests(
    filter: InboxStatusFilter,
  ): Promise<RequestListResponseDto> {
    const where: Prisma.ApprovalRequestWhereInput = (() => {
      switch (filter) {
        case InboxStatusFilter.PENDING:
          return { status: { in: OPEN_STATUSES } };
        case InboxStatusFilter.APPROVED:
          return { status: ApprovalRequestStatus.APPROVED };
        case InboxStatusFilter.REJECTED:
          return { status: ApprovalRequestStatus.REJECTED };
        case InboxStatusFilter.CANCELED:
          return { status: { in: CANCELED_STATUSES } };
      }
    })();

    const [rows, grouped] = await Promise.all([
      this.prisma.approvalRequest.findMany({
        where,
        include: listInclude,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.approvalRequest.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
    ]);

    const counts: InboxCountsDto = {
      pending: 0,
      approved: 0,
      rejected: 0,
      canceled: 0,
    };
    for (const g of grouped) {
      const n = g._count._all;
      if (OPEN_STATUSES.includes(g.status)) counts.pending += n;
      else if (g.status === ApprovalRequestStatus.APPROVED)
        counts.approved += n;
      else if (g.status === ApprovalRequestStatus.REJECTED)
        counts.rejected += n;
      else if (CANCELED_STATUSES.includes(g.status)) counts.canceled += n;
    }

    return { items: rows.map((row) => this.toListItem(row)), counts };
  }

  async getRequest(id: string): Promise<RequestDetailDto> {
    const requestId = this.parseId(id);
    const row = await this.prisma.approvalRequest.findUnique({
      where: { id: requestId },
      include: detailInclude,
    });
    if (!row) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: '신청 건을 찾을 수 없습니다.',
      });
    }
    return this.toDetail(row);
  }

  async approveRequest(
    id: string,
    approverId: string,
    delegated = false,
  ): Promise<RequestDetailDto> {
    const requestId = this.parseId(id);
    const actorId = this.parseId(approverId);

    const outcome = await this.prisma.$transaction(async (tx) => {
      const req = await this.loadForTransition(tx, requestId);
      const { line, nextStepNo, totalSteps, isCurrentAssignee } =
        this.resolveCurrentStep(req, actorId);

      // 임의 전결(D-13): 결재 시점 선택은 2차 단계의 결재자·대결자 본인만 가능
      // (상위 결재자의 하위 대리 결재에는 전결 옵션을 허용하지 않는다)
      if (delegated && (nextStepNo !== 2 || !isCurrentAssignee)) {
        throw new BadRequestException({
          code: 'DELEGATION_NOT_ALLOWED',
          message: '전결은 2차 결재 단계의 결재자·대결자만 사용할 수 있습니다.',
        });
      }

      // 전결(D-13): step 2 승인 시 스냅샷 delegation ON이거나 결재자가 전결을 선택하면 최종 확정
      const isFinal =
        nextStepNo === totalSteps ||
        (nextStepNo === 2 && (line.delegationEnabled || delegated));
      const isDelegated = isFinal && nextStepNo < totalSteps;

      // 낙관적 가드(엣지 1 — 동시 결재 경합): 읽은 시점의 status/currentStep 조건부 전이
      const updated = await tx.approvalRequest.updateMany({
        where: {
          id: requestId,
          status: req.status,
          currentStep: req.currentStep,
        },
        data: isFinal
          ? {
              status: ApprovalRequestStatus.APPROVED,
              currentStep: nextStepNo,
              isFinalByDelegation: isDelegated,
              finalizedAt: new Date(),
            }
          : {
              status: ApprovalRequestStatus.INTERIM_APPROVED,
              currentStep: nextStepNo,
            },
      });
      if (updated.count === 0) {
        throw this.conflict('ALREADY_FINALIZED');
      }

      // TODO(D-12): 오브젝트 스토리지 도입 시 employee.signaturePath 원본을 아래 경로로 실제 복사한다.
      // 현재는 경로 문자열 기재까지만 — 서명 원본이 없으면 스냅샷도 없음(결재 권한자 등록 필수는 앱 레벨 후속)
      const actor = await tx.employee.findUnique({
        where: { id: actorId },
        select: { signaturePath: true },
      });
      const signatureSnapshotPath = actor?.signaturePath
        ? `signatures/snapshots/${requestId}/step${nextStepNo}-${actorId}.png`
        : null;

      await tx.approvalHistory.create({
        data: {
          requestId,
          actorId,
          action: 'APPROVE',
          stepNo: nextStepNo,
          isDelegatedFinal: isDelegated,
          signatureSnapshotPath,
        },
      });

      // 취소 요청(D-6/취소 승인) 자체가 최종 승인되면 원건을 CANCELED로 전환하고,
      // 원건이 근무표에 반영해둔 셀은 트랜잭션 커밋 이후 REQUEST_REVERTED로 원복한다.
      let cancellationRevert: RevertSource | null = null;
      if (isFinal) {
        await this.settleBalance(tx, req, 'APPROVE');
        if (req.type === ApprovalRequestType.CANCEL && req.refRequestId) {
          cancellationRevert = await this.applyCancellation(
            tx,
            req.refRequestId,
            actorId,
          );
        }
      }

      const detail = await this.readDetail(tx, requestId);
      return { detail, req, isFinal, nextStepNo, cancellationRevert };
    });

    // 근무표 반영 이벤트는 트랜잭션 커밋 이후에 발행한다(§2.3/§4.10 — 구독자가 확정된 상태를 읽도록).
    // 최종 승인=REQUEST_APPROVED(확정 반영), 1차 승인=REQUEST_STEP_APPROVED(가반영).
    this.publishApprovalEvent(outcome.req, outcome.isFinal, outcome.nextStepNo);
    if (outcome.cancellationRevert) {
      this.publishRevertEvent(outcome.cancellationRevert);
    }
    return outcome.detail;
  }

  /// 근무표 반영 구독자에게 필요한 최소 페이로드를 발행한다. 발행 실패가 결재 응답을 막지 않도록
  /// 버스는 동기(in-process)지만 구독자 예외는 구독자 내부에서 격리한다(domain-event-bus 참고).
  private publishApprovalEvent(
    req: Prisma.ApprovalRequestGetPayload<{
      include: { requestLines: true; targetDates: true };
    }>,
    isFinal: boolean,
    nextStepNo: number,
  ): void {
    // 1차 승인에서만 가반영을 발행한다(중간 2차 승인은 근무표 이벤트 없음 — §4.10)
    if (!isFinal && nextStepNo !== 1) return;

    const payload: ApprovalReflectionPayload = {
      requestId: req.id,
      facilityId: req.facilityId,
      requesterId: req.requesterId,
      type: req.type,
      targetDates: req.targetDates.map((d) =>
        d.targetDate.toISOString().slice(0, 10),
      ),
      desiredShiftId: req.desiredShiftId,
      desiredStartTime: req.desiredStartTime,
      desiredEndTime: req.desiredEndTime,
    };
    this.bus.publish<ApprovalReflectionPayload>(
      isFinal ? REQUEST_APPROVED : REQUEST_STEP_APPROVED,
      payload,
    );
  }

  /// 반려되거나(자기 자신) 취소가 확정된(원건) 요청이 근무표에 반영해둔 셀을 원복하도록 발행한다.
  /// 애초에 반영된 셀이 없었다면(예: 1차 승인 전 반려) 구독자에서 조용히 무시된다.
  private publishRevertEvent(req: RevertSource): void {
    const payload: ApprovalRevertPayload = {
      requestId: req.id,
      facilityId: req.facilityId,
      requesterId: req.requesterId,
      targetDates: req.targetDates.map((d) =>
        d.targetDate.toISOString().slice(0, 10),
      ),
    };
    this.bus.publish<ApprovalRevertPayload>(REQUEST_REVERTED, payload);
  }

  async rejectRequest(
    id: string,
    approverId: string,
    comment: string,
  ): Promise<RequestDetailDto> {
    const requestId = this.parseId(id);
    const actorId = this.parseId(approverId);
    if (!comment.trim()) {
      throw new BadRequestException({
        code: 'REASON_REQUIRED',
        message: '반려 사유는 필수입니다.',
      });
    }

    const outcome = await this.prisma.$transaction(async (tx) => {
      const req = await this.loadForTransition(tx, requestId);
      const { nextStepNo } = this.resolveCurrentStep(req, actorId);

      const updated = await tx.approvalRequest.updateMany({
        where: {
          id: requestId,
          status: req.status,
          currentStep: req.currentStep,
        },
        data: {
          status: ApprovalRequestStatus.REJECTED,
          finalizedAt: new Date(),
        },
      });
      if (updated.count === 0) {
        throw this.conflict('ALREADY_FINALIZED');
      }

      await tx.approvalHistory.create({
        data: {
          requestId,
          actorId,
          action: 'REJECT',
          stepNo: nextStepNo,
          comment: comment.trim(),
        },
      });

      // 반려 시 reserved 해제(§3.4 전이 규칙표) — used는 건드리지 않음
      await this.settleBalance(tx, req, 'REJECT');

      const detail = await this.readDetail(tx, requestId);
      return { detail, req };
    });

    // 1차 승인으로 가반영된 셀이 있었다면 트랜잭션 커밋 이후 원복한다(§4.10).
    // 가반영이 없었던 경우(1차 승인 전 반려 등)는 구독자에서 조용히 무시된다.
    this.publishRevertEvent(outcome.req);
    return outcome.detail;
  }

  // ---------------------------------------------------------------
  // 전이 공통 로직
  // ---------------------------------------------------------------

  private async loadForTransition(
    tx: Prisma.TransactionClient,
    requestId: bigint,
  ) {
    const req = await tx.approvalRequest.findUnique({
      where: { id: requestId },
      include: { requestLines: true, targetDates: true },
    });
    if (!req) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: '신청 건을 찾을 수 없습니다.',
      });
    }
    if (!OPEN_STATUSES.includes(req.status)) {
      throw this.conflict('ALREADY_FINALIZED');
    }
    // 이 건을 대상으로 한 취소 요청(type=CANCEL)이 결재 진행 중이면 원건 자체의 승인/반려를
    // 차단한다 — 취소 결과가 정해지기 전까지 원건 상태가 갈라지는 것을 막는다(leave.service.ts
    // createCancellationRequest 참고).
    const pendingCancellation = await tx.approvalRequest.findFirst({
      where: {
        refRequestId: requestId,
        type: ApprovalRequestType.CANCEL,
        status: { in: OPEN_STATUSES },
      },
    });
    if (pendingCancellation) {
      throw this.conflict('CANCELLATION_PENDING');
    }
    return req;
  }

  /// 취소 요청(type=CANCEL)이 최종 승인되면 원건(refRequestId)을 종결 상태로 전환하고
  /// 잔여를 반환한다. 원건이 취소 신청 시점에 INTERIM_APPROVED였으면 CANCELED로,
  /// APPROVED(확정)였으면 CANCELED_AFTER_APPROVAL로 전환한다 — 최종 승인 시 reserved가
  /// used로 이관되므로(settleBalance) 확정 건은 used를, 그 외에는 reserved를 되돌린다.
  /// 원건이 이미 다른 경로로 종결됐다면(방어적) 아무 것도 하지 않는다.
  ///
  /// 동시성 가드: 같은 원건을 참조하는 취소 요청이 (버그·경합으로) 둘 이상 동시에
  /// 최종 승인되는 경우를 대비해, 읽은 시점의 status를 조건으로 하는 updateMany로
  /// 전이한다. 다른 트랜잭션이 먼저 처리했다면 count=0이 되어 이력·잔여 반환·근무표
  /// 원복을 전부 건너뛴다 — used/reserved가 중복 차감되는 것을 방지한다.
  private async applyCancellation(
    tx: Prisma.TransactionClient,
    refRequestId: bigint,
    actorId: bigint,
  ): Promise<RevertSource | null> {
    const original = await tx.approvalRequest.findUnique({
      where: { id: refRequestId },
      include: { targetDates: true },
    });
    const wasApproved = original?.status === ApprovalRequestStatus.APPROVED;
    if (!original || !(OPEN_STATUSES.includes(original.status) || wasApproved)) {
      return null;
    }

    const updated = await tx.approvalRequest.updateMany({
      where: { id: refRequestId, status: original.status },
      data: {
        status: wasApproved
          ? ApprovalRequestStatus.CANCELED_AFTER_APPROVAL
          : ApprovalRequestStatus.CANCELED,
        finalizedAt: new Date(),
      },
    });
    if (updated.count === 0) {
      return null;
    }

    await tx.approvalHistory.create({
      data: { requestId: refRequestId, actorId, action: 'CANCEL' },
    });

    if (original.leaveDays !== null) {
      const firstDate =
        original.targetDates[0]?.targetDate ?? original.createdAt;
      const balanceYear = firstDate.getUTCFullYear();
      const where = {
        employeeId_balanceYear: {
          employeeId: original.requesterId,
          balanceYear,
        },
      };
      const data = wasApproved
        ? { used: { decrement: original.leaveDays } }
        : { reserved: { decrement: original.leaveDays } };
      if (original.type === ApprovalRequestType.SUBSTITUTE_HOLIDAY) {
        await tx.substituteHolidayBalance.update({ where, data });
      } else {
        await tx.leaveBalance.update({ where, data });
      }
    }

    // 원건이 근무표에 반영해둔 셀(있다면 — 확정 건이면 색칠된 확정 셀)을 원복하도록,
    // 트랜잭션 커밋 이후 발행할 정보를 돌려준다.
    return original;
  }

  /// CANCEL 유형은 stepNo=1에 시설 결재선 전원이 후보로 스냅샷돼 있다(결재라인 1개 제한,
  /// 누구든 결재 가능 — leave.service.ts resolveCancellationRequestLines). 그래서 같은
  /// stepNo에 여러 후보 행이 있을 수 있어, 대표로 첫 행만 보는 대신 후보 전체를 검사한다.
  private resolveCurrentStep(
    req: Prisma.ApprovalRequestGetPayload<{
      include: { requestLines: true; targetDates: true };
    }>,
    actorId: bigint,
  ) {
    const nextStepNo = req.currentStep + 1;
    const candidates = req.requestLines.filter((l) => l.stepNo === nextStepNo);
    if (candidates.length === 0) {
      // 스냅샷에 다음 단계가 없으면 이미 종결됐어야 하는 건 — 방어적 409
      throw this.conflict('ALREADY_FINALIZED');
    }
    if (req.requesterId === actorId) {
      throw this.conflict(
        'SELF_APPROVAL_FORBIDDEN',
        '자기결재는 금지되어 있습니다(D-6).',
      );
    }
    // 하위 결재 허용: 현재 단계의 결재자/대결자 외에 상위 단계 결재자도
    // 하위 단계를 대신 결재할 수 있다(예: 2차→1차, 3차→1·2차)
    const isCurrentAssignee = candidates.some(
      (l) => l.approverId === actorId || l.deputyId === actorId,
    );
    const isHigherApprover = req.requestLines.some(
      (l) => l.stepNo > nextStepNo && l.approverId === actorId,
    );
    if (!isCurrentAssignee && !isHigherApprover) {
      throw this.conflict(
        'NOT_YOUR_STEP',
        '현재 단계의 결재자·대결자 또는 상위 단계 결재자가 아닙니다.',
      );
    }
    const totalSteps = Math.max(...req.requestLines.map((l) => l.stepNo));
    const line = candidates[0];
    return { line, nextStepNo, totalSteps, isCurrentAssignee };
  }

  /// 최종 승인/반려 시 잔여 정산. remaining은 DB GENERATED — 절대 쓰지 않는다
  private async settleBalance(
    tx: Prisma.TransactionClient,
    req: Prisma.ApprovalRequestGetPayload<{
      include: { requestLines: true; targetDates: true };
    }>,
    mode: 'APPROVE' | 'REJECT',
  ) {
    if (req.leaveDays === null) return; // SHIFT_CHANGE/CANCEL — 잔여 없음

    // TODO(§3.5): balanceYear는 입사일 기준 연차연도가 원칙. 이번 슬라이스에서는
    // 최초 대상일의 연도로 단순화(시드 데이터와 정합) — Phase 1 잔여 관리 본작업에서 보정
    const firstDate = req.targetDates[0]?.targetDate ?? req.createdAt;
    const balanceYear = firstDate.getUTCFullYear();
    const where = {
      employeeId_balanceYear: { employeeId: req.requesterId, balanceYear },
    };
    const data =
      mode === 'APPROVE'
        ? {
            used: { increment: req.leaveDays },
            reserved: { decrement: req.leaveDays },
          }
        : { reserved: { decrement: req.leaveDays } };

    if (req.type === 'SUBSTITUTE_HOLIDAY') {
      await tx.substituteHolidayBalance.update({ where, data });
    } else {
      await tx.leaveBalance.update({ where, data });
    }
  }

  private async readDetail(tx: Prisma.TransactionClient, requestId: bigint) {
    const row = await tx.approvalRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: detailInclude,
    });
    return this.toDetail(row);
  }

  // ---------------------------------------------------------------
  // DTO 매핑 (BigInt/Decimal → string 명시 변환 — Swagger 타입과 일치)
  // ---------------------------------------------------------------

  private toEmployee(e: EmployeeRow): EmployeeSummaryDto {
    return { id: e.id.toString(), name: e.name, jobRole: e.jobRole };
  }

  private toListItem(row: ListRow): RequestListItemDto {
    return {
      id: row.id.toString(),
      requester: this.toEmployee(row.requester),
      type: row.type,
      status: row.status,
      currentStep: row.currentStep,
      totalSteps: row.requestLines.length
        ? Math.max(...row.requestLines.map((l) => l.stepNo))
        : 0,
      targetDates: row.targetDates.map((d) =>
        d.targetDate.toISOString().slice(0, 10),
      ),
      desiredShift: row.desiredShift
        ? { id: row.desiredShift.id.toString(), label: row.desiredShift.label }
        : null,
      reason: row.reason,
      leaveDays: row.leaveDays?.toString() ?? null,
      isRetroactive: row.isRetroactive,
      isFinalByDelegation: row.isFinalByDelegation,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toDetail(row: DetailRow): RequestDetailDto {
    // CANCEL 유형은 같은 stepNo에 결재자 후보가 여러 행 있을 수 있다(누구든 결재
    // 가능 — leave.service.ts resolveCancellationRequestLines) — 단계별로 묶어
    // approvers 배열로 응답한다(일반 신청은 항상 후보 1명).
    const stepNumbers = [
      ...new Set(row.requestLines.map((l) => l.stepNo)),
    ].sort((a, b) => a - b);
    return {
      ...this.toListItem(row),
      finalizedAt: row.finalizedAt?.toISOString() ?? null,
      requestLines: stepNumbers.map((stepNo) => {
        const candidates = row.requestLines.filter((l) => l.stepNo === stepNo);
        return {
          stepNo,
          approvers: candidates.map((l) => this.toEmployee(l.approver)),
          deputy: candidates[0].deputy
            ? this.toEmployee(candidates[0].deputy)
            : null,
          delegationEnabled: candidates[0].delegationEnabled,
        };
      }),
      histories: row.histories.map((h) => ({
        id: h.id.toString(),
        action: h.action,
        stepNo: h.stepNo,
        actor: this.toEmployee(h.actor),
        isDelegatedFinal: h.isDelegatedFinal,
        comment: h.comment,
        signatureSnapshotPath: h.signatureSnapshotPath,
        actedAt: h.actedAt.toISOString(),
      })),
    };
  }

  // ---------------------------------------------------------------
  // 공통 유틸
  // ---------------------------------------------------------------

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

  private conflict(code: string, message?: string) {
    const messages: Record<string, string> = {
      ALREADY_FINALIZED:
        '이미 종결되었거나 다른 결재자가 먼저 처리한 건입니다.',
      NOT_YOUR_STEP: '현재 단계를 결재할 권한이 없습니다.',
      SELF_APPROVAL_FORBIDDEN: '자기결재는 금지되어 있습니다.',
      CANCELLATION_PENDING: '취소 승인이 진행 중이라 처리할 수 없습니다.',
    };
    return new ConflictException({
      code,
      message: message ?? messages[code] ?? code,
    });
  }
}
