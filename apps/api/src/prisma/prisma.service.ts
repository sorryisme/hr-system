import {
  Inject,
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

export const DATABASE_URL = 'DATABASE_URL';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(@Inject(DATABASE_URL) databaseUrl: string | undefined) {
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is not set');
    }
    // TODO(사람 검토 필요 — CLAUDE.md DB/Infra: "DB 커넥션 처리 변경(풀, 타임아웃, 재시도)은
    // 사람 검토 필수"): 드라이버 기본값 그대로 URL만 넘긴 상태. Multi-AZ failover 대응 관점에서
    // mariadb.PoolConfig(connectionLimit/acquireTimeout/재연결 정책)를 명시할지 검토 필요.
    // 상세: docs/logs/2026-07-09-prisma-v7-업그레이드.md
    super({ adapter: new PrismaMariaDb(databaseUrl) });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
