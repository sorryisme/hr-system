import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export class ApproveRequestDto {
  /// 인증(JWT) 도입 전 임시 — 결재자 employee id를 body로 받는다. Phase 0 인증 도입 시 토큰에서 추출로 대체
  @ApiProperty({
    type: String,
    example: '3',
    description: '결재자 employee id',
  })
  @Matches(/^\d+$/, { message: 'approverId는 숫자 문자열이어야 합니다' })
  approverId!: string;
}
