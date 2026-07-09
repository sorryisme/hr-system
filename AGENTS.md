# AGENTS.md

이 저장소는 pnpm workspace 기반 모노레포입니다 (`apps/api` = NestJS 백엔드, `apps/web` = Vite/React 프론트엔드).
아키텍처 확정안은 `architecture-v3-final.md` 참고.

## Architecture
- 모든 업무 로직·DB 접근은 apps/api에만 작성한다.
- API 타입은 Orval 생성물만 사용한다. generated 디렉터리·routeTree.gen.ts 수정 금지.

## Frontend
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
- 지시한 코드 작업 이후 산출물을 작성하여 DOCS에 추가한다. 산출물 작성 시 {날짜}-{작업제목}.md 형태로 저장한다.
