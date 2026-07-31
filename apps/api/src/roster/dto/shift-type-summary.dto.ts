import { ApiProperty } from '@nestjs/swagger';

/// 근무유형 목록(§4.7) — 셀 편집 팝오버의 선택지.
export class ShiftTypeSummaryDto {
  @ApiProperty({ description: 'shift_type.code' })
  code!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({ type: String, nullable: true })
  cellLabel!: string | null;
}
