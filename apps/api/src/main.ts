// 로컬 개발용: .env가 있으면 읽어 process.env를 채운다. 이미 설정된 값은 덮어쓰지 않으므로
// 운영(시크릿 관리 솔루션이 실제 환경변수를 주입)에서는 아무 영향이 없다.
import { config } from 'dotenv';
config({ override: false });

import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { patchBigIntJson } from './bigint-json';

patchBigIntJson();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Care API')
    .setVersion('0.0.1')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs/json',
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
