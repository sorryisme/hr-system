import {
  ApprovalAction,
  ApprovalRequestStatus,
  ApprovalRequestType,
  JobRole,
} from '@prisma/client';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { LeaveService } from './leave.service';
import { PrismaService } from '../prisma/prisma.service';

type TxMock = {
  approvalRequest: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    updateMany: jest.Mock;
  };
  approvalRequestDate: { findFirst: jest.Mock };
  approvalLine: { findMany: jest.Mock };
  employee: { findFirst: jest.Mock };
  leaveBalance: { upsert: jest.Mock; update: jest.Mock };
  substituteHolidayBalance: { upsert: jest.Mock; update: jest.Mock };
  approvalHistory: { create: jest.Mock };
};

type PrismaMock = {
  leaveBalance: { findUnique: jest.Mock };
  substituteHolidayBalance: { findUnique: jest.Mock };
  approvalRequest: { findMany: jest.Mock; findUnique: jest.Mock };
  $transaction: jest.Mock;
};

function makeTxMock(): TxMock {
  return {
    approvalRequest: {
      findUnique: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    approvalRequestDate: { findFirst: jest.fn() },
    approvalLine: { findMany: jest.fn() },
    employee: { findFirst: jest.fn() },
    leaveBalance: { upsert: jest.fn(), update: jest.fn() },
    substituteHolidayBalance: { upsert: jest.fn(), update: jest.fn() },
    approvalHistory: { create: jest.fn() },
  };
}

function makePrismaMock(tx: TxMock): PrismaMock {
  return {
    leaveBalance: { findUnique: jest.fn() },
    substituteHolidayBalance: { findUnique: jest.fn() },
    approvalRequest: { findMany: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn((cb: (tx: TxMock) => unknown) => cb(tx)),
  };
}

const decimal = (v: string) => ({ toString: () => v });

const line = (
  stepNo: number,
  over: Record<string, unknown> = {},
) => ({
  facilityId: 1n,
  stepNo,
  approverRole: null,
  approverId: null,
  deputyId: null,
  delegationEnabled: false,
  effectiveFrom: new Date('2026-01-01'),
  effectiveTo: null,
  ...over,
});

describe('LeaveService', () => {
  let tx: TxMock;
  let prisma: PrismaMock;
  let service: LeaveService;

  beforeEach(() => {
    tx = makeTxMock();
    prisma = makePrismaMock(tx);
    service = new LeaveService(prisma as unknown as PrismaService);
  });

  describe('getBalance', () => {
    it('잔여 행이 있으면 Decimal 필드를 문자열로 변환해 반환한다', async () => {
      prisma.leaveBalance.findUnique.mockResolvedValue({
        granted: decimal('17.0'),
        used: decimal('1.0'),
        reserved: decimal('0.5'),
        remaining: decimal('15.5'),
      });
      prisma.substituteHolidayBalance.findUnique.mockResolvedValue(null);

      const result = await service.getBalance(4n, 2026);

      expect(result).toEqual({
        balanceYear: 2026,
        annual: { granted: '17.0', used: '1.0', reserved: '0.5', remaining: '15.5' },
        substituteHoliday: { granted: '0.0', used: '0.0', reserved: '0.0', remaining: '0.0' },
      });
    });

    it('두 잔여 모두 행이 없으면 0으로 채운다', async () => {
      prisma.leaveBalance.findUnique.mockResolvedValue(null);
      prisma.substituteHolidayBalance.findUnique.mockResolvedValue(null);

      const result = await service.getBalance(9n, 2026);

      expect(result.annual).toEqual({ granted: '0.0', used: '0.0', reserved: '0.0', remaining: '0.0' });
      expect(result.substituteHoliday).toEqual({ granted: '0.0', used: '0.0', reserved: '0.0', remaining: '0.0' });
    });
  });

  describe('getMyRequests', () => {
    it('연차 계열 타입·취소 제외 상태로만 조회하고 응답을 매핑한다', async () => {
      prisma.approvalRequest.findMany
        .mockResolvedValueOnce([
          {
            id: 1n,
            type: ApprovalRequestType.ANNUAL,
            status: ApprovalRequestStatus.PENDING,
            reason: null,
            isRetroactive: false,
            createdAt: new Date('2026-07-15T09:12:00Z'),
            targetDates: [
              { targetDate: new Date('2026-07-21T00:00:00Z') },
              { targetDate: new Date('2026-07-22T00:00:00Z') },
            ],
          },
        ])
        .mockResolvedValueOnce([]); // 취소 요청 진행 여부 배치 조회 — 없음

      const result = await service.getMyRequests(4n);

      expect(prisma.approvalRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            requesterId: 4n,
            type: { in: expect.arrayContaining([ApprovalRequestType.ANNUAL]) },
            status: {
              notIn: [
                ApprovalRequestStatus.CANCELED,
                ApprovalRequestStatus.CANCELED_AFTER_APPROVAL,
              ],
            },
          }),
        }),
      );
      expect(result).toEqual([
        {
          id: '1',
          type: ApprovalRequestType.ANNUAL,
          status: ApprovalRequestStatus.PENDING,
          targetDates: ['2026-07-21', '2026-07-22'],
          reason: null,
          isRetroactive: false,
          pendingCancellation: false,
          createdAt: '2026-07-15T09:12:00.000Z',
        },
      ]);
    });

    it('취소 요청이 진행 중인 건은 pendingCancellation: true를 반환한다', async () => {
      prisma.approvalRequest.findMany
        .mockResolvedValueOnce([
          {
            id: 1n,
            type: ApprovalRequestType.ANNUAL,
            status: ApprovalRequestStatus.INTERIM_APPROVED,
            reason: null,
            isRetroactive: false,
            createdAt: new Date('2026-07-15T09:12:00Z'),
            targetDates: [{ targetDate: new Date('2026-07-21T00:00:00Z') }],
          },
        ])
        .mockResolvedValueOnce([{ refRequestId: 1n }]);

      const result = await service.getMyRequests(4n);

      expect(result[0].pendingCancellation).toBe(true);
    });
  });

  describe('submitRequest', () => {
    const dto: CreateLeaveRequestDto = {
      type: ApprovalRequestType.ANNUAL,
      targetDates: ['2026-07-21', '2026-07-22'],
    };

    it('idempotencyKey가 이미 존재하고 같은 사용자·내용이면 새로 만들지 않고 기존 건을 반환한다', async () => {
      const existing = {
        id: 5n,
        facilityId: 1n,
        requesterId: 4n,
        type: ApprovalRequestType.ANNUAL,
        status: ApprovalRequestStatus.PENDING,
        reason: null,
        isRetroactive: false,
        createdAt: new Date('2026-07-15T09:12:00Z'),
        targetDates: [
          { targetDate: new Date('2026-07-21T00:00:00Z') },
          { targetDate: new Date('2026-07-22T00:00:00Z') },
        ],
      };
      prisma.approvalRequest.findUnique.mockResolvedValue(existing);
      prisma.approvalRequest.findMany.mockResolvedValueOnce([]); // 취소 요청 진행 여부 조회 — 없음

      const result = await service.submitRequest(4n, 1n, {
        ...dto,
        idempotencyKey: 'a0000000-0000-0000-0000-000000000000',
      });

      expect(result.id).toBe('5');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('idempotencyKey가 다른 사용자 소유면 그 건을 반환하지 않고 거부한다', async () => {
      const existing = {
        id: 5n,
        facilityId: 1n,
        requesterId: 999n, // 다른 사용자
        type: ApprovalRequestType.ANNUAL,
        status: ApprovalRequestStatus.PENDING,
        reason: null,
        isRetroactive: false,
        createdAt: new Date('2026-07-15T09:12:00Z'),
        targetDates: [
          { targetDate: new Date('2026-07-21T00:00:00Z') },
          { targetDate: new Date('2026-07-22T00:00:00Z') },
        ],
      };
      prisma.approvalRequest.findUnique.mockResolvedValue(existing);

      await expect(
        service.submitRequest(4n, 1n, { ...dto, idempotencyKey: 'a0000000-0000-0000-0000-000000000000' }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('같은 사용자가 같은 키를 다른 내용으로 재사용하면 거부한다', async () => {
      const existing = {
        id: 5n,
        facilityId: 1n,
        requesterId: 4n,
        type: ApprovalRequestType.ANNUAL,
        status: ApprovalRequestStatus.PENDING,
        reason: null,
        isRetroactive: false,
        createdAt: new Date('2026-07-15T09:12:00Z'),
        targetDates: [{ targetDate: new Date('2026-07-01T00:00:00Z') }], // 이번 요청과 다른 날짜
      };
      prisma.approvalRequest.findUnique.mockResolvedValue(existing);

      await expect(
        service.submitRequest(4n, 1n, { ...dto, idempotencyKey: 'a0000000-0000-0000-0000-000000000000' }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('결재선을 스냅샷하고 신청을 생성한 뒤 reserved를 가산한다', async () => {
      tx.approvalRequestDate.findFirst.mockResolvedValue(null);
      tx.approvalLine.findMany.mockResolvedValue([
        line(1, { approverId: 3n, deputyId: 2n }),
        line(2, { approverRole: 'OFFICE_MANAGER' }),
      ]);
      tx.employee.findFirst.mockResolvedValue({ id: 2n });
      tx.approvalRequest.create.mockResolvedValue({
        id: 11n,
        type: ApprovalRequestType.ANNUAL,
        status: ApprovalRequestStatus.PENDING,
        reason: null,
        isRetroactive: false,
        createdAt: new Date('2026-07-20T00:00:00Z'),
        targetDates: [
          { targetDate: new Date('2026-07-21T00:00:00Z') },
          { targetDate: new Date('2026-07-22T00:00:00Z') },
        ],
      });

      const result = await service.submitRequest(4n, 1n, dto);

      expect(tx.employee.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ facilityId: 1n, jobRole: JobRole.OFFICE_MANAGER }),
        }),
      );
      expect(tx.approvalRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            facilityId: 1n,
            requesterId: 4n,
            type: ApprovalRequestType.ANNUAL,
            leaveDays: '2.0',
            requestLines: {
              create: [
                { stepNo: 1, approverId: 3n, deputyId: 2n, delegationEnabled: false },
                { stepNo: 2, approverId: 2n, deputyId: null, delegationEnabled: false },
              ],
            },
            histories: { create: [{ actorId: 4n, action: ApprovalAction.SUBMIT }] },
          }),
        }),
      );
      expect(tx.leaveBalance.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { employeeId_balanceYear: { employeeId: 4n, balanceYear: 2026 } },
          update: { reserved: { increment: '2.0' } },
        }),
      );
      expect(result.id).toBe('11');
    });

    it('반차인데 날짜가 2건이면 거부한다', async () => {
      await expect(
        service.submitRequest(4n, 1n, {
          type: ApprovalRequestType.HALF_AM,
          targetDates: ['2026-07-21', '2026-07-22'],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('같은 날짜에 진행 중인 신청이 있으면 거부한다(D-2)', async () => {
      tx.approvalRequestDate.findFirst.mockResolvedValue({ requestId: 1n, targetDate: new Date('2026-07-21') });

      await expect(service.submitRequest(4n, 1n, dto)).rejects.toThrow(ConflictException);
    });
  });

  describe('cancelRequest', () => {
    it('본인의 PENDING 건을 취소하고 reserved를 반환한다', async () => {
      const leaveDays = decimal('2.0');
      tx.approvalRequest.findUnique.mockResolvedValue({
        id: 1n,
        requesterId: 4n,
        status: ApprovalRequestStatus.PENDING,
        type: ApprovalRequestType.ANNUAL,
        leaveDays,
        createdAt: new Date('2026-07-15T00:00:00Z'),
        targetDates: [{ targetDate: new Date('2026-07-21T00:00:00Z') }],
      });
      tx.approvalRequest.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.cancelRequest(4n, '1');

      expect(result).toEqual({ result: 'CANCELED' });
      expect(tx.approvalRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1n, status: ApprovalRequestStatus.PENDING },
          data: expect.objectContaining({ status: ApprovalRequestStatus.CANCELED }),
        }),
      );
      expect(tx.leaveBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { employeeId_balanceYear: { employeeId: 4n, balanceYear: 2026 } },
          data: { reserved: { decrement: leaveDays } },
        }),
      );
      expect(tx.approvalHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: ApprovalAction.CANCEL }) }),
      );
    });

    it('1차 이상 승인(INTERIM_APPROVED)된 건은 즉시 취소하지 않고 취소 요청을 생성한다 — 결재라인 1단계 + 결재선 전원이 후보', async () => {
      tx.approvalRequest.findUnique.mockResolvedValue({
        id: 1n,
        facilityId: 1n,
        requesterId: 4n,
        status: ApprovalRequestStatus.INTERIM_APPROVED,
        type: ApprovalRequestType.ANNUAL,
        leaveDays: decimal('2.0'),
        createdAt: new Date('2026-07-15T00:00:00Z'),
        targetDates: [{ targetDate: new Date('2026-07-21T00:00:00Z') }],
      });
      // 시설 결재선은 3단계(사회복지사→사무국장→시설장)지만, 취소 요청은 이 3명을
      // 모두 stepNo=1의 결재자 후보로 스냅샷한다 — 누구든 결재하면 즉시 종결.
      tx.approvalLine.findMany.mockResolvedValue([
        line(1, { approverId: 3n }),
        line(2, { approverId: 2n }),
        line(3, { approverId: 1n }),
      ]);

      const result = await service.cancelRequest(4n, '1');

      expect(result).toEqual({ result: 'CANCELLATION_REQUESTED' });
      // 원건은 건드리지 않는다 — reserved 유지, 상태 전이 없음
      expect(tx.approvalRequest.updateMany).not.toHaveBeenCalled();
      expect(tx.leaveBalance.update).not.toHaveBeenCalled();
      expect(tx.approvalRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: ApprovalRequestType.CANCEL,
            refRequestId: 1n,
            requesterId: 4n,
            requestLines: {
              create: [
                { stepNo: 1, approverId: 3n, deputyId: null, delegationEnabled: false },
                { stepNo: 1, approverId: 2n, deputyId: null, delegationEnabled: false },
                { stepNo: 1, approverId: 1n, deputyId: null, delegationEnabled: false },
              ],
            },
          }),
        }),
      );
    });

    it('취소 요청 결재자 후보는 중복 제거된다(같은 사람이 여러 역할을 겸임하는 경우)', async () => {
      tx.approvalRequest.findUnique.mockResolvedValue({
        id: 1n,
        facilityId: 1n,
        requesterId: 4n,
        status: ApprovalRequestStatus.INTERIM_APPROVED,
        type: ApprovalRequestType.ANNUAL,
        leaveDays: decimal('2.0'),
        createdAt: new Date('2026-07-15T00:00:00Z'),
        targetDates: [{ targetDate: new Date('2026-07-21T00:00:00Z') }],
      });
      tx.approvalLine.findMany.mockResolvedValue([
        line(1, { approverId: 3n }),
        line(2, { approverId: 3n }),
      ]);

      await service.cancelRequest(4n, '1');

      expect(tx.approvalRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            requestLines: {
              create: [{ stepNo: 1, approverId: 3n, deputyId: null, delegationEnabled: false }],
            },
          }),
        }),
      );
    });

    it('이미 취소 요청이 진행 중이면 중복 생성하지 않고 거부한다', async () => {
      tx.approvalRequest.findUnique.mockResolvedValue({
        id: 1n,
        facilityId: 1n,
        requesterId: 4n,
        status: ApprovalRequestStatus.INTERIM_APPROVED,
        type: ApprovalRequestType.ANNUAL,
        leaveDays: decimal('2.0'),
        createdAt: new Date('2026-07-15T00:00:00Z'),
        targetDates: [{ targetDate: new Date('2026-07-21T00:00:00Z') }],
      });
      tx.approvalRequest.findFirst.mockResolvedValue({ id: 99n, refRequestId: 1n });

      await expect(service.cancelRequest(4n, '1')).rejects.toThrow(ConflictException);
      expect(tx.approvalRequest.create).not.toHaveBeenCalled();
    });

    it('본인 소유가 아니면 NotFoundException', async () => {
      tx.approvalRequest.findUnique.mockResolvedValue({
        id: 1n,
        requesterId: 999n,
        status: ApprovalRequestStatus.PENDING,
      });

      await expect(service.cancelRequest(4n, '1')).rejects.toThrow(NotFoundException);
    });

    it('이미 종결된 건(REJECTED/CANCELED 등)은 ConflictException', async () => {
      tx.approvalRequest.findUnique.mockResolvedValue({
        id: 1n,
        requesterId: 4n,
        status: ApprovalRequestStatus.REJECTED,
      });

      await expect(service.cancelRequest(4n, '1')).rejects.toThrow(ConflictException);
    });

    it('최종 승인(APPROVED)된 건도 즉시 취소하지 않고 취소 요청을 생성한다', async () => {
      tx.approvalRequest.findUnique.mockResolvedValue({
        id: 1n,
        facilityId: 1n,
        requesterId: 4n,
        status: ApprovalRequestStatus.APPROVED,
        type: ApprovalRequestType.ANNUAL,
        leaveDays: decimal('2.0'),
        createdAt: new Date('2026-07-15T00:00:00Z'),
        targetDates: [{ targetDate: new Date('2026-07-21T00:00:00Z') }],
      });
      tx.approvalLine.findMany.mockResolvedValue([
        line(1, { approverId: 3n }),
        line(2, { approverId: 2n }),
        line(3, { approverId: 1n }),
      ]);

      const result = await service.cancelRequest(4n, '1');

      expect(result).toEqual({ result: 'CANCELLATION_REQUESTED' });
      // 원건은 건드리지 않는다 — used 유지, 상태 전이는 취소 요청이 승인될 때 이루어진다
      expect(tx.approvalRequest.updateMany).not.toHaveBeenCalled();
      expect(tx.leaveBalance.update).not.toHaveBeenCalled();
      expect(tx.approvalRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: ApprovalRequestType.CANCEL,
            refRequestId: 1n,
            requesterId: 4n,
          }),
        }),
      );
    });
  });
});
