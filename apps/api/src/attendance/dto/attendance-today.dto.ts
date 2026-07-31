import { ApiProperty } from '@nestjs/swagger';
import { AttendanceShiftSummaryDto } from './shift-summary.dto';

export const ATTENDANCE_STATUSES = ['CLOCKED_OUT', 'CLOCKED_IN'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export class AttendanceTodayResponseDto {
  @ApiProperty({ enum: ATTENDANCE_STATUSES, enumName: 'AttendanceStatus' })
  status!: AttendanceStatus;

  @ApiProperty({ type: String, nullable: true })
  clockInAt!: string | null;

  /// 오늘(또는 진행 중인 야간근무 귀속일)에 배정된 근무. 배정이 없으면 null
  @ApiProperty({ type: AttendanceShiftSummaryDto, nullable: true })
  shift!: AttendanceShiftSummaryDto | null;

  /// 태그 실패 화면의 관리자 호출 버튼(C-11, A-6 설정값). 미설정 시 null
  @ApiProperty({ type: String, nullable: true })
  adminCallPhone!: string | null;
}
