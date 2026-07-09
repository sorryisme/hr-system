// 로컬 개발용: .env가 있으면 읽어 process.env를 채운다. 운영에서는 시크릿 관리 솔루션이
// 이미 실제 환경변수를 주입하므로 이 호출은 아무 것도 덮어쓰지 않는다(no-op).
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

// Prisma의 BigInt(id 등)는 기본 JSON.stringify가 직렬화하지 못해 응답 시 예외를 던진다.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function (
  this: bigint,
) {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = new DocumentBuilder()
    .setTitle('Care API')
    .setVersion('0.0.1')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs/json',
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
