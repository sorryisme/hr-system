import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { SessionUserDto } from '../auth/dto/session-user.dto';
import { ApprovalsService } from './approvals.service';
import { ApproveRequestDto } from './dto/approve-request.dto';
import { InboxQueryDto, InboxStatusFilter } from './dto/inbox-query.dto';
import { RejectRequestDto } from './dto/reject-request.dto';
import { RequestDetailDto } from './dto/request-detail.dto';
import { RequestListResponseDto } from './dto/request-list.dto';

// 전역 JwtAuthGuard(관리자 로그인) + @RequirePermissions 적용됨.
// 결재자는 세션 사용자(JWT)로 식별한다 — body approverId 방식은 폐기.
// 시연 픽스처의 1차 결재자(사회복지사)는 STAFF라 웹 로그인 대상이 아니지만,
// 1차 대결자가 사무국장(로그인 가능)이라 대결 경로로 결재 흐름이 이어진다.
@ApiTags('requests')
@Controller('requests')
export class ApprovalsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

  @Get()
  @RequirePermissions('approvals:read')
  @ApiOkResponse({ type: RequestListResponseDto })
  listRequests(@Query() query: InboxQueryDto): Promise<RequestListResponseDto> {
    return this.approvalsService.listRequests(
      query.status ?? InboxStatusFilter.PENDING,
    );
  }

  @Get(':id')
  @RequirePermissions('approvals:read')
  @ApiOkResponse({ type: RequestDetailDto })
  getRequest(@Param('id') id: string): Promise<RequestDetailDto> {
    return this.approvalsService.getRequest(id);
  }

  @Post(':id/approve')
  @RequirePermissions('approvals:decide')
  @ApiOkResponse({ type: RequestDetailDto })
  approveRequest(
    @Param('id') id: string,
    @CurrentUser() user: SessionUserDto,
    @Body() body: ApproveRequestDto,
  ): Promise<RequestDetailDto> {
    return this.approvalsService.approveRequest(
      id,
      user.id,
      body.delegated ?? false,
    );
  }

  @Post(':id/reject')
  @RequirePermissions('approvals:decide')
  @ApiOkResponse({ type: RequestDetailDto })
  rejectRequest(
    @Param('id') id: string,
    @CurrentUser() user: SessionUserDto,
    @Body() body: RejectRequestDto,
  ): Promise<RequestDetailDto> {
    return this.approvalsService.rejectRequest(id, user.id, body.comment);
  }
}
