import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/// 결재자는 세션 사용자(JWT)로 식별 — body에는 반려 사유만 받는다
export class RejectRequestDto {
  /// 반려 사유 — 필수(US-04)
  @ApiProperty({ maxLength: 500, description: '반려 사유(필수)' })
  @IsString()
  @IsNotEmpty({ message: '반려 사유는 필수입니다' })
  @MaxLength(500)
  comment!: string;
}
