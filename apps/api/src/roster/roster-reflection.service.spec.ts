import { ApprovalRequestType, Prisma } from '@prisma/client';
import { RosterReflectionService } from './roster-reflection.service';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventBus } from '../events/domain-event-bus';
import {
  ApprovalReflectionPayload,
  ApprovalRevertPayload,
  REQUEST_APPROVED,
  REQUEST_REVERTED,
  REQUEST_STEP_APPROVED,
} from '../events/domain-events';

// §4.10 결재 이벤트 구독 → 근무표 셀 반영/원복 검증. onModuleInit이 등록하는 핸들러를
// bus mock으로 가로채 직접 호출하는 방식으로, 실제 EventEmitter 배선 없이 로직만 검증한다.
// $transaction은 콜백에 동일한 prisma mock을 tx로 넘겨 호출하는 것으로 대체한다.

type PrismaMock = {
  roster: { findUnique: jest.Mock };
  shiftType: { findUnique: jest.Mock };
  scheduleEntry: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  $transaction: jest.Mock;
};

type ReflectionOrRevertPayload =
  ApprovalReflectionPayload | ApprovalRevertPayload;
type Handler = (payload: ReflectionOrRevertPayload) => void | Promise<void>;

/** expect.objectContaining이 any를 반환해 no-unsafe-assignment에 걸리는 것을 우회하는 타입 헬퍼 */
const containing = <T extends object>(obj: T): T =>
  expect.objectContaining(obj) as T;

