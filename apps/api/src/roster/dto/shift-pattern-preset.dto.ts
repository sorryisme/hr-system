import { ApiProperty } from '@nestjs/swagger';

/// 프리셋 상세 1일차 항목(조×일차 → 근무유형). 프론트 프리셋 적용 다이얼로그의 패턴 미리보기용.
export class ShiftPatternItemDto {
  @ApiProperty({ description: '조 번호(1=A조, 2=B조, 3=C조 …)' })
  teamNo!: number;

  @ApiProperty({ description: '주기 내 일차(1..cycleDays)' })
  dayIndex!: number;

  @ApiProperty({ description: 'shift_type.code' })
  shiftCode!: string;

  @ApiProperty({ description: 'shift_type.cell_label', nullable: true })
  cellLabel!: string | null;
}

/// 근무 패턴 프리셋 목록 조회(§4.6) 응답 — 프리셋 적용 다이얼로그의 선택지.
export class ShiftPatternPresetSummaryDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ description: '패턴 주기(주야비=6)' })
  cycleDays!: number;

  @ApiProperty({ description: '조 수(주야비=3: A/B/C)' })
  teamCount!: number;

  @ApiProperty({ type: [ShiftPatternItemDto] })
  items!: ShiftPatternItemDto[];
}
