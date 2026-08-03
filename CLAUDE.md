# CLAUDE.md

이 저장소는 pnpm workspace 기반 모노레포입니다 (`apps/api` = NestJS 백엔드, `apps/web` = Vite/React 프론트엔드).

## 프로젝트 구조

```
care/
├─ apps/
│  ├─ api/                     # NestJS 11 (Express adapter)
│  │  └─ src/
│  │     ├─ main.ts             # bootstrap, Swagger(/api/docs, /api/docs/json)
│  │     ├─ app.module.ts / app.controller.ts / app.service.ts
│  │     ├─ prisma/             # PrismaModule/PrismaService — DB 접근 공통 계층
│  │     ├─ auth/               # 로그인, JWT 발급·검증, @RequirePermissions 가드(RBAC)
│  │     ├─ devices/            # 모바일 기기 등록·인증
│  │     ├─ events/             # 도메인 이벤트 버스 (결재 승인 → 근무표 반영 등 모듈 간 연동)
│  │     ├─ leave/              # 휴가 신청·잔여일수
│  │     ├─ approvals/          # 결재함(승인/반려/취소), 결재선, 이력
│  │     ├─ roster/             # 근무표 조회·편집·마감 상태머신, 프리셋 적용, 실시간 검증(§4.8)
│  │     └─ attendance/         # GPS 원터치 출퇴근 태그
│  │     # 도메인 모듈·DB 계층(Prisma)·인증(JWT/RBAC) 구현되어 있음. 신규 도메인 추가 시 위 모듈 구조를 따른다.
│  ├─ web/                     # Vite 8 + React 19 — 관리자 웹(데스크톱)
│  │  └─ src/
│  │     ├─ routes/             # TanStack Router 파일기반 라우팅 (login, dashboard, approvals, roster 등)
│  │     ├─ routeTree.gen.ts    # 자동 생성물 — 수정 금지
│  │     ├─ api/generated/      # Orval 생성물(OpenAPI → 타입·클라이언트) — 수정 금지, `pnpm --filter web orval`로 재생성
│  │     ├─ components/
│  │     │  ├─ ui/              # shadcn 프리미티브 (button, input, label, table, dialog, dropdown-menu, select, tabs 등)
│  │     │  └─ shared/          # app-shell.tsx(공통 레이아웃) 등 구현되어 있음
│  │     ├─ features/           # 도메인별 컴포넌트 — auth, dashboard, approvals, roster 구현되어 있음
│  │     └─ lib/utils.ts        # shadcn cn() 헬퍼
│  └─ mobile/                  # Vite 8 + React 19 — 종사자 모바일 웹뷰(시니어 친화 UI)
│     └─ src/                   # apps/web과 동일 스택·컨벤션
│        ├─ routes/             # TanStack Router 파일기반 라우팅 (login, index, leave 등)
│        ├─ routeTree.gen.ts    # 자동 생성물 — 수정 금지
│        ├─ api/generated/      # Orval 생성물 — 수정 금지, `pnpm --filter mobile orval`로 재생성
│        ├─ components/
│        │  ├─ ui/              # shadcn 프리미티브 (button, card, badge, alert, input, separator)
│        │  └─ shared/          # mobile-shell.tsx(루트 레이아웃), bottom-nav.tsx 구현되어 있음
│        ├─ features/           # device-auth(기기 인증), leave-request(휴가 신청), attendance(GPS 출퇴근) 구현되어 있음
│        └─ lib/utils.ts        # shadcn cn() 헬퍼
└─ docs/
   ├─ architecture/architecture-v3-final.md   # 확정 아키텍처
   ├─ plan/                                    # 기능요구사항·개발계획 (근태/근무표/가산점수 등 도메인 규칙)
   ├─ ddl/carehome_tms_ddl_v1.3.sql             # MySQL DDL (참고용 — 실제 스키마는 apps/api/prisma/schema.prisma가 원본)
   ├─ mock-ui/                                  # 결재·대시보드·근무표·휴가신청 등 화면 목업
   └─ logs/{년월일}/{yyyy-MM-dd}-{작업제목}.md   # 코드 작업 산출물 (General 규칙에 따라 생성)
```

- Orval 연동은 apps/web, apps/mobile 각각 `orval.config.ts`로 구성되어 있으며 api/generated 하위에 타입·클라이언트가 이미 생성되어 있다. 백엔드 API 추가·변경 시 Swagger(OpenAPI) 갱신 후 Orval을 재생성한다.
- 신규 기능은 각 앱의 features/ 아래 기존 도메인(auth, dashboard, approvals, roster / device-auth, leave-request, attendance)과 동일한 파일 구성(컴포넌트, domain.ts, use-*.ts 훅)을 따른다.

## Architecture
- NestJS(apps/api) 작업 시 `.claude/skills/nestjs-best-practices` 참고.
- 모든 업무 로직·DB 접근은 apps/api에만 작성한다.
- API 타입은 Orval 생성물만 사용한다. generated 디렉터리·routeTree.gen.ts 수정 금지.

## Frontend
- React(apps/web, apps/mobile) 작업 시 `.claude/skills/react-best-practices` 참고.
- apps/mobile은 apps/web과 동일한 스택·컨벤션(Tailwind+cva+cn, shadcn CLI, TanStack Router/Query)을 따르는 별도 앱이다. 종사자 대상 웹뷰이므로 시니어 친화 UI 기준(큰 글씨, 고대비, 화면당 1과업 — docs/plan 참고)을 적용한다.
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
- 지시한 코드 작업 이후 산출물을 작성하여 DOCS에 추가한다. 산출물 작성 시 docs/logs/{년월일}/{yyyy-MM-dd}-{작업제목}.md 형태로 저장한다. 작성 전 반드시 해당 날짜의 docs/logs/{년월일}/ 폴더가 존재하는지 확인하고, 없으면 새로 생성한 뒤 그 안에 추가/이동한다. docs/logs/ 루트에 날짜 파일을 직접 두지 않는다.
