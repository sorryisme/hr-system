// OpenAPI 문서를 apps/api/openapi.json으로 내보낸다 — apps/web Orval 생성 입력.
// DB 연결 없이 동작한다: NestFactory.create는 컨테이너만 구성하고(onModuleInit 미호출)
// PrismaMariaDb 어댑터도 생성 시점에는 실제 커넥션을 열지 않는다.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { applyGlobalPrefix, createOpenApiDocument } from '../src/openapi';

async function main() {
  // PrismaService 생성자 검증 통과용 더미 — 연결은 발생하지 않는다(시크릿 아님)
  process.env.DATABASE_URL ??=
    'mysql://openapi-export:none@localhost:3306/none';

  const app = await NestFactory.create(AppModule, { logger: false });
  applyGlobalPrefix(app);
  const document = createOpenApiDocument(app);

  const outPath = join(__dirname, '..', 'openapi.json');
  writeFileSync(outPath, JSON.stringify(document, null, 2) + '\n');
  console.log(`OpenAPI 문서 내보내기 완료: ${outPath}`);
  await app.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
