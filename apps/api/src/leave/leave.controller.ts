import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators';
import { SessionUserDto } from '../auth/dto/session-user.dto';
import { CancelLeaveRequestResponseDto } from './dto/cancel-leave-request-response.dto';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { LeaveBalanceResponseDto } from './dto/leave-balance.dto';
import { LeaveService } from './leave.service';
import { MyLeaveRequestDto } from './dto/my-leave-request.dto';

// 본인 데이터 조회 전용(모바일 종사자 웹뷰). 결재자용 /requests(approvals:read/decide)와 달리
// 별도 권한 없이 전역 JwtAuthGuard만으로 충분하다 — auth/me와 동일하게 @CurrentUser로
// 본인 것만 조회하므로 권한 분기가 필요 없다.
@ApiTags('leave')
@Controller('leave')
export class LeaveController {
  constructor(private readonly leaveService: LeaveService) {}

  @Get('balance')
  @ApiOkResponse({ type: LeaveBalanceResponseDto })
  getBalance(
    @CurrentUser() user: SessionUserDto,
  ): Promise<LeaveBalanceResponseDto> {
    return this.leaveService.getBalance(BigInt(user.id));
  }

  @Get('requests')
  @ApiOkResponse({ type: [MyLeaveRequestDto] })
  getMyRequests(
    @CurrentUser() user: SessionUserDto,
  ): Promise<MyLeaveRequestDto[]> {
    return this.leaveService.getMyRequests(BigInt(user.id));
  }

  @Post('requests')
  @HttpCode(201)
  @ApiOkResponse({ type: MyLeaveRequestDto })
  submitRequest(
    @CurrentUser() user: SessionUserDto,
    @Body() body: CreateLeaveRequestDto,
  ): Promise<MyLeaveRequestDto> {
    return this.leaveService.submitRequest(
      BigInt(user.id),
      BigInt(user.facilityId),
      body,
    );
  }

  /// PENDING 건은 즉시 취소되지만, 1차 이상 승인(INTERIM_APPROVED)된 건은 관리자 승인이
  /// 필요한 취소 요청만 접수한다 — 응답의 result로 어느 쪽인지 구분한다.
  @Post('requests/:id/cancel')
  @HttpCode(200)
  @ApiOkResponse({ type: CancelLeaveRequestResponseDto })
  cancelRequest(
    @CurrentUser() user: SessionUserDto,
    @Param('id') id: string,
  ): Promise<CancelLeaveRequestResponseDto> {
    return this.leaveService.cancelRequest(BigInt(user.id), id);
  }
}
