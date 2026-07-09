# 프로젝트 초기 설정 산출물 (2026-07-09)

> 근거 문서: [`architecture-v3-final.md`](../architecture-v3-final.md) §8 구현 순서 1~3단계
> 범위: pnpm 모노레포 초기화 + NestJS 백엔드 init + Vite/React 프론트엔드 init
> 범위 밖(미착수): Prisma/DB(4), Cognito 인증(5), Terraform 인프라(6), CI/CD(7), E2E(8)

## 1. 결과물 구조

```
care/
├─ AGENTS.md                  # v3 AI 작업 규칙
├─ .gitignore
├─ package.json                # workspace root, dev:api/dev:web 스크립트
├─ pnpm-workspace.yaml         # packages, minimumReleaseAge, blockExoticSubdeps, allowBuilds
├─ pnpm-lock.yaml
├─ architecture-v3-final.md
├─ docs/
│  └─ setup-log.md             # 본 문서
└─ apps/
   ├─ api/                     # NestJS 11 (Express adapter)
   │  ├─ src/
   │  │  ├─ main.ts            # bootstrap + Swagger 설정
   │  │  ├─ app.module.ts / app.controller.ts / app.service.ts
   │  │  └─ app.controller.spec.ts
   │  ├─ test/app.e2e-spec.ts
   │  ├─ tsconfig.json          # strict: true
   │  ├─ nest-cli.json
   │  └─ package.json           # name: "api"
   └─ web/                     # Vite 8 + React 19
      ├─ src/
      │  ├─ main.tsx            # TanStack Router 부트스트랩
      │  ├─ routeTree.gen.ts    # 자동 생성물 (git ignore, 수정 금지)
      │  ├─ routes/
      │  │  ├─ __root.tsx
      │  │  └─ index.tsx
      │  ├─ components/
      │  │  ├─ ui/              # shadcn 프리미티브 (button, input, label, table, dialog, dropdown-menu)
      │  │  └─ shared/          # 프로젝트 공통 컴포넌트 (뼈대만, 구현 없음)
      │  ├─ features/           # 도메인별 컴포넌트 (뼈대만)
      │  ├─ lib/utils.ts         # shadcn cn() 헬퍼
      │  └─ index.css            # Tailwind v4 + shadcn 테마 토큰
      ├─ components.json         # shadcn 설정 (preset: nova, base: base)
      ├─ vite.config.ts          # react, tailwindcss, tanstackRouter 플러그인 + @/* alias
      ├─ tsconfig.json / tsconfig.app.json  # strict: true, @/* path
      └─ package.json             # name: "web"
```

## 2. 백엔드 (apps/api)

| 항목 | 값 |
|---|---|
| 프레임워크 | NestJS `^11.0.1`, Express adapter |
| TypeScript | `^5.7.3` (문서 목표는 5.9 — **미조정, 아래 3장 참고**) |
| tsconfig | `strict: true` 적용 (2026-07-09 재수정) |
| Swagger | `@nestjs/swagger` + `swagger-ui-express`, `GET /api/docs`(UI), `GET /api/docs/json`(OpenAPI 스펙) |
| 테스트 | Jest, `app.controller.spec.ts` 1건 통과 확인 |
| dev 실행 | `pnpm dev:api` → `nest start --watch`, 기본 포트 3000 |

Orval 연동(OpenAPI → 프론트 타입 생성)은 `apps/web`에 API 클라이언트가 필요해지는 시점에 별도로 구성 필요 — 아직 미착수.

## 3. 프론트엔드 (apps/web)

| 항목 | 값 |
|---|---|
| 빌드 | Vite `^8.1.1`, React `^19.2.7` |
| TypeScript | `~5.9.0`으로 고정 (Vite 템플릿 기본값 6.0.2에서 다운그레이드 — 문서 §1 "6.0은 안정화 후" 준수) |
| tsconfig | `strict: true`, `@/*` → `./src/*` path alias |
| 라우팅 | `@tanstack/react-router` + `@tanstack/router-plugin` (파일 기반, `autoCodeSplitting: true`) |
| 스타일 | Tailwind CSS v4 (`@tailwindcss/vite`), shadcn/ui (`base` + `nova` preset) |
| shadcn 컴포넌트 | button, input, label, table, dialog, dropdown-menu 설치. **`form`은 이 CLI 버전 레지스트리에 없어 미설치** — RHF+Zod 폼 작업 시 별도 처리 필요 |
| shared/features | 디렉토리만 생성(`.gitkeep`), DataTable/FormField/PageLayout/ConfirmDialog 등 실제 구현 없음 |
| dev 실행 | `pnpm dev:web` → `vite`, 기본 포트 5173 |

## 4. pnpm / 공급망 설정

`pnpm-workspace.yaml`:
- `minimumReleaseAge: 1440` (기본값 유지, 1일 미만 패키지 설치 차단)
- `blockExoticSubdeps: true` (기본값 유지)
- `allowBuilds`:
  - `unrs-resolver: true` — Jest 30(`jest-resolve`)의 전이 의존성, 네이티브 모듈 빌드 필요 → 허용
  - `@scarf/scarf: false` — `swagger-ui-dist`가 설치 시 보내는 사용량 텔레메트리 스크립트 → 차단

`packageManager`: `pnpm@11.9.0` (corepack으로 고정. 설정 당시 최신은 11.10.0이었으나 문서에 명시된 11.9.0 유지)

## 5. 검증 내역

- [x] `pnpm install` — 루트에서 워크스페이스 전체 설치 성공, lockfile 공급망 정책 통과
- [x] `pnpm --filter api build` — 성공 (strict 모드 적용 후 재확인, 타입 에러 없음)
- [x] `pnpm --filter api test` — 1 suite / 1 test 통과
- [x] `pnpm --filter web build` — 성공 (`tsc -b && vite build`, strict 모드)
- [x] API dev 서버 기동 후 `GET /`, `GET /api/docs`, `GET /api/docs/json` 200 확인, 이후 프로세스 종료
- [x] Web dev 서버 기동 후 `GET /` 200 확인, 이후 프로세스 종료

## 6. 알아야 할 격차 (Known Gaps)

1. **apps/api TypeScript 5.7.3** — 문서 목표(5.9)와 다름. strict 모드는 2026-07-09 수정으로 반영됨.
2. **apps/api 패키지명 `api`** — 문서/네이밍 컨벤션상 `@care/api` 스타일을 고려했으나 현재는 미변경.
3. **shadcn `form` 컴포넌트 부재** — 폼 작업 시작 시 `react-hook-form` + `zod` 연동을 직접 구성해야 함.
4. **shared 핵심 컴포넌트 4종(DataTable/FormField/PageLayout/ConfirmDialog) 미구현** — 문서 §8-3에서 언급된 항목, 디렉토리만 존재.
5. **git 커밋 없음** — `git init`만 수행, 아직 커밋되지 않은 워킹 트리 상태.
6. **Orval 파이프라인 미구성** — Swagger 스펙 엔드포인트는 열려 있으나 프론트엔드 타입 생성 연결은 안 됨.
7. **§8 4~8단계 전부 미착수** — Prisma/RDS, Cognito 인증, Terraform, CI/CD, Playwright E2E.
