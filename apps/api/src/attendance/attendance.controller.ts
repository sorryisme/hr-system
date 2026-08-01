import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators';
import { SessionUserDto } from '../auth/dto/session-user.dto';
import { AttendanceService } from './attendance.service';
import { AttendanceTodayResponseDto } from './dto/attendance-today.dto';
import { ClockTagRequestDto } from './dto/clock-tag-request.dto';
import { ClockTagResponseDto } from './dto/clock-tag-response.dto';

// 본인 출퇴근 태그 전용(모바일 종사자 웹뷰). leave.controller.ts와 동일하게 별도 권한 없이
// 전역 JwtAuthGuard + @CurrentUser로 본인 것만 조회·처리한다.
@ApiTags('attendance')
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get('today')
  @ApiOkResponse({ type: AttendanceTodayResponseDto })
  getToday(
    @CurrentUser() user: SessionUserDto,
  ): Promise<AttendanceTodayResponseDto> {
    return this.attendanceService.getToday(
      BigInt(user.id),
      BigInt(user.facilityId),
    );
  }

  @Post('clock-in')
  @HttpCode(200)
  @ApiOkResponse({ type: ClockTagResponseDto })
  clockIn(
    @CurrentUser() user: SessionUserDto,
    @Body() body: ClockTagRequestDto,
  ): Promise<ClockTagResponseDto> {
    return this.attendanceService.clockIn(
      BigInt(user.id),
      BigInt(user.facilityId),
      body,
    );
  }

  @Post('clock-out')
  @HttpCode(200)
  @ApiOkResponse({ type: ClockTagResponseDto })
  clockOut(
    @CurrentUser() user: SessionUserDto,
    @Body() body: ClockTagRequestDto,
  ): Promise<ClockTagResponseDto> {
    return this.attendanceService.clockOut(
      BigInt(user.id),
      BigInt(user.facilityId),
      body,
    );
  }
}
