import { ApiProperty } from '@nestjs/swagger';
import { JobRole, RosterStatus, ScheduleEntrySource } from '@prisma/client';
import { RosterValidationDto } from './roster-validation.dto';

/// 근무표 셀 1개(직원 × 일자). 시각·표기의 원천 규칙은 아래 필드 주석 참고.
export class RosterCellDto {
  @ApiProperty({ type: String })
  employeeId!: string;

  @ApiProperty({ description: 'YYYY-MM-DD' })
  workDate!: string;

  /// shift_type.code (D/N/NF/OFF/AL/HAM/HPM/SUB/SICK/ABS)
  @ApiProperty()
  shiftCode!: string;

  /// 셀 표기 문자(§4.7): 주/야/휴/연/오전/오후/유/병/결
  @ApiProperty({ type: String, nullable: true })
  cellLabel!: string | null;

  /// override_start_time ?? shift_type.start_time (HH:mm). 근무가 아닌 유형(휴/연 등)은 null
  @ApiProperty({ type: String, nullable: true, example: '08:50' })
  startTime!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '18:00' })
  endTime!: string | null;

  /// override_* 값이 있어 편집기·출력에 "근무종류(시작~종료)"로 표기해야 하는 셀(§4.8)
  @ApiProperty({ description: '셀 단위 시간 조정 여부(v1.3)' })
  isTimeOverridden!: boolean;

  /// [v1.2] 가반영(글자만) 여부 — step_approved 구독 시 true, approved 확정 시 false(§4.10)
  @ApiProperty()
  isProvisional!: boolean;

  @ApiProperty({ enum: ScheduleEntrySource, enumName: 'ScheduleEntrySource' })
  source!: ScheduleEntrySource;

  /// [v1.3] 유대(유) 셀의 "유(이월인정시간,분)" 표기용 — source_ledger 연동 시 이월가능시간(분)
  @ApiProperty({ type: Number, nullable: true })
  carryableMinutes!: number | null;
}

/// 근무표 세로축의 직원 1명
export class RosterEmployeeRowDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: JobRole, enumName: 'JobRole' })
  jobRole!: JobRole;
}

/// 팀별 그룹(요양1팀·2팀·지원팀 등). teamId가 null이면 미배정 그룹
export class RosterTeamGroupDto {
  @ApiProperty({ type: String, nullable: true })
  teamId!: string | null;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: [RosterEmployeeRowDto] })
  employees!: RosterEmployeeRowDto[];
}

/// 하단 요약행(날짜별). 근무 인원 합계 + 요양보호사 주/야 과부족(§4.5)
export class RosterDaySummaryDto {
  @ApiProperty({ description: 'YYYY-MM-DD' })
  workDate!: string;

  /// counts_as_work=true 셀 수(목업 "근무 인원")
  @ApiProperty()
  workingCount!: number;

  /// 요양보호사 주간 인원(주간 근무 유형)
  @ApiProperty()
  caregiverDay!: number;

  /// 요양보호사 야간 인원(자정 넘김 근무 유형)
  @ApiProperty()
  caregiverNight!: number;

  /// daily_staffing_rule(period=DAY) min_count 미달 여부
  @ApiProperty()
  dayShortage!: boolean;

  /// daily_staffing_rule(period=NIGHT) min_count 미달 여부
  @ApiProperty()
  nightShortage!: boolean;
}

export class RosterResponseDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ description: 'YYYY-MM' })
  yearMonth!: string;

  @ApiProperty({ enum: RosterStatus, enumName: 'RosterStatus' })
  status!: RosterStatus;

  /// 해당 월의 일수(1..daysInMonth) — 프론트 그리드 헤더 생성용
  @ApiProperty()
  daysInMonth!: number;

  @ApiProperty({ type: [RosterTeamGroupDto] })
  teams!: RosterTeamGroupDto[];

  @ApiProperty({ type: [RosterCellDto] })
  cells!: RosterCellDto[];

  @ApiProperty({ type: [RosterDaySummaryDto] })
  summary!: RosterDaySummaryDto[];

  /// 실시간 검증 패널(§4.8) — 월별 인력산정·가산 예상 점수(§4.2/§4.3)
  @ApiProperty({ type: RosterValidationDto })
  validation!: RosterValidationDto;
}
