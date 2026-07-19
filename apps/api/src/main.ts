// 로컬 개발용: .env가 있으면 읽어 process.env를 채운다. 이미 설정된 값은 덮어쓰지 않으므로
// 운영(시크릿 관리 솔루션이 실제 환경변수를 주입)에서는 아무 영향이 없다.
import { config } from 'dotenv';
config({ override: false });

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { patchBigIntJson } from './bigint-json';
import { applyGlobalPrefix, createOpenApiDocument } from './openapi';

patchBigIntJson();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  applyGlobalPrefix(app);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // 로컬 Vite dev 서버 전용. 운영 origin은 배포 구성 확정 시 별도 반영한다.
  // credentials: 인증 쿠키(cs_access_token)가 실리도록 허용
  app.enableCors({ origin: ['http://localhost:5173'], credentials: true });

  const document = createOpenApiDocument(app);
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs/json',
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
