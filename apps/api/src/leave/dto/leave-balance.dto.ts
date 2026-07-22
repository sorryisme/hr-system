import { ApiProperty } from '@nestjs/swagger';

export class LeaveBalanceDetailDto {
  @ApiProperty({ type: String, example: '17.0' })
  granted!: string;

  @ApiProperty({ type: String, example: '1.0' })
  used!: string;

  @ApiProperty({ type: String, example: '0.5' })
  reserved!: string;

  @ApiProperty({ type: String, example: '15.5' })
  remaining!: string;
}

export class LeaveBalanceResponseDto {
  /// 입사일 기준 연차연도 시작 연도(schema.prisma LeaveBalance 주석 참고)
  @ApiProperty()
  balanceYear!: number;

  @ApiProperty({ type: LeaveBalanceDetailDto })
  annual!: LeaveBalanceDetailDto;

  @ApiProperty({ type: LeaveBalanceDetailDto })
  substituteHoliday!: LeaveBalanceDetailDto;
}
