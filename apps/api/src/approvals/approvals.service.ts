import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApprovalRequestStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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

type EmployeeRow = {
  id: bigint;
  name: string;
  jobRole: EmployeeSummaryDto['jobRole'];
};

@Injectable()
export class ApprovalsService {
  constructor(private readonly prisma: PrismaService) {}

  async listRequests(
    filter: InboxStatusFilter,
  ): Promise<RequestListResponseDto> {
    const where: Prisma.ApprovalRequestWhereInput =
      filter === InboxStatusFilter.PENDING
        ? { status: { in: OPEN_STATUSES } }
        : {
            status:
              filter === InboxStatusFilter.APPROVED
                ? ApprovalRequestStatus.APPROVED
                : ApprovalRequestStatus.REJECTED,
          };

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

    const counts: InboxCountsDto = { pending: 0, approved: 0, rejected: 0 };
    for (const g of grouped) {
      const n = g._count._all;
      if (OPEN_STATUSES.includes(g.status)) counts.pending += n;
      else if (g.status === ApprovalRequestStatus.APPROVED)
        counts.approved += n;
      else if (g.status === ApprovalRequestStatus.REJECTED)
        counts.rejected += n;
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

    return this.prisma.$transaction(async (tx) => {
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

      if (isFinal) {
        await this.settleBalance(tx, req, 'APPROVE');
      }

      return this.readDetail(tx, requestId);
    });
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

    return this.prisma.$transaction(async (tx) => {
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

      return this.readDetail(tx, requestId);
    });
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
    return req;
  }

  private resolveCurrentStep(
    req: Prisma.ApprovalRequestGetPayload<{
      include: { requestLines: true; targetDates: true };
    }>,
    actorId: bigint,
  ) {
    const nextStepNo = req.currentStep + 1;
    const line = req.requestLines.find((l) => l.stepNo === nextStepNo);
    if (!line) {
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
    const isCurrentAssignee =
      line.approverId === actorId || line.deputyId === actorId;
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
    return {
      ...this.toListItem(row),
      finalizedAt: row.finalizedAt?.toISOString() ?? null,
      requestLines: row.requestLines.map((line) => ({
        stepNo: line.stepNo,
        approver: this.toEmployee(line.approver),
        deputy: line.deputy ? this.toEmployee(line.deputy) : null,
        delegationEnabled: line.delegationEnabled,
      })),
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
    };
    return new ConflictException({
      code,
      message: message ?? messages[code] ?? code,
    });
  }
}
