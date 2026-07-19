import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

/// 결재함 탭 필터. PENDING 탭은 진행 중 전체(PENDING + INTERIM_APPROVED)를 묶어 보여준다(§3.3 A-3)
export enum InboxStatusFilter {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
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
