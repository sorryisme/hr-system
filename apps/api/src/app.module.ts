import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ApprovalsModule } from './approvals/approvals.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, ApprovalsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
