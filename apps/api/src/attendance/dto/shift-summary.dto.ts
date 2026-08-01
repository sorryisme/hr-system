import { ApiProperty } from '@nestjs/swagger';

/// 홈 화면(B-2) "오늘은 야간 근무입니다 · 17:50~다음날 09:00" 문장용 요약.
/// startTime/endTime은 "HH:mm" — ShiftType의 Time(0) 컬럼을 서비스에서 포맷해 내려준다.
/// nestjs/swagger는 클래스명을 컴포넌트 스키마 키로 쓴다 — approvals/roster에 이미 동명 계열
/// DTO(ShiftTypeSummaryDto/RosterShiftTypeSummaryDto)가 있어 충돌 방지를 위해 도메인 접두어를 붙인다
/// (근거: 커밋 161eb38 — 근무유형 DTO 클래스명 충돌로 결재 desiredShift 스키마 손상).
export class AttendanceShiftSummaryDto {
  @ApiProperty()
  label!: string;

  @ApiProperty({ type: String, nullable: true })
  startTime!: string | null;

  @ApiProperty({ type: String, nullable: true })
  endTime!: string | null;

  @ApiProperty()
  crossesMidnight!: boolean;
}
