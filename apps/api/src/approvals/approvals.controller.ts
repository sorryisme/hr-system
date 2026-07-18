import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ApprovalsService } from './approvals.service';
import { ApproveRequestDto } from './dto/approve-request.dto';
import { InboxQueryDto, InboxStatusFilter } from './dto/inbox-query.dto';
import { RejectRequestDto } from './dto/reject-request.dto';
import { RequestDetailDto } from './dto/request-detail.dto';
import { RequestListResponseDto } from './dto/request-list.dto';

// TODO(Phase 0): JWT 검증 + @RequirePermissions 가드 적용 대상(CLAUDE.md Auth).
// 이번 슬라이스는 인증 미도입 상태로, 결재자 식별을 body의 approverId로 받는다.
@ApiTags('requests')
@Controller('requests')
export class ApprovalsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

  @Get()
  @ApiOkResponse({ type: RequestListResponseDto })
  listRequests(@Query() query: InboxQueryDto): Promise<RequestListResponseDto> {
    return this.approvalsService.listRequests(
      query.status ?? InboxStatusFilter.PENDING,
    );
  }

  @Get(':id')
  @ApiOkResponse({ type: RequestDetailDto })
  getRequest(@Param('id') id: string): Promise<RequestDetailDto> {
    return this.approvalsService.getRequest(id);
  }

  @Post(':id/approve')
  @ApiOkResponse({ type: RequestDetailDto })
  approveRequest(
    @Param('id') id: string,
    @Body() body: ApproveRequestDto,
  ): Promise<RequestDetailDto> {
    return this.approvalsService.approveRequest(id, body.approverId);
  }

  @Post(':id/reject')
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
