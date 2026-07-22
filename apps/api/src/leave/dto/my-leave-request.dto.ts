import { ApiProperty } from '@nestjs/swagger';
import { ApprovalRequestStatus, ApprovalRequestType } from '@prisma/client';

/// 본인 신청 조회 전용 DTO. type/status는 Prisma enum 전체를 재사용하지만,
/// 서비스 쿼리에서 연차·반차·유대(ANNUAL/HALF_AM/HALF_PM/SUBSTITUTE_HOLIDAY)와
/// 취소 상태 제외(status not in CANCELED/CANCELED_AFTER_APPROVAL)로 좁혀서 내려준다.
export class MyLeaveRequestDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ enum: ApprovalRequestType, enumName: 'ApprovalRequestType' })
  type!: ApprovalRequestType;

  @ApiProperty({
    enum: ApprovalRequestStatus,
    enumName: 'ApprovalRequestStatus',
  })
  status!: ApprovalRequestStatus;

  @ApiProperty({ type: [String], description: 'YYYY-MM-DD' })
  targetDates!: string[];

  @ApiProperty({ type: String, nullable: true })
  reason!: string | null;

  @ApiProperty({ description: '사후 신청 라벨(D-3)' })
  isRetroactive!: boolean;

  /// 1차 이상 승인(INTERIM_APPROVED) 이후 취소는 즉시 처리되지 않고 별도 취소 승인 요청을
  /// 만든다(CANCEL 타입, refRequestId=이 건). 그 요청이 결재 진행 중이면 true — 모바일은
  /// 이 값이 true인 동안 취소 버튼 대신 "취소 승인 대기중" 배지를 보여준다.
  @ApiProperty({ description: '취소 승인 요청이 진행 중인지 여부' })
  pendingCancellation!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}
