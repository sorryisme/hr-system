import { ApprovalRequestType } from '@prisma/client';

/// 결재 도메인 이벤트 이름(§2.3 이벤트 발행 방식).
///   - REQUEST_APPROVED      : 최종 승인 → 근무표 확정 반영(셀 색칠) + 잔여 차감(§4.10)
///   - REQUEST_STEP_APPROVED : 1차(사회복지사) 승인 → 근무표 가반영(글자만, is_provisional=true)
export const REQUEST_APPROVED = 'request.approved';
export const REQUEST_STEP_APPROVED = 'request.step_approved';

/// 결재 승인 이벤트 페이로드. 근무표 반영 구독자가 셀을 만들/갱신하는 데 필요한 최소 정보만 담는다.
/// (BigInt/Date 원형 그대로 — 같은 프로세스 내 인메모리 버스라 직렬화하지 않는다)
export interface ApprovalReflectionPayload {
  requestId: bigint;
  facilityId: bigint;
  requesterId: bigint;
  type: ApprovalRequestType;
  /// 대상 일자(YYYY-MM-DD). 연차 다중일 지원
  targetDates: string[];
  /// SHIFT_CHANGE 희망 근무유형
  desiredShiftId: bigint | null;
  /// [v1.3] SHIFT_CHANGE 희망 조정 시각 — 셀 override_*로 반영
  desiredStartTime: Date | null;
  desiredEndTime: Date | null;
}
