import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class RegisterDeviceDto {
  @ApiProperty({
    example: '123456',
    description: '관리자 발급 등록 코드(숫자 6자리) — C-13',
  })
  @Matches(/^\d{6}$/, { message: '등록 코드는 숫자 6자리입니다.' })
  code!: string;

  @ApiProperty({ description: '기기 식별자 — 앱 설치 시 발급되는 UUID' })
  @IsString()
  @IsNotEmpty({ message: '기기 식별자가 없습니다.' })
  @MaxLength(128)
  deviceUid!: string;

  @ApiPropertyOptional({ example: '갤럭시 A25' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceLabel?: string;
}