describe('RosterReflectionService', () => {
  let prisma: PrismaMock;
  let handlers: Record<string, Handler>;
  let service: RosterReflectionService;

  const reflectionPayload = (
    over: Partial<ApprovalReflectionPayload> = {},
  ): ApprovalReflectionPayload => ({
    requestId: 1n,
    facilityId: 1n,
    requesterId: 5n,
    type: ApprovalRequestType.ANNUAL,
    targetDates: ['2026-07-21'],
    desiredShiftId: null,
    desiredStartTime: null,
    desiredEndTime: null,
    ...over,
  });

  const revertPayload = (
    over: Partial<ApprovalRevertPayload> = {},
  ): ApprovalRevertPayload => ({
    requestId: 1n,
    facilityId: 1n,
    requesterId: 5n,
    targetDates: ['2026-07-21'],
    ...over,
  });

  beforeEach(() => {
    prisma = {
      roster: { findUnique: jest.fn() },
      shiftType: { findUnique: jest.fn() },
      scheduleEntry: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn((cb: (tx: PrismaMock) => Promise<unknown>) =>
        cb(prisma),
      ),
    };
    handlers = {};
    const bus = {
      subscribe: jest.fn((event: string, handler: Handler) => {
        handlers[event] = handler;
      }),
    };
    service = new RosterReflectionService(
      prisma as unknown as PrismaService,
      bus as unknown as DomainEventBus,
    );
    service.onModuleInit();
  });

  describe('반영(reflect)', () => {
    it('셀이 없던 날짜 → 1차 승인(step_approved)으로 가반영 셀 생성', async () => {
      prisma.roster.findUnique.mockResolvedValue({ id: 100n });
      prisma.shiftType.findUnique.mockResolvedValue({ id: 200n });

      await handlers[REQUEST_STEP_APPROVED](reflectionPayload());

      expect(prisma.scheduleEntry.create).toHaveBeenCalledWith({
        data: containing({
          rosterId: 100n,
          employeeId: 5n,
          workDate: new Date('2026-07-21'),
          shiftTypeId: 200n,
          source: 'APPROVAL',
          isProvisional: true,
          sourceRequestId: 1n,
        }),
      });
      expect(prisma.scheduleEntry.update).not.toHaveBeenCalled();
    });

    it('같은 요청이 이미 가반영해둔 셀을 최종 승인으로 확정할 때는 스냅샷을 다시 찍지 않는다', async () => {
      prisma.roster.findUnique.mockResolvedValue({ id: 100n });
      prisma.shiftType.findUnique.mockResolvedValue({ id: 200n });
      prisma.scheduleEntry.findUnique.mockResolvedValue({
        id: 7n,
        shiftTypeId: 200n,
        source: 'APPROVAL',
        isProvisional: true,
        overrideStartTime: null,
        overrideEndTime: null,
        sourceRequestId: 1n, // 같은 요청이 만든 셀
        sourceLedgerId: null,
      });

      await handlers[REQUEST_APPROVED](reflectionPayload());

      // preApprovalSnapshot 키 자체가 없어야 한다(있으면 이전 값을 실수로 덮어씀) — 정확히
      // 이 필드들로만 구성된 호출인지 exact match로 확인한다.
      expect(prisma.scheduleEntry.update).toHaveBeenCalledWith({
        where: { id: 7n },
        data: {
          shiftTypeId: 200n,
          source: 'APPROVAL',
          isProvisional: false,
          sourceRequestId: 1n,
          overrideStartTime: null,
          overrideEndTime: null,
        },
      });
    });

    it('가반영이 기존 수동 셀을 최초로 덮어쓸 때는 이전 상태를 스냅샷으로 남긴다(P1)', async () => {
      prisma.roster.findUnique.mockResolvedValue({ id: 100n });
      prisma.shiftType.findUnique.mockResolvedValue({ id: 200n });
      prisma.scheduleEntry.findUnique.mockResolvedValue({
        id: 7n,
        shiftTypeId: 999n,
        source: 'MANUAL',
        isProvisional: false,
        overrideStartTime: null,
        overrideEndTime: null,
        sourceRequestId: null, // 이 요청이 아닌, 관리자가 수동으로 넣어둔 셀
        sourceLedgerId: null,
      });

      await handlers[REQUEST_STEP_APPROVED](reflectionPayload());

      expect(prisma.scheduleEntry.update).toHaveBeenCalledWith({
        where: { id: 7n },
        data: containing({
          shiftTypeId: 200n,
          isProvisional: true,
          preApprovalSnapshot: {
            shiftTypeId: '999',
            source: 'MANUAL',
            isProvisional: false,
            overrideStartTime: null,
            overrideEndTime: null,
            sourceRequestId: null,
            sourceLedgerId: null,
          },
        }),
      });
    });

    it('CANCEL 유형은 반영 대상이 아니다', async () => {
      await handlers[REQUEST_APPROVED](
        reflectionPayload({ type: ApprovalRequestType.CANCEL }),
      );

      expect(prisma.roster.findUnique).not.toHaveBeenCalled();
      expect(prisma.scheduleEntry.create).not.toHaveBeenCalled();
      expect(prisma.scheduleEntry.update).not.toHaveBeenCalled();
    });

    it('해당 월 근무표가 없으면 스킵한다', async () => {
      prisma.roster.findUnique.mockResolvedValue(null);
      prisma.shiftType.findUnique.mockResolvedValue({ id: 200n });

      await handlers[REQUEST_APPROVED](reflectionPayload());

      expect(prisma.scheduleEntry.create).not.toHaveBeenCalled();
      expect(prisma.scheduleEntry.update).not.toHaveBeenCalled();
    });

    it('근무유형 코드 매핑이 없으면 스킵한다', async () => {
      prisma.roster.findUnique.mockResolvedValue({ id: 100n });
      prisma.shiftType.findUnique.mockResolvedValue(null);

      await handlers[REQUEST_APPROVED](reflectionPayload());

      expect(prisma.scheduleEntry.create).not.toHaveBeenCalled();
    });

    it('SHIFT_CHANGE는 desiredShiftId를 그대로 쓰고 override 시각을 반영한다', async () => {
      prisma.roster.findUnique.mockResolvedValue({ id: 100n });

      await handlers[REQUEST_APPROVED](
        reflectionPayload({
          type: ApprovalRequestType.SHIFT_CHANGE,
          desiredShiftId: 300n,
          desiredStartTime: new Date('1970-01-01T07:30:00Z'),
          desiredEndTime: new Date('1970-01-01T17:00:00Z'),
        }),
      );

      expect(prisma.shiftType.findUnique).not.toHaveBeenCalled();
      expect(prisma.scheduleEntry.create).toHaveBeenCalledWith({
        data: containing({
          shiftTypeId: 300n,
          overrideStartTime: new Date('1970-01-01T07:30:00Z'),
          overrideEndTime: new Date('1970-01-01T17:00:00Z'),
        }),
      });
    });

    it('반영 중 예외가 나도 로그만 남기고 전파하지 않는다', async () => {
      prisma.roster.findUnique.mockRejectedValue(new Error('db down'));

      await expect(
        handlers[REQUEST_APPROVED](reflectionPayload()),
      ).resolves.toBeUndefined();
    });
  });

  describe('원복(revert)', () => {
    it('스냅샷이 없으면(애초에 셀이 없었던 경우) 셀을 삭제한다', async () => {
      prisma.scheduleEntry.findUnique.mockResolvedValue({
        id: 7n,
        sourceRequestId: 1n,
        preApprovalSnapshot: null,
      });

      await handlers[REQUEST_REVERTED](revertPayload());

      expect(prisma.scheduleEntry.delete).toHaveBeenCalledWith({
        where: { id: 7n },
      });
      expect(prisma.scheduleEntry.update).not.toHaveBeenCalled();
    });

    it('스냅샷이 있으면(가반영이 기존 수동 셀을 덮어쓴 경우) 그 상태로 복원한다(P1)', async () => {
      prisma.scheduleEntry.findUnique.mockResolvedValue({
        id: 7n,
        sourceRequestId: 1n,
        preApprovalSnapshot: {
          shiftTypeId: '999',
          source: 'MANUAL',
          isProvisional: false,
          overrideStartTime: null,
          overrideEndTime: null,
          sourceRequestId: null,
          sourceLedgerId: null,
        },
      });

      await handlers[REQUEST_REVERTED](revertPayload());

      expect(prisma.scheduleEntry.update).toHaveBeenCalledWith({
        where: { id: 7n },
        data: {
          shiftTypeId: 999n,
          source: 'MANUAL',
          isProvisional: false,
          overrideStartTime: null,
          overrideEndTime: null,
          sourceRequestId: null,
          sourceLedgerId: null,
          preApprovalSnapshot: Prisma.DbNull,
        },
      });
      expect(prisma.scheduleEntry.delete).not.toHaveBeenCalled();
    });

    it('셀의 sourceRequestId가 이 요청과 다르면(다른 근거로 이미 덮어써짐) 건드리지 않는다', async () => {
      prisma.scheduleEntry.findUnique.mockResolvedValue({
        id: 7n,
        sourceRequestId: 999n,
        preApprovalSnapshot: null,
      });

      await handlers[REQUEST_REVERTED](revertPayload());

      expect(prisma.scheduleEntry.delete).not.toHaveBeenCalled();
      expect(prisma.scheduleEntry.update).not.toHaveBeenCalled();
    });

    it('삭제할 셀이 없어도(가반영 전 반려 등) 예외 없이 종료된다', async () => {
      prisma.scheduleEntry.findUnique.mockResolvedValue(null);

      await expect(
        handlers[REQUEST_REVERTED](revertPayload()),
      ).resolves.toBeUndefined();
      expect(prisma.scheduleEntry.delete).not.toHaveBeenCalled();
    });

    it('대상일이 여러 건이어도 하나의 트랜잭션으로 묶어 처리한다(P2)', async () => {
      prisma.scheduleEntry.findUnique.mockResolvedValue({
        id: 7n,
        sourceRequestId: 1n,
        preApprovalSnapshot: null,
      });

      await handlers[REQUEST_REVERTED](
        revertPayload({ targetDates: ['2026-07-21', '2026-07-22'] }),
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.scheduleEntry.delete).toHaveBeenCalledTimes(2);
    });

    it('원복 중 예외가 나도 로그만 남기고 전파하지 않는다', async () => {
      prisma.scheduleEntry.findUnique.mockRejectedValue(new Error('db down'));

      await expect(
        handlers[REQUEST_REVERTED](revertPayload()),
      ).resolves.toBeUndefined();
    });
  });
});
