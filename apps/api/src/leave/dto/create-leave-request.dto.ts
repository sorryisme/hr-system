import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApprovalRequestType } from '@prisma/client';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/// 모바일에서 신청 가능한 유형만 허용. SHIFT_CHANGE/CANCEL은 이 엔드포인트의 대상이 아니다
export const LEAVE_REQUEST_TYPES = [
  ApprovalRequestType.ANNUAL,
  ApprovalRequestType.HALF_AM,
  ApprovalRequestType.HALF_PM,
  ApprovalRequestType.SUBSTITUTE_HOLIDAY,
] as const;

export type LeaveRequestType = (typeof LEAVE_REQUEST_TYPES)[number];

export class CreateLeaveRequestDto {
  @ApiProperty({ enum: LEAVE_REQUEST_TYPES, enumName: 'LeaveRequestType' })
  @IsIn(LEAVE_REQUEST_TYPES)
  type!: LeaveRequestType;

  /// 반차·유대는 1건만 허용(서비스 레벨 검증). 연차는 다중일 지원
  @ApiProperty({ type: [String], description: 'YYYY-MM-DD' })
  @IsArray()
  @ArrayNotEmpty({ message: '신청할 날짜를 선택해 주세요.' })
  @IsDateString({}, { each: true })
  targetDates!: string[];

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  /// 더블탭 중복 제출 방지(schema idempotency_key). 클라이언트가 생성해 전달하면
  /// 동일 키 재요청 시 새로 만들지 않고 기존 건을 그대로 반환한다
  @ApiPropertyOptional({ description: '더블탭 중복 제출 방지용 클라이언트 생성 UUID' })
  @IsOptional()
  @IsUUID()
  idempotencyKey?: string;
}
