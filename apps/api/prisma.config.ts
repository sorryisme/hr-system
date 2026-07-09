// Prisma v7: 커넥션 URL은 schema.prisma가 아닌 이 파일에서 CLI(migrate/studio/db seed)용으로만 관리한다.
// 런타임 PrismaClient는 src/prisma/prisma.service.ts에서 별도로 @prisma/adapter-mariadb를 통해 연결한다.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
