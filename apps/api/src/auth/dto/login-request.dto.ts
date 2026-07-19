import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginRequestDto {
  @ApiProperty({ example: 'admin@careshift.kr' })
  @IsEmail({}, { message: '이메일 형식이 올바르지 않습니다.' })
  email!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: '비밀번호를 입력해 주세요.' })
  password!: string;
}
