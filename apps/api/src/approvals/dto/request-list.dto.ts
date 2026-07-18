import { ApiProperty } from '@nestjs/swagger';
import {
  ApprovalRequestStatus,
  ApprovalRequestType,
  JobRole,
} from '@prisma/client';

export class EmployeeSummaryDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: JobRole, enumName: 'JobRole' })
  jobRole!: JobRole;
}

export class ShiftTypeSummaryDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty()
  label!: string;
}

export class RequestListItemDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: EmployeeSummaryDto })
  requester!: EmployeeSummaryDto;

  @ApiProperty({ enum: ApprovalRequestType, enumName: 'ApprovalRequestType' })
  type!: ApprovalRequestType;

  @ApiProperty({
    enum: ApprovalRequestStatus,
    enumName: 'ApprovalRequestStatus',
  })
  status!: ApprovalRequestStatus;

  /// 완료된 결재 단계 수(§3.4)
  @ApiProperty()
  currentStep!: number;

  /// 제출 시점 결재선 스냅샷의 총 단계 수
  @ApiProperty()
  totalSteps!: number;

  @ApiProperty({ type: [String], description: 'YYYY-MM-DD' })
  targetDates!: string[];

  @ApiProperty({ type: ShiftTypeSummaryDto, nullable: true })
  desiredShift!: ShiftTypeSummaryDto | null;

  @ApiProperty({ type: String, nullable: true })
  reason!: string | null;

  /// 차감량(연차=일수, 반차=0.5, 유대=1.0). 조정/취소는 null. Decimal 문자열
  @ApiProperty({ type: String, nullable: true, example: '2.0' })
  leaveDays!: string | null;

  @ApiProperty({ description: '사후 신청 라벨(D-3)' })
  isRetroactive!: boolean;

  @ApiProperty({ description: '전결로 최종 확정된 건(D-13)' })
  isFinalByDelegation!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

export class InboxCountsDto {
  /// PENDING + INTERIM_APPROVED
  @ApiProperty()
  pending!: number;

  @ApiProperty()
  approved!: number;

  @ApiProperty()
  rejected!: number;
}

export class RequestListResponseDto {
  @ApiProperty({ type: [RequestListItemDto] })
  items!: RequestListItemDto[];

  @ApiProperty({ type: InboxCountsDto })
  counts!: InboxCountsDto;
}
