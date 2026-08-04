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
  RosterTransitionResultDto,
} from './dto/roster-transition.dto';
import { ShiftPatternPresetSummaryDto } from './dto/shift-pattern-preset.dto';
import { RosterShiftTypeSummaryDto } from './dto/shift-type-summary.dto';
import { UpdateEntriesDto } from './dto/update-entries.dto';
import { RosterService } from './roster.service';
import { RosterStateService } from './roster-state.service';

// 전역 JwtAuthGuard + @RequirePermissions. facilityId는 세션 사용자에서 결정한다
// (쿼리로 받지 않는다 — 멀티테넌트 격리, 다른 시설 근무표 조회 차단).
// 마감/마감취소(roster:close)는 시설장·사무국장만(§1.3) — system_role이 ADMIN으로 뭉뚱그려져 있어
// RosterStateService가 user.jobRole을 추가로 검사한다(assertCloserRole).
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

  /// 근무유형 목록(§4.7) — 셀 편집 팝오버 선택지
  @Get('shift-types')
  @RequirePermissions('roster:read')
  @ApiOkResponse({ type: [RosterShiftTypeSummaryDto] })
  listShiftTypes(
    @CurrentUser() user: SessionUserDto,
  ): Promise<RosterShiftTypeSummaryDto[]> {
    return this.rosterService.listShiftTypes(user.facilityId);
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

  /// 셀 다건 편집. DRAFT에서만 허용, CLOSED는 거부(마감취소 후 편집)
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

  /// 마감: DRAFT → CLOSED (위반 시 강행 사유 필수 — D-19). 시설장·사무국장만
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
      user.jobRole,
      body.force ?? false,
      body.reason,
    );
  }

  /// 마감취소: CLOSED → DRAFT (사유 불필요, 즉시 편집 가능 상태로 복귀). 시설장·사무국장만
  @Post(':id/reopen')
  @RequirePermissions('roster:close')
  @ApiOkResponse({ type: RosterTransitionResultDto })
  reopen(
    @Param('id') id: string,
    @CurrentUser() user: SessionUserDto,
  ): Promise<RosterTransitionResultDto> {
    return this.rosterStateService.reopen(id, user.facilityId, user.jobRole);
  }
}
