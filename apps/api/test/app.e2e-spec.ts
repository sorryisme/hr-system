import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    // AppModule은 전역 PrismaModule을 가져오지만, 이 e2e 스펙은 DB에 붙지 않는 라우트만
    // 검증한다. 실제 PrismaService는 DATABASE_URL/실제 DB 연결을 요구하므로 여기서는
    // 연결을 시도하지 않는 스텁으로 대체한다.
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        onModuleInit: async () => {},
        onModuleDestroy: async () => {},
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  afterEach(async () => {
    await app.close();
  });
});
