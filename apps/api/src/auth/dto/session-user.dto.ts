import { ApiProperty } from '@nestjs/swagger';
import { JobRole, SystemRole } from '@prisma/client';

/// 로그인 응답이자 GET /auth/me 응답. JwtAuthGuard가 요청마다 DB에서 재조회해
/// request.user로 붙이는 형태와 동일하다(권한의 단일 소스는 MySQL — architecture-v3 §3)
export class SessionUserDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ enum: JobRole, enumName: 'JobRole' })
  jobRole!: JobRole;

  @ApiProperty({ enum: SystemRole, enumName: 'SystemRole' })
  systemRole!: SystemRole;

  @ApiProperty({ type: String })
  facilityId!: string;
}
