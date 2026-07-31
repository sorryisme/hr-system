import { ApiProperty } from '@nestjs/swagger';

/// 근무유형 목록(§4.7) — 셀 편집 팝오버의 선택지.
/// approvals/dto/request-list.dto.ts의 ShiftTypeSummaryDto(id, label)와 클래스명이 겹치면
/// nestjs/swagger가 동일한 컴포넌트 스키마로 취급해 한쪽을 덮어쓰므로 접두어로 구분한다.
export class RosterShiftTypeSummaryDto {
  @ApiProperty({ description: 'shift_type.code' })
  code!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({ type: String, nullable: true })
  cellLabel!: string | null;
}
