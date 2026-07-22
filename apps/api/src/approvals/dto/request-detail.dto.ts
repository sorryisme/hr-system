import { ApiProperty } from '@nestjs/swagger';
import { ApprovalAction } from '@prisma/client';
import { EmployeeSummaryDto, RequestListItemDto } from './request-list.dto';

/// 제출 시점 결재선 스냅샷 한 단계(엣지 12 — 중도 변경 비소급).
/// approvers는 해당 단계의 결재자 후보 전원 — 보통 1명이지만, CANCEL 유형은
/// 결재라인이 1단계로 고정되고 시설 결재선 전원이 후보로 들어가 여러 명일 수 있다
/// (leave.service.ts resolveCancellationRequestLines). 후보 중 누구든 결재하면 그 단계가 처리된다.
export class RequestLineDto {
  @ApiProperty()
  stepNo!: number;

  @ApiProperty({ type: [EmployeeSummaryDto] })
  approvers!: EmployeeSummaryDto[];

  @ApiProperty({ type: EmployeeSummaryDto, nullable: true })
  deputy!: EmployeeSummaryDto | null;

  /// 제출 시점 전결 설정(step 2 — D-13)
  @ApiProperty()
  delegationEnabled!: boolean;
}

export class HistoryEntryDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ enum: ApprovalAction, enumName: 'ApprovalAction' })
  action!: ApprovalAction;

  @ApiProperty({ type: Number, nullable: true })
  stepNo!: number | null;

  @ApiProperty({ type: EmployeeSummaryDto })
  actor!: EmployeeSummaryDto;

  @ApiProperty({
    description: '전결에 의한 최종 확정(출력 서식 "전결" 표기 근거)',
  })
  isDelegatedFinal!: boolean;

  @ApiProperty({ type: String, nullable: true })
  comment!: string | null;

  /// 승인 시점 서명 이미지 사본 경로(D-12). 스토리지 미도입 — 경로 문자열만
  @ApiProperty({ type: String, nullable: true })
  signatureSnapshotPath!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  actedAt!: string;
}

export class RequestDetailDto extends RequestListItemDto {
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  finalizedAt!: string | null;

  @ApiProperty({ type: [RequestLineDto] })
  requestLines!: RequestLineDto[];

  @ApiProperty({ type: [HistoryEntryDto] })
  histories!: HistoryEntryDto[];
}
