import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RosterStatus, ValidationSeverity } from '@prisma/client';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

/// 마감(close) 요청. 위반(BLOCK)이 있으면 원칙 차단, 시설장/사무국장이 사유 입력 시 강행(D-19).
export class CloseRosterDto {
  @ApiPropertyOptional({
    default: false,
    description: '위반 존재 시 강행 마감(D-19)',
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @ApiPropertyOptional({ description: '강행 마감 사유 — force=true 시 필수' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class ValidationFindingDto {
  @ApiProperty({ example: 'MIN_STAFFING_DAY' })
  ruleCode!: string;

  @ApiProperty({ enum: ValidationSeverity, enumName: 'ValidationSeverity' })
  severity!: ValidationSeverity;

  @ApiProperty({
    type: Object,
    nullable: true,
    description: '산정 근거(날짜/실인원/필요인원 등)',
  })
  detail!: Record<string, unknown> | null;
}

/// 상태 전이 결과. 검증을 수행하는 전이(마감)는 violations를 함께 반환한다.
export class RosterTransitionResultDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ enum: RosterStatus, enumName: 'RosterStatus' })
  status!: RosterStatus;

  @ApiProperty({ type: [ValidationFindingDto] })
  violations!: ValidationFindingDto[];
}
