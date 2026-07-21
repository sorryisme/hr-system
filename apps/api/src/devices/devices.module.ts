import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

@Module({
  // AuthModule이 export하는 JWT_SECRET을 재사용해 세션 쿠키를 동일 시크릿으로 서명한다
  imports: [AuthModule],
  controllers: [DevicesController],
  providers: [DevicesService],
})
export class DevicesModule {}
