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
  // 로컬 Vite dev 서버 전용(5173=apps/web, 5174=apps/mobile). 운영 origin은 배포 구성 확정 시 별도 반영한다.
  // LAN IP 등 환경별 추가 origin은 CORS_ORIGINS(.env, 콤마 구분)로 확장한다 — 코드에 개인 IP 하드코딩 금지.
  // credentials: 인증 쿠키(cs_access_token)가 실리도록 허용
  const extraOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: [
      'http://localhost:5173',
      'http://localhost:5174',
      ...extraOrigins,
    ],
    credentials: true,
  });

  const document = createOpenApiDocument(app);
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs/json',
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
