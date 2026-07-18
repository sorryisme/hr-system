import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

/// §3.7 API 경로(/api/...)와 일치시키는 전역 프리픽스.
/// Swagger 문서 생성 전에 호출해야 경로가 문서에 반영된다.
export function applyGlobalPrefix(app: INestApplication): void {
  app.setGlobalPrefix('api');
}

/// main.ts(서빙)와 scripts/export-openapi.ts(Orval 입력 파일 생성)가 공유하는 문서 생성기 —
/// 두 곳의 설정이 어긋나지 않도록 한 곳에 둔다
export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Care API')
    .setVersion('0.0.1')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config, {
    // Orval 훅 이름이 컨트롤러 접두사 없이 메서드명으로 생성되도록 한다 (useListRequests 등)
    operationIdFactory: (_controllerKey, methodKey) => methodKey,
  });
}
