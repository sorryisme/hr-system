import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators';
import { ApprovalsService } from './approvals.service';
import { ApproveRequestDto } from './dto/approve-request.dto';
import { InboxQueryDto, InboxStatusFilter } from './dto/inbox-query.dto';
import { RejectRequestDto } from './dto/reject-request.dto';
import { RequestDetailDto } from './dto/request-detail.dto';
import { RequestListResponseDto } from './dto/request-list.dto';

// 전역 JwtAuthGuard(관리자 로그인) + @RequirePermissions 적용됨.
// TODO(모바일 인증 Phase): 결재자 식별을 body의 approverId 대신 세션 사용자로 전환.
// 현재 시연 픽스처의 1차 결재자(사회복지사)는 STAFF라 웹 로그인 대상이 아니어서
// 세션 기반으로 바꾸면 결재 시연 흐름이 끊긴다 — 종사자 인증 도입 시 함께 정리한다.
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
    @Body() body: ApproveRequestDto,
  ): Promise<RequestDetailDto> {
    return this.approvalsService.approveRequest(id, body.approverId);
  }

  @Post(':id/reject')
  @RequirePermissions('approvals:decide')
  @ApiOkResponse({ type: RequestDetailDto })
  rejectRequest(
    @Param('id') id: string,
    @Body() body: RejectRequestDto,
  ): Promise<RequestDetailDto> {
    return this.approvalsService.rejectRequest(
      id,
      body.approverId,
      body.comment,
    );
  }
}
