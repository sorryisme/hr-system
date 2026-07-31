import { ApiProperty } from '@nestjs/swagger';
import { IsLatitude, IsLongitude } from 'class-validator';

export class ClockTagRequestDto {
  @ApiProperty()
  @IsLatitude()
  lat!: number;

  @ApiProperty()
  @IsLongitude()
  lng!: number;
}
