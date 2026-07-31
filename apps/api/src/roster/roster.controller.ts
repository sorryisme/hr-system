import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { SessionUserDto } from '../auth/dto/session-user.dto';
import { ApplyPresetDto, ApplyPresetResultDto } from './dto/apply-preset.dto';
import { RosterQueryDto } from './dto/roster-query.dto';
import { RosterResponseDto } from './dto/roster-response.dto';
import {
  CloseRosterDto,
  RejectCloseDto,
  RosterTransitionResultDto,
} from './dto/roster-transition.dto';
import { ShiftPatternPresetSummaryDto } from './dto/shift-pattern-preset.dto';
import { UpdateEntriesDto } from './dto/update-entries.dto';
import { RosterService } from './roster.service';
import { RosterStateService } from './roster-state.service';

// 전역 JwtAuthGuard + @RequirePermissions. facilityId는 세션 사용자에서 결정한다
// (쿼리로 받지 않는다 — 멀티테넌트 격리, 다른 시설 근무표 조회 차단).
// roster:write / roster:close 의 세부 차등(작성=사회복지사 / 마감=사무국장·시설장, §1.3)은
// system_role이 둘 다 ADMIN이라 job_role 기반 앱 레벨 검사 또는 RBAC 도입 시 해소한다.
@ApiTags('rosters')
@Controller('rosters')
export class RosterController {
  constructor(
    private readonly rosterService: RosterService,
    private readonly rosterStateService: RosterStateService,
  ) {}

  @Get()
  @RequirePermissions('roster:read')
  @ApiOkResponse({ type: RosterResponseDto })
  getRoster(
    @Query() query: RosterQueryDto,
    @CurrentUser() user: SessionUserDto,
  ): Promise<RosterResponseDto> {
    return this.rosterService.getRoster(user.facilityId, query.yearMonth);
  }

  /// 프리셋 목록(§4.6) — 프리셋 적용 다이얼로그 선택지
  @Get('shift-pattern-presets')
  @RequirePermissions('roster:read')
  @ApiOkResponse({ type: [ShiftPatternPresetSummaryDto] })
  listPresets(
    @CurrentUser() user: SessionUserDto,
  ): Promise<ShiftPatternPresetSummaryDto[]> {
    return this.rosterService.listPresets(user.facilityId);
  }

  @Post()
  @RequirePermissions('roster:write')
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        yearMonth: { type: 'string' },
        status: { type: 'string' },
      },
    },
  })
  createRoster(
    @Body() body: RosterQueryDto,
    @CurrentUser() user: SessionUserDto,
  ): Promise<{ id: string; yearMonth: string; status: string }> {
    return this.rosterService.createRoster(user.facilityId, body.yearMonth);
  }

  // --- 상태머신(§4.8) ---

  /// 셀 다건 편집. COMPLETED에서 수정 시 DRAFT 복귀, CLOSED는 거부(결재 경유만)
  @Patch(':id/entries')
  @RequirePermissions('roster:write')
  @ApiOkResponse({ type: RosterTransitionResultDto })
  updateEntries(
    @Param('id') id: string,
    @Body() body: UpdateEntriesDto,
    @CurrentUser() user: SessionUserDto,
  ): Promise<RosterTransitionResultDto> {
    return this.rosterStateService.updateEntries(
      id,
      user.facilityId,
      body.entries,
    );
  }

  /// 프리셋 적용(§4.6/§4.8): 직원 행 우클릭 → 패턴 + 조 + 시작일 + 적용 기간
  @Post(':id/apply-preset')
  @RequirePermissions('roster:write')
  @ApiOkResponse({ type: ApplyPresetResultDto })
  applyPreset(
    @Param('id') id: string,
    @Body() body: ApplyPresetDto,
    @CurrentUser() user: SessionUserDto,
  ): Promise<ApplyPresetResultDto> {
    return this.rosterStateService.applyPreset(id, user.facilityId, body);
  }

  /// 작성 완료: DRAFT → COMPLETED (검증 스냅샷)
  @Post(':id/complete')
  @RequirePermissions('roster:write')
  @ApiOkResponse({ type: RosterTransitionResultDto })
  complete(
    @Param('id') id: string,
    @CurrentUser() user: SessionUserDto,
  ): Promise<RosterTransitionResultDto> {
    return this.rosterStateService.complete(id, user.facilityId);
  }

  /// 마감 상신: COMPLETED → CLOSING_APPROVAL
  @Post(':id/submit-close')
  @RequirePermissions('roster:write')
  @ApiOkResponse({ type: RosterTransitionResultDto })
  submitClose(
    @Param('id') id: string,
    @CurrentUser() user: SessionUserDto,
  ): Promise<RosterTransitionResultDto> {
    return this.rosterStateService.submitClose(id, user.facilityId, user.id);
  }

  /// 마감 승인: CLOSING_APPROVAL → CLOSED (위반 시 강행 사유 필수 — D-19)
  @Post(':id/close')
  @RequirePermissions('roster:close')
  @ApiOkResponse({ type: RosterTransitionResultDto })
  close(
    @Param('id') id: string,
    @Body() body: CloseRosterDto,
    @CurrentUser() user: SessionUserDto,
  ): Promise<RosterTransitionResultDto> {
    return this.rosterStateService.close(
      id,
      user.facilityId,
      user.id,
      body.force ?? false,
      body.reason,
    );
  }

  /// 마감 반려: CLOSING_APPROVAL → DRAFT (사유 필수)
  @Post(':id/reject-close')
  @RequirePermissions('roster:close')
  @ApiOkResponse({ type: RosterTransitionResultDto })
  rejectClose(
    @Param('id') id: string,
    @Body() body: RejectCloseDto,
    @CurrentUser() user: SessionUserDto,
  ): Promise<RosterTransitionResultDto> {
    return this.rosterStateService.rejectClose(
      id,
      user.facilityId,
      user.id,
      body.reason,
    );
  }
}
