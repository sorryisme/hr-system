import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

/// 셀 1개 편집 입력. 근무유형은 code로 지정(shift_type.code). 시간 조정(§4.8)은 override* 선택.
export class RosterEntryInputDto {
  @ApiProperty({ type: String })
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @ApiProperty({ description: 'YYYY-MM-DD' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'workDate는 YYYY-MM-DD 형식이어야 합니다.',
  })
  workDate!: string;

  @ApiProperty({ description: 'shift_type.code (D/N/NF/OFF/AL/…)' })
  @IsString()
  @IsNotEmpty()
  shiftCode!: string;

  /// [v1.3] 셀 단위 조정 출근 시각. overrideEndTime과 함께 지정(둘 다 또는 둘 다 생략)
  @ApiPropertyOptional({ example: '07:30' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'HH:mm 형식이어야 합니다.' })
  overrideStartTime?: string;

  @ApiPropertyOptional({ example: '17:00' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'HH:mm 형식이어야 합니다.' })
  overrideEndTime?: string;
}

export class UpdateEntriesDto {
  @ApiProperty({ type: [RosterEntryInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RosterEntryInputDto)
  entries!: RosterEntryInputDto[];
}
