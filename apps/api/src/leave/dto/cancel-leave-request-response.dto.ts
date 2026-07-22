import { ApiProperty } from '@nestjs/swagger';

export const CANCEL_RESULTS = ['CANCELED', 'CANCELLATION_REQUESTED'] as const;
export type CancelResult = (typeof CANCEL_RESULTS)[number];

/// PENDING 건은 즉시 취소(CANCELED)되지만, 1차 이상 승인(INTERIM_APPROVED)된 건은
/// 관리자 승인이 필요한 별도 취소 요청을 생성한다(CANCELLATION_REQUESTED) — 자기 취소가 아니다.
export class CancelLeaveRequestResponseDto {
  @ApiProperty({ enum: CANCEL_RESULTS, enumName: 'CancelResult' })
  result!: CancelResult;
}
