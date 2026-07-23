import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

/// 결재함 탭 필터. PENDING 탭은 진행 중 전체(PENDING + INTERIM_APPROVED)를 묶어 보여준다(§3.3 A-3).
/// CANCELED 탭은 종결된 취소 건(CANCELED + CANCELED_AFTER_APPROVAL)을 묶어 보여준다 —
/// 취소된 신청도 이후에 진행 이력을 확인할 수 있어야 한다.
export enum InboxStatusFilter {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELED = 'CANCELED',
}

export class InboxQueryDto {
  @ApiPropertyOptional({
    enum: InboxStatusFilter,
    enumName: 'InboxStatusFilter',
    default: InboxStatusFilter.PENDING,
  })
  @IsOptional()
  @IsEnum(InboxStatusFilter)
  status?: InboxStatusFilter;
}
