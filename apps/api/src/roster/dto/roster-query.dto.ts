import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export class RosterQueryDto {
  /// 조회 대상 월(YYYY-MM). facilityId는 세션 사용자에서 결정한다(멀티테넌트 격리 — 앱 레벨).
  @ApiProperty({ example: '2026-07', description: 'YYYY-MM' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'yearMonth는 YYYY-MM 형식이어야 합니다.',
  })
  yearMonth!: string;
}
