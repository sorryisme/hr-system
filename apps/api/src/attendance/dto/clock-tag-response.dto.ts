import { ApiProperty } from '@nestjs/swagger';

export class ClockTagResponseDto {
  @ApiProperty({ type: String })
  clockAt!: string;
}
