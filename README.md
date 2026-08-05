# care — 요양시설 근태·근무표 관리 시스템

사용자 약 50명 규모의 사내 전용 요양시설 인사관리 시스템입니다. 결재(휴가·취소), 월 근무표 작성·마감, GPS 원터치 출퇴근 태그를 다룹니다. pnpm workspace 기반 모노레포로 관리자 웹, 종사자 모바일 웹뷰, 백엔드 API로 구성됩니다.

## 기술 스택

| 영역 | 스택 |
|---|---|
| 백엔드 (`apps/api`) | NestJS 11 (Express adapter), Prisma 7 + MySQL/MariaDB, class-validator, Swagger |
| 관리자 웹 (`apps/web`) | Vite 8, React 19, TanStack Router/Query, shadcn/ui + Tailwind CSS v4, Orval |
| 모바일 웹뷰 (`apps/mobile`) | apps/web과 동일 스택 — 종사자용 시니어 친화 UI(큰 글씨, 고대비, 화면당 1과업) |
| 인증 | 자체 발급 JWT(HS256) + httpOnly 쿠키, RBAC은 MySQL(users/roles/permissions)이 단일 소스 |
| 패키지 관리 | pnpm 11 workspace, Node.js ≥ 22 |

## 프로젝트 구조

```
apps/
├─ api/       # NestJS 백엔드 — auth, devices, events, leave, approvals, roster, attendance 모듈
├─ web/       # 관리자 웹 — features: auth, dashboard, approvals, roster
└─ mobile/    # 종사자 모바일 웹뷰 — features: device-auth, leave-request, attendance
docs/
├─ architecture/  # 확정 아키텍처 문서
├─ plan/          # 기능요구사항·개발계획, 구현현황 비교
├─ ddl/           # MySQL DDL(참고용 — 실제 스키마 원본은 apps/api/prisma/schema.prisma)
├─ mock-ui/       # 화면 목업
└─ logs/          # 작업 산출물 로그(년월일 폴더별)
```

세부 컨벤션과 모듈별 규칙은 [CLAUDE.md](./CLAUDE.md)를 따릅니다.

## 시작하기

### 사전 준비
- Node.js ≥ 22, pnpm 11.9.0 (`packageManager` 필드로 고정됨)
- MySQL/MariaDB 인스턴스

### 설치 및 환경변수

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
# DATABASE_URL, JWT_SECRET(openssl rand -base64 32 등) 설정
```

### DB 마이그레이션 및 시드

```bash
pnpm --filter api prisma:generate
pnpm --filter api prisma:migrate:deploy
pnpm --filter api db:seed
```

### 개발 서버 실행

```bash
pnpm dev          # api(3000) + web(5173) + mobile(5174) 동시 실행
pnpm dev:api       # 개별 실행도 가능 (dev:web, dev:mobile)
```

- API 문서(Swagger): `http://localhost:3000/api/docs`
- 백엔드 API 변경 시 Swagger 갱신 후 프론트 타입 재생성: `pnpm --filter web orval`, `pnpm --filter mobile orval`

## 구현 현황 (2026-08-05 기준)

| 영역 | 상태 |
|---|---|
| 인증·기기 등록(RBAC, 관리자 발급 코드 자동 로그인) | 핵심 흐름 구현 |
| 결재 시스템(휴가 신청·취소, 결재선, 이력) | 핵심 흐름 구현. 유대 관리대장·근무자 서명·알림 연동은 미구현 |
| 근무표(작성·마감 상태머신, 프리셋 적용, 실시간 검증 패널 §4.8) | 상당 부분 구현. 휴가 12종 셀 표기, job_role별 권한 차등, 설정 화면(A-6)은 미구현 |
| GPS 출퇴근 태그 | MVP 구현(원터치 태그, 반경 검증). 미태그 워크플로우·지각 확인은 범위 밖 |
| 마감 후 내보내기(Excel/PDF) | 미구현 |

기획 대비 상세 비교는 [docs/plan/dev-plan-0720-구현현황-비교.md](./docs/plan/dev-plan-0720-구현현황-비교.md) 참고.

## 개발 컨벤션

- 업무 로직·DB 접근은 `apps/api`에만 작성, 프론트는 Orval 생성 타입만 사용
- UI는 shadcn CLI로 추가한 프리미티브 + Tailwind + cva + cn만 사용, 임의 색상값 금지
- DB 변경은 Migration 필수(운영에서 `prisma db push`/`migrate dev`/`migrate reset` 금지)
- `any` 금지, 신규 의존성 추가는 사유 기록 + 사람 승인 필요

자세한 내용은 [CLAUDE.md](./CLAUDE.md) 참고.
