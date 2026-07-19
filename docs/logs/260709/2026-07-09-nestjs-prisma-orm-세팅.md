# NestJS ORM(Prisma) 세팅 (2026-07-09)

## 배경

`docs/plan/dev_plan_0709.md`(개발기획서 v3.1)와 `docs/ddl/carehome_tms_ddl_v1.1.sql`(MySQL DDL v1.1)을 근거로 apps/api에 ORM을 세팅했다.

## 라이브러리 선택: Prisma

- `AGENTS.md`/`CLAUDE.md`에 이미 `prisma db push`/`migrate dev`/`migrate reset` 금지, "Prisma Next 메이저 업그레이드 승인 필요" 규칙이 있어 이 프로젝트는 Prisma를 전제로 거버넌스가 짜여 있었다.
- strict TypeScript(any 금지) 컨벤션과 맞는 완전 타입 생성 클라이언트.
- DDL의 ENUM·JSON·복합 PK를 MySQL 네이티브 타입으로 매핑 가능.

**새 의존성 추가 (AGENTS.md "신규 라이브러리 추가는 사유 기록 + 사람 승인" 규칙 대상):**
`@prisma/client`, `prisma` — 위 사유로 추가. 사람 승인 필요.

## 버전 고정: v6.19.3 (v7 아님)

`pnpm add`가 최신 메이저인 Prisma **v7.8.0**을 자동 resolve했으나, v7은 스키마 구조가 크게 바뀐다:
- `datasource.url`을 schema.prisma에 둘 수 없고 `prisma.config.ts`로 분리.
- 런타임 `PrismaClient`에 드라이버 `adapter`(MySQL은 `@prisma/adapter-mariadb`)를 명시적으로 넘겨야 함.
- generator가 `prisma-client-js` → `prisma-client`로 바뀌고 별도 `output` 경로 지정이 필요.

이는 AGENTS.md의 "Prisma Next 메이저 업그레이드는 사람 승인 없이 수행하지 않는다" 규칙에 정확히 해당하는 변경이라 **v6.19.3으로 고정**했다. v6는 기존에 통용되는 `datasource { url = env(...) }` + `prisma-client-js` 방식을 그대로 쓴다. v7 전환은 별도로 검토·승인 후 진행할 것.

## 스키마 매핑 방식

`apps/api/prisma/schema.prisma`에 DDL의 21개 테이블을 전부 매핑했다(Phase 0~4, FK 관계 확정을 위해 DDL 원본과 동일하게 함께 배포).

Prisma 스키마 언어로 표현할 수 없는 아래 요소는 **손으로 작성한 baseline 마이그레이션**
(`apps/api/prisma/migrations/20260709000000_init/migration.sql`, DDL v1.1 원본을 거의 그대로 사용)으로만 반영했다:

- `approval_history`의 append-only 트리거(`trg_hist_no_update`/`trg_hist_no_delete`) — UPDATE/DELETE 차단.
- `leave_balance.remaining` / `substitute_holiday_balance.remaining` — `GENERATED ALWAYS AS (...) STORED` 계산 컬럼. schema.prisma에는 읽기 전용 필드로만 선언(주석 명시).
- `facility`/`approval_line`의 `CHECK` 제약.

**중요:** 이 두 테이블(leave_balance, substitute_holiday_balance)과 approval_history에 대해서는 앞으로도 `prisma migrate dev`의 자동 diff를 신뢰하지 말고, 항상 수동으로 마이그레이션 SQL을 작성해야 한다. schema.prisma 최상단에 이 내용을 주석으로 남겼다.

DELIMITER 구문(mysql CLI 전용)은 제거했다 — Prisma migrate 엔진은 드라이버로 직접 실행하므로 무효한 지시자다.

시드 데이터(샘플 시설 1건 + 근무유형 7종)는 마이그레이션에서 분리해 `apps/api/prisma/seed.ts`로 옮기고 `package.json`의 `prisma.seed` 설정(`prisma db seed`)으로 연결했다.

## NestJS 연동

- `apps/api/src/prisma/prisma.service.ts` — `PrismaClient`를 확장한 `@Global()` 서비스, `onModuleInit`/`onModuleDestroy`에서 연결 관리.
- `apps/api/src/prisma/prisma.module.ts` — 전역 모듈로 등록, `AppModule`에 import.
- `apps/api/src/main.ts` — Prisma의 `BigInt`(id 컬럼)가 기본 `JSON.stringify`에서 예외를 던지는 문제를 막기 위해 `BigInt.prototype.toJSON` 패치 추가(문자열로 직렬화). Nest 컨트롤러가 Prisma 엔티티를 그대로 반환할 때 필요.

## 추가/변경 파일

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/migration_lock.toml`, `migrations/20260709000000_init/migration.sql`
- `apps/api/prisma/seed.ts`
- `apps/api/src/prisma/prisma.service.ts`, `prisma.module.ts`
- `apps/api/src/app.module.ts` (PrismaModule import)
- `apps/api/src/main.ts` (BigInt 직렬화 패치)
- `apps/api/.env.example` (`DATABASE_URL` 자리표시자 — 실값은 .env 또는 사내 시크릿 관리 솔루션)
- `apps/api/package.json` (`@prisma/client`/`prisma` 의존성, `prisma:generate`/`prisma:migrate:deploy`/`prisma:studio`/`db:seed` 스크립트, `prisma.seed` 설정)

## 검증

- `pnpm --filter api build` / `lint` / `test` 통과.
- `npx prisma format` / `npx prisma validate` 통과 (schema.prisma 문법 검증).
- `npx prisma generate` 로 클라이언트 생성 확인.
- 실 DB가 없어 `prisma migrate deploy`는 실행하지 못했다 — DB 준비 후 `pnpm --filter api exec prisma migrate deploy` 실행 필요. 만약 누군가 이미 원본 DDL(`docs/ddl/carehome_tms_ddl_v1.1.sql`)을 수동으로 적용한 DB가 있다면, 위 마이그레이션은 `prisma migrate resolve --applied 20260709000000_init`으로 "이미 적용됨" 처리할 것(재실행 시 테이블 중복 생성 오류 방지).

## 후속 작업

1. 사람 승인: `@prisma/client`/`prisma` 의존성 추가 승인.
2. `DATABASE_URL`을 사내 시크릿 관리 솔루션에서 주입하도록 배포 파이프라인 구성(현재는 `.env.example` 자리표시자만 존재).
3. Prisma v7(드라이버 어댑터 아키텍처) 전환은 별도 검토·승인 후 진행.
