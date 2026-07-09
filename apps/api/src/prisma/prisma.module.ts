import { Global, Module } from '@nestjs/common';
import { PrismaService, DATABASE_URL } from './prisma.service';

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_URL,
      useFactory: () => process.env.DATABASE_URL,
    },
    PrismaService,
  ],
  exports: [PrismaService],
})
export class PrismaModule {}
