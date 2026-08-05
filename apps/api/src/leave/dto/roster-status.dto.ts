import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

/// 모바일 날짜 선택 화면에서 조회 중인 월에 근무표가 없으면 신청을 막기 위한 조회용 DTO.
/// roster:read 권한이 없는 종사자(STAFF)도 확인할 수 있도록 leave 모듈에 별도로 둔다.
export class RosterStatusQueryDto {
  /// 생략하면 서버 기준 당월을 조회한다.
  @ApiPropertyOptional({ example: '2026-07', description: 'YYYY-MM. 생략 시 당월' })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'yearMonth는 YYYY-MM 형식이어야 합니다.',
  })
  yearMonth?: string;
}

export class RosterStatusDto {
  @ApiProperty({ description: 'YYYY-MM' })
  yearMonth!: string;

  @ApiProperty()
  exists!: boolean;
}
