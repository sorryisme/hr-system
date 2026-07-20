import {
  BadRequestException,
  ConflictException,
  HttpException,
} from '@nestjs/common';
import { JobRole, Prisma } from '@prisma/client';
import { ApprovalsService } from './approvals.service';
import { PrismaService } from '../prisma/prisma.service';

// §3.4 상태머신 전이 규칙 검증. PrismaService는 트랜잭션 델리게이트 목으로 대체한다.

type TxMock = {
  approvalRequest: {
    findUnique: jest.Mock;
    updateMany: jest.Mock;
    findUniqueOrThrow: jest.Mock;
  };
  approvalHistory: { create: jest.Mock };
  employee: { findUnique: jest.Mock };
  leaveBalance: { update: jest.Mock };
  substituteHolidayBalance: { update: jest.Mock };
};

const employee = (id: bigint) => ({
  id,
  name: `직원${id}`,
  jobRole: JobRole.CAREGIVER,
});

const line = (
  stepNo: number,
  approverId: bigint,
  deputyId: bigint | null = null,
  delegationEnabled = false,
) => ({ requestId: 1n, stepNo, approverId, deputyId, delegationEnabled });

/** loadForTransition이 읽는 형태(requestLines + targetDates 포함) */
const transitionRow = (over: Record<string, unknown> = {}) => ({
  id: 1n,
  facilityId: 1n,
  requesterId: 5n,
  type: 'ANNUAL',
  desiredShiftId: null,
  reason: null,
  refRequestId: null,
  status: 'PENDING',
  currentStep: 0,
  isFinalByDelegation: false,
  leaveDays: new Prisma.Decimal('2.0'),
  isRetroactive: false,
  idempotencyKey: null,
  createdAt: new Date('2026-07-10T09:00:00Z'),
  finalizedAt: null,
  requestLines: [line(1, 3n), line(2, 2n), line(3, 1n)],
  targetDates: [
    { requestId: 1n, targetDate: new Date('2026-07-21T00:00:00Z') },
  ],
  ...over,
});

/** 전이 후 readDetail이 읽는 형태(detailInclude 포함) */
const detailRow = (over: Record<string, unknown> = {}) => ({
  ...transitionRow(),
  requester: employee(5n),
  desiredShift: null,
  requestLines: [
    { ...line(1, 3n), approver: employee(3n), deputy: null },
    { ...line(2, 2n), approver: employee(2n), deputy: null },
    { ...line(3, 1n), approver: employee(1n), deputy: null },
  ],
  histories: [],
  ...over,
});

/** expect.objectContaining이 any를 반환해 no-unsafe-assignment에 걸리는 것을 우회하는 타입 헬퍼 */
const containing = <T extends object>(obj: T): T =>
  expect.objectContaining(obj) as T;

const expectHttpCode = async (
  promise: Promise<unknown>,
  cls: new (...args: never[]) => HttpException,
  code: string,
) => {
  const error = (await promise.then(
    () => {
      throw new Error('예외가 발생해야 하는 케이스');
    },
    (e: unknown) => e,
  )) as HttpException;
  expect(error).toBeInstanceOf(cls);
  expect(error.getResponse()).toMatchObject({ code });
};

