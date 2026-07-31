import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

/// 프리셋 적용(§4.6/§4.8) 요청. 직원 행 우클릭 → "프리셋 적용"(패턴 + 조 + 시작일 + 적용 기간).
export class ApplyPresetDto {
  @ApiProperty({ type: String, description: 'shift_pattern_preset.id' })
  @IsString()
  @IsNotEmpty()
  presetId!: string;

  @ApiProperty({ description: '조 번호(1=A조, 2=B조, 3=C조 …)' })
  @IsInt()
  @Min(1)
  teamNo!: number;

  @ApiProperty({ type: [String], description: '적용 대상 직원 id 목록' })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  employeeIds!: string[];

  @ApiProperty({ description: 'YYYY-MM-DD, 적용 시작일' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'startDate는 YYYY-MM-DD 형식이어야 합니다.',
  })
  startDate!: string;

  /// 생략 시 근무표 해당 월의 말일까지 적용한다.
  @ApiPropertyOptional({ description: 'YYYY-MM-DD, 적용 종료일(포함)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'endDate는 YYYY-MM-DD 형식이어야 합니다.',
  })
  endDate?: string;
}

export class ApplyPresetSkipDto {
  @ApiProperty({ type: String })
  employeeId!: string;

  @ApiProperty({ description: 'YYYY-MM-DD' })
  workDate!: string;

  @ApiProperty({ description: '건너뛴 사유 코드(예: PROTECTED_CELL)' })
  reason!: string;
}

/// 프리셋 적용 결과. 승인·수동 편집 셀은 건너뛰므로(§4.8 셀 보호 원칙) skipped로 함께 보고한다.
export class ApplyPresetResultDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ description: '적용/갱신된 셀 수' })
  appliedCount!: number;

  @ApiProperty({ type: [ApplyPresetSkipDto] })
  skipped!: ApplyPresetSkipDto[];
}
