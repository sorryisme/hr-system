# AGENTS.md

이 저장소는 pnpm workspace 기반 모노레포입니다 (`apps/api` = NestJS 백엔드, `apps/web` = Vite/React 프론트엔드).

## 프로젝트 구조

```
care/
├─ apps/
│  ├─ api/                     # NestJS 11 (Express adapter)
│  │  └─ src/
│  │     ├─ main.ts             # bootstrap, Swagger(/api/docs, /api/docs/json)
│  │     ├─ app.module.ts / app.controller.ts / app.service.ts
│  │     └─ app.controller.spec.ts
│  │     # 도메인 모듈·DB 계층(Prisma)·인증(JWT/RBAC) 미구현 — 기본 스캐폴드만 존재
│  └─ web/                     # Vite 8 + React 19
│     └─ src/
│        ├─ routes/             # TanStack Router 파일기반 라우팅 (__root.tsx, index.tsx)
│        ├─ routeTree.gen.ts    # 자동 생성물 — 수정 금지
│        ├─ components/
│        │  ├─ ui/              # shadcn 프리미티브 (button, input, label, table, dialog, dropdown-menu)
│        │  └─ shared/          # 공통 컴포넌트 — 현재 디렉터리만 존재(.gitkeep), 구현 없음
│        ├─ features/           # 도메인별 컴포넌트 — 현재 디렉터리만 존재(.gitkeep), 구현 없음
│        └─ lib/utils.ts        # shadcn cn() 헬퍼
└─ docs/
   ├─ architecture/architecture-v3-final.md   # 확정 아키텍처
   ├─ plan/                                    # 기능요구사항·개발계획 (근태/근무표/가산점수 등 도메인 규칙)
   ├─ ddl/carehome_tms_ddl_v1.1.sql             # MySQL DDL (Prisma 미도입, 스키마만 존재)
   ├─ mock-ui/                                  # 결재 등 화면 목업
   └─ {날짜}-{작업제목}.md                       # 코드 작업 산출물 (General 규칙에 따라 생성)
```

- Orval 연동(OpenAPI → 프론트 타입)은 apps/web에 실제 API 클라이언트가 필요해지는 시점에 구성한다. 그 전까지 apps/web은 백엔드를 호출하지 않는다.
- `apps/web/src/components/shared`, `apps/web/src/features`에 실제 구현(DataTable/FormField/PageLayout/ConfirmDialog 등)을 추가할 때는 이 구조를 유지한다.

## Architecture
- NestJS(apps/api) 작업 시 `.claude/skills/nestjs-best-practices` 참고.
- 모든 업무 로직·DB 접근은 apps/api에만 작성한다.
- API 타입은 Orval 생성물만 사용한다. generated 디렉터리·routeTree.gen.ts 수정 금지.

## Frontend
- React(apps/web) 작업 시 `.claude/skills/react-best-practices` 참고.
- UI 프리미티브는 shadcn CLI로만 추가하고 components/ui 중복 구현 금지.
- Tailwind + cva + cn만 사용. 다른 스타일링 방식·UI 라이브러리 금지.
- 디자인 토큰 외 임의 색상값(arbitrary value) 금지.
- VITE_ 환경변수에 시크릿 금지. 토큰 localStorage 저장 금지.

## Auth
- 모든 API는 JWT 검증 + @RequirePermissions를 거친다. 권한 소스는 MySQL RBAC.
- Cognito 설정(App Client, 토큰 수명, MFA) 변경은 사람 검토 필수.

## DB/Infra
- DB 변경은 Migration 필수. 운영에서 prisma db push / migrate dev / migrate reset 금지.
- DB 커넥션 처리 변경(풀, 타임아웃, 재시도)은 사람 검토 필수 (Multi-AZ failover 대응).
- CloudFront behavior / WAF / 보안그룹 / Terraform 변경은 사람 검토 필수.

## Dependencies
- pnpm minimumReleaseAge, blockExoticSubdeps 기본값을 끄지 않는다.
- 신규 라이브러리 추가는 사유 기록 + 사람 승인.

## General
- any 금지. eslint-disable은 사유 필수.
- NestJS v12, TypeScript 6.0, Prisma Next 등 메이저 업그레이드는 사람 승인 없이 수행하지 않는다.
- 지시한 코드 작업 이후 산출물을 작성하여 DOCS에 추가한다. 산출물 작성 시 docs/logs/{년월일}/{yyyy-MM-dd}-{작업제목}.md 형태로 저장한다.
- 브랜치명은 feat{num}/{name}, fix/{num}/name 같은 구조로 작성하며 num은 가장 최근 브랜치 num의 + 1 한다.