describe('ApprovalsService 상태머신', () => {
  let tx: TxMock;
  let service: ApprovalsService;

  beforeEach(() => {
    tx = {
      approvalRequest: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(detailRow()),
      },
      approvalHistory: { create: jest.fn().mockResolvedValue({}) },
      employee: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ signaturePath: 'signatures/emp.png' }),
      },
      leaveBalance: { update: jest.fn().mockResolvedValue({}) },
      substituteHolidayBalance: { update: jest.fn().mockResolvedValue({}) },
    };
    const prismaMock = {
      $transaction: jest.fn((cb: (t: TxMock) => Promise<unknown>) => cb(tx)),
    };
    service = new ApprovalsService(prismaMock as unknown as PrismaService);
  });

  it('1차 승인 → INTERIM_APPROVED(1), 서명 스냅샷 기재, 잔여 미정산', async () => {
    tx.approvalRequest.findUnique.mockResolvedValue(transitionRow());

    await service.approveRequest('1', '3');

    expect(tx.approvalRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 1n, status: 'PENDING', currentStep: 0 },
      data: { status: 'INTERIM_APPROVED', currentStep: 1 },
    });
    expect(tx.approvalHistory.create).toHaveBeenCalledWith({
      data: containing({
        action: 'APPROVE',
        stepNo: 1,
        isDelegatedFinal: false,
        signatureSnapshotPath: 'signatures/snapshots/1/step1-3.png',
      }),
    });
    expect(tx.leaveBalance.update).not.toHaveBeenCalled();
  });

  it('1단계 결재선 → 즉시 APPROVED + 잔여 정산(used↑, reserved↓)', async () => {
    tx.approvalRequest.findUnique.mockResolvedValue(
      transitionRow({ requestLines: [line(1, 3n)] }),
    );

    await service.approveRequest('1', '3');

    expect(tx.approvalRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: containing({
          status: 'APPROVED',
          currentStep: 1,
          isFinalByDelegation: false,
        }),
      }),
    );
    expect(tx.leaveBalance.update).toHaveBeenCalledWith({
      where: { employeeId_balanceYear: { employeeId: 5n, balanceYear: 2026 } },
      data: {
        used: { increment: new Prisma.Decimal('2.0') },
        reserved: { decrement: new Prisma.Decimal('2.0') },
      },
    });
  });

  it('전결 ON에서 2차 승인 → APPROVED + isFinalByDelegation + history.isDelegatedFinal (D-13)', async () => {
    tx.approvalRequest.findUnique.mockResolvedValue(
      transitionRow({
        status: 'INTERIM_APPROVED',
        currentStep: 1,
        requestLines: [line(1, 3n), line(2, 2n, null, true), line(3, 1n)],
      }),
    );

    await service.approveRequest('1', '2');

    expect(tx.approvalRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: containing({
          status: 'APPROVED',
          currentStep: 2,
          isFinalByDelegation: true,
        }),
      }),
    );
    expect(tx.approvalHistory.create).toHaveBeenCalledWith({
      data: containing({ isDelegatedFinal: true }),
    });
    expect(tx.leaveBalance.update).toHaveBeenCalled();
  });

  it('전결 OFF에서도 2차 결재자가 전결 선택 시 → APPROVED + isFinalByDelegation (D-13)', async () => {
    tx.approvalRequest.findUnique.mockResolvedValue(
      transitionRow({ status: 'INTERIM_APPROVED', currentStep: 1 }),
    );

    await service.approveRequest('1', '2', true);

    expect(tx.approvalRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: containing({
          status: 'APPROVED',
          currentStep: 2,
          isFinalByDelegation: true,
        }),
      }),
    );
    expect(tx.approvalHistory.create).toHaveBeenCalledWith({
      data: containing({ isDelegatedFinal: true }),
    });
  });

  it('전결 선택은 2차 단계가 아니면 400 DELEGATION_NOT_ALLOWED', async () => {
    tx.approvalRequest.findUnique.mockResolvedValue(transitionRow());

    await expectHttpCode(
      service.approveRequest('1', '3', true),
      BadRequestException,
      'DELEGATION_NOT_ALLOWED',
    );
    expect(tx.approvalRequest.updateMany).not.toHaveBeenCalled();
  });

  it('상위(3차) 결재자가 2차를 대리 결재할 때 전결 선택 → 400 DELEGATION_NOT_ALLOWED', async () => {
    tx.approvalRequest.findUnique.mockResolvedValue(
      transitionRow({ status: 'INTERIM_APPROVED', currentStep: 1 }),
    );

    await expectHttpCode(
      service.approveRequest('1', '1', true),
      BadRequestException,
      'DELEGATION_NOT_ALLOWED',
    );
  });

  it('전결 OFF에서 2차 승인 → INTERIM_APPROVED(2), 잔여 미정산', async () => {
    tx.approvalRequest.findUnique.mockResolvedValue(
      transitionRow({ status: 'INTERIM_APPROVED', currentStep: 1 }),
    );

    await service.approveRequest('1', '2');

    expect(tx.approvalRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'INTERIM_APPROVED', currentStep: 2 },
      }),
    );
    expect(tx.leaveBalance.update).not.toHaveBeenCalled();
  });

  it('3차(최종) 승인 → APPROVED. 유대 건은 substituteHolidayBalance로 정산', async () => {
    tx.approvalRequest.findUnique.mockResolvedValue(
      transitionRow({
        type: 'SUBSTITUTE_HOLIDAY',
        status: 'INTERIM_APPROVED',
        currentStep: 2,
        leaveDays: new Prisma.Decimal('1.0'),
      }),
    );

    await service.approveRequest('1', '1');

    expect(tx.substituteHolidayBalance.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          used: { increment: new Prisma.Decimal('1.0') },
          reserved: { decrement: new Prisma.Decimal('1.0') },
        },
      }),
    );
    expect(tx.leaveBalance.update).not.toHaveBeenCalled();
  });

  it('대결자도 해당 단계를 승인할 수 있다', async () => {
    tx.approvalRequest.findUnique.mockResolvedValue(
      transitionRow({
        requestLines: [line(1, 3n, 9n), line(2, 2n), line(3, 1n)],
      }),
    );

    await service.approveRequest('1', '9');

    expect(tx.approvalRequest.updateMany).toHaveBeenCalled();
  });

  it('상위 단계 결재자는 하위 단계를 결재할 수 있다(3차 결재자의 1차 승인)', async () => {
    tx.approvalRequest.findUnique.mockResolvedValue(transitionRow());

    await service.approveRequest('1', '1');

    expect(tx.approvalRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 1n, status: 'PENDING', currentStep: 0 },
      data: { status: 'INTERIM_APPROVED', currentStep: 1 },
    });
    expect(tx.approvalHistory.create).toHaveBeenCalledWith({
      data: containing({ action: 'APPROVE', stepNo: 1 }),
    });
  });

  it('상위 단계의 대결자는 하위 결재 불가 — 409 NOT_YOUR_STEP', async () => {
    tx.approvalRequest.findUnique.mockResolvedValue(
      transitionRow({
        requestLines: [line(1, 3n), line(2, 2n, 9n), line(3, 1n)],
      }),
    );

    await expectHttpCode(
      service.approveRequest('1', '9'),
      ConflictException,
      'NOT_YOUR_STEP',
    );
  });

  it('현재 단계 결재자/대결자가 아니면 409 NOT_YOUR_STEP, 전이 없음', async () => {
    tx.approvalRequest.findUnique.mockResolvedValue(transitionRow());

    await expectHttpCode(
      service.approveRequest('1', '8'),
      ConflictException,
      'NOT_YOUR_STEP',
    );
    expect(tx.approvalRequest.updateMany).not.toHaveBeenCalled();
  });

  it('자기결재는 409 SELF_APPROVAL_FORBIDDEN (D-6)', async () => {
    tx.approvalRequest.findUnique.mockResolvedValue(
      transitionRow({ requesterId: 3n }),
    );

    await expectHttpCode(
      service.approveRequest('1', '3'),
      ConflictException,
      'SELF_APPROVAL_FORBIDDEN',
    );
  });

  it('종결 상태 건은 409 ALREADY_FINALIZED', async () => {
    tx.approvalRequest.findUnique.mockResolvedValue(
      transitionRow({ status: 'APPROVED', currentStep: 3 }),
    );

    await expectHttpCode(
      service.approveRequest('1', '1'),
      ConflictException,
      'ALREADY_FINALIZED',
    );
  });

  it('낙관적 가드 경합(updateMany count=0) → 409, history 미기록 (엣지 1)', async () => {
    tx.approvalRequest.findUnique.mockResolvedValue(transitionRow());
    tx.approvalRequest.updateMany.mockResolvedValue({ count: 0 });

    await expectHttpCode(
      service.approveRequest('1', '3'),
      ConflictException,
      'ALREADY_FINALIZED',
    );
    expect(tx.approvalHistory.create).not.toHaveBeenCalled();
  });

  it('반려 사유 공백 → 400 REASON_REQUIRED', async () => {
    await expectHttpCode(
      service.rejectRequest('1', '3', '   '),
      BadRequestException,
      'REASON_REQUIRED',
    );
  });

  it('반려 → REJECTED + reserved만 해제 + 사유 history 기록', async () => {
    tx.approvalRequest.findUnique.mockResolvedValue(transitionRow());

    await service.rejectRequest('1', '3', '해당일 인력 부족');

    expect(tx.approvalRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: containing({ status: 'REJECTED' }),
      }),
    );
    expect(tx.approvalHistory.create).toHaveBeenCalledWith({
      data: containing({
        action: 'REJECT',
        stepNo: 1,
        comment: '해당일 인력 부족',
      }),
    });
    expect(tx.leaveBalance.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { reserved: { decrement: new Prisma.Decimal('2.0') } },
      }),
    );
  });

  it('SHIFT_CHANGE(leaveDays null) 반려 시 잔여 테이블 미접근', async () => {
    tx.approvalRequest.findUnique.mockResolvedValue(
      transitionRow({ type: 'SHIFT_CHANGE', leaveDays: null }),
    );

    await service.rejectRequest('1', '3', '조정 불가');

    expect(tx.leaveBalance.update).not.toHaveBeenCalled();
    expect(tx.substituteHolidayBalance.update).not.toHaveBeenCalled();
  });
});
