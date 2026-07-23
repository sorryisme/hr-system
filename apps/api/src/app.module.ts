import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ApprovalsModule } from './approvals/approvals.module';
import { AuthModule } from './auth/auth.module';
import { DevicesModule } from './devices/devices.module';
import { EventsModule } from './events/events.module';
import { LeaveModule } from './leave/leave.module';
import { PrismaModule } from './prisma/prisma.module';
import { RosterModule } from './roster/roster.module';

@Module({
  imports: [
    PrismaModule,
    EventsModule,
    AuthModule,
    ApprovalsModule,
    DevicesModule,
    LeaveModule,
    RosterModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
