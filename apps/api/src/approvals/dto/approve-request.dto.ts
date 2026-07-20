import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/// 승인 옵션. 결재자는 세션 사용자(JWT)로 식별한다
export class ApproveRequestDto {
  /// 전결 승인(D-13) — 2차 결재 단계의 결재자·대결자만 사용 가능.
  /// true면 이후 단계를 생략하고 최종 확정한다
  @ApiPropertyOptional({
    description: '전결 승인 여부(2차 단계의 결재자·대결자 전용 — D-13)',
  })
  @IsOptional()
  @IsBoolean()
  delegated?: boolean;
}
