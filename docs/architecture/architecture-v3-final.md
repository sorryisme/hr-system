# 사내 업무 시스템 아키텍처 확정안 v3

> 전제: 사용자 ~50명 / 사내 전용 / 저트래픽 / AI 중심 개발
> 기준일: 2026-07-09
> v3 = v2에서 4가지 의사결정 확정 반영: **shadcn/ui+Tailwind · pnpm 11 / NestJS 11 최신 · Cognito Hosted UI · CloudFront 방식 · RDS Multi-AZ**

---

## 1. 확정 스택 (버전 검증 완료)

### 공통
| 구분 | 확정 | 근거 |
|---|---|---|
| Runtime | Node.js 24 LTS | pnpm 11이 Node 22+ 요구 → 충족 |
| 언어 | TypeScript 5.9 (strict) | 6.0은 안정화 후 |
| 패키지 | **pnpm 11.x** (최신 11.9.0, 2026-06 기준) | 확인됨. 순수 ESM, Node 22+ 필수 |
| Monorepo | pnpm Workspace | Turborepo는 빌드 지연 확인 후 |

**pnpm 11 활용 포인트 [중요 — AI 개발 시너지]**
- `minimumReleaseAge` 기본 1440분(1일): 출시 1일 미만 패키지 설치 차단 → AI가 추가하는 신규/환각 의존성에 대한 공급망 1차 방어선. **기본값 유지 (0으로 끄지 말 것)**.
- `blockExoticSubdeps` 기본 true 유지.
- 설정은 `.npmrc`가 아닌 `pnpm-workspace.yaml`에 작성 (v11 규칙).
- `packageManager` 필드로 버전 고정 → 팀·CI·AI 환경 전체 동일 버전.

### Backend
| 구분 | 확정 | 비고 |
|---|---|---|
| Framework | **NestJS 11.x** (최신 11.1.x) | 확인됨 (2026-07 기준 11.1.28) |
| | | v12 예고됨 (네이티브 ESM, Vitest 기본, Standard Schema). **정식 출시 + 생태계 안정 전 도입 금지** [판단] |
| Adapter | Express | 유지 |
| ORM | Prisma 7 (`migrate deploy` 운영 절차 유지) | 유지 |
| 인증 | **Cognito JWT 검증** (아래 §3) | 확정 |
| 로그/테스트 | Pino / Jest + Supertest + Testcontainers(MySQL 8.4) | 유지 |

### Frontend
| 구분 | 확정 | 비고 |
|---|---|---|
| 빌드 | Vite 8 + React 19 | 유지 |
| Router | TanStack Router (파일 라우팅 + autoCodeSplitting) | 유지 |
| UI | **shadcn/ui + Tailwind CSS v4** | 확정 |
| 서버상태/폼 | TanStack Query 5 / RHF + Zod 4 | 유지 |
| API Client | Orval 생성 코드 전용 | 유지 |
| 인증 클라이언트 | oidc-client-ts (또는 react-oidc-context) | Cognito Hosted UI 연동 |

---

## 2. shadcn/ui + Tailwind 운영 규칙 (신규)

shadcn은 "설치되는 라이브러리"가 아니라 **코드가 프로젝트로 복사되는 방식**입니다. 이 특성 때문에 AI 개발과 궁합이 좋지만, 규칙 없이는 컴포넌트가 파편화됩니다.

**디렉터리 규칙**
```
apps/web/src/
├─ components/
│  ├─ ui/          # shadcn 원본 프리미티브 (CLI로 추가)
│  └─ shared/      # ui/를 조합한 프로젝트 공통 컴포넌트
├─ features/<도메인>/components/  # 도메인 전용 컴포넌트
```

**AGENTS.md에 추가할 규칙**
```
- 새 UI 프리미티브가 필요하면 pnpm dlx shadcn add <component>로 추가하고,
  components/ui/ 안에 유사 컴포넌트를 직접 새로 만들지 않는다.
- components/ui/ 수정은 허용되나(디자인 시스템 커스텀),
  특정 화면 전용 로직을 ui/에 넣지 않는다. 화면 로직은 features/로.
- 스타일은 Tailwind 유틸리티 + cva(variants) + cn()만 사용한다.
  inline style, styled-components, CSS Module, emotion 혼용 금지.
- 색상·간격 등 디자인 토큰은 Tailwind theme(CSS 변수)로만 정의한다.
  임의 hex 값(text-[#3b82f6] 등 arbitrary value) 사용 금지.
- 다른 UI 라이브러리(MUI, AntD 등) import 금지.
```

**[판단]** AI가 가장 자주 일으키는 문제는 "비슷한 Button을 세 곳에 다르게 구현"입니다. 위 규칙 + 초기 2주 내 `shared/` 핵심 컴포넌트(DataTable, FormField, PageLayout, ConfirmDialog) 확립이 가장 효과적인 예방책입니다.

---

## 3. 인증 확정: Cognito User Pool + Hosted UI

### 흐름
```
사용자 → SPA → Cognito Hosted UI (auth.example.com)
       → 로그인 → Authorization Code 반환
       → SPA(oidc-client-ts)가 PKCE로 토큰 교환
       → API 호출 시 Authorization: Bearer <access_token>
       → NestJS: Cognito JWKS로 서명 검증 + RBAC 조회
```

### 구성 요소
| 항목 | 확정 내용 |
|---|---|
| App Client | Public client, **secret 없음** (SPA는 secret 보관 불가) |
| Flow | Authorization Code + **PKCE** (Implicit 금지) |
| Hosted UI | Cognito 커스텀 도메인 연결, Managed Login 브랜딩 사용 가능 |
| 토큰 보관 | Access/ID Token 메모리, localStorage 금지. 갱신은 oidc-client-ts silent renew |
| 토큰 수명 | Access 1시간(기본), Refresh는 사내 정책에 맞춰 단축 검토 (예: 8~24시간) [판단] |
| 셀프 가입 | **비활성화**. 관리자가 사용자 생성(초대 이메일) — 사내 시스템 필수 설정 |
| MFA | TOTP 활성화 권장 [판단] |

### NestJS 검증 (모든 요청)
- `passport-jwt` + `jwks-rsa`로 Cognito JWKS(`https://cognito-idp.<region>.amazonaws.com/<pool_id>/.well-known/jwks.json`) 캐싱 검증
- 검증 항목: 서명, `iss`(해당 User Pool), `token_use === 'access'`, `client_id`, 만료
- 검증 통과 후 `sub`(= users.external_id)로 내부 사용자 조회

### 사용자 프로비저닝 + RBAC (v1 스키마 유지)
- 최초 로그인 시 `sub` 기준 users 테이블 upsert (JIT 프로비저닝)
- **권한의 단일 소스는 MySQL RBAC** (users/roles/permissions/user_roles/role_permissions). Cognito Groups는 사용하지 않거나 초기 role 힌트 용도로만 [판단 — 권한 변경을 배포·토큰 재발급 없이 즉시 반영하기 위함]
- `@RequirePermissions()` Guard는 v1 설계 그대로
- 향후 사내 IdP 도입 시: Cognito Federation으로 IdP만 붙이면 앱 코드 무변경 — Cognito 선택의 숨은 장점

### 비용
50 MAU 수준에서는 Cognito 비용은 사실상 무시 가능한 수준 [판단]. 정확한 요금제(Lite/Essentials 티어)는 AWS 요금 페이지에서 확인 요망 (미확인 — 요금 체계가 변동됨).

---

## 4. 배포 확정: CloudFront 듀얼 오리진

```
CloudFront
├─ Default behavior (/*)  → S3 Origin (Vite SPA, OAC로 버킷 비공개)
└─ /api/* behavior        → ALB Origin → ECS Fargate (NestJS)
```

**확정 설정 체크리스트**
- [ ] S3는 OAC(Origin Access Control)로만 접근 — 버킷 퍼블릭 차단
- [ ] `/*`: 403/404 → `/index.html`(200) fallback / `/api/*`: fallback 미적용
- [ ] `/api/*` behavior: 캐싱 비활성(CachingDisabled), `Authorization` 헤더·쿼리·쿠키 전달(AllViewer 계열 origin request policy)
- [ ] 정적 자산 `max-age=31536000, immutable` / `index.html` `no-cache`
- [ ] ALB 보안그룹: CloudFront 경유 트래픽만 허용 (managed prefix list + 커스텀 헤더 검증) — CloudFront 우회 직접 접근 차단
- [ ] 사내 전용 강화가 필요하면 WAF로 사무실 IP 대역 제한 (선택)

주의: Hosted UI 도메인(auth.*)은 CloudFront 뒤가 아니라 Cognito가 직접 서빙 — Route 53에 별도 레코드.

---

## 5. DB 확정: RDS MySQL 8.4 **Multi-AZ**

| 항목 | 확정 |
|---|---|
| 배포 방식 | **Multi-AZ DB instance** (Primary + Standby 1, 자동 failover) |
| | Multi-AZ **DB Cluster**(readable standby 2대)는 이 규모에 과함 [판단] |
| 백업 | 자동 백업 7~14일 + PITR, Deletion Protection ON |
| 비용 | Single-AZ 대비 약 2배 — 의사결정에 반영된 것으로 간주 |

**Multi-AZ 운영 시 애플리케이션 유의점 (AI 규칙에 포함)**
- Failover 시 RDS 엔드포인트의 DNS가 standby로 전환됨 → 앱은 **끊긴 커넥션을 재수립**할 수 있어야 함. Prisma 연결 문자열에 적절한 `connect_timeout`, `pool_timeout` 설정 + 시작 시 1회 연결이 아닌 커넥션 풀 재시도 동작 확인.
- Failover는 보통 수십 초 수준의 순단 발생 — "Multi-AZ = 무중단"이 아님. 배포·점검 공지 프로세스는 여전히 필요 [사실/판단 혼합, failover 소요 시간은 워크로드에 따라 다름].
- ECS 헬스체크가 DB 순단에 태스크를 죽이지 않도록 헬스체크 엔드포인트는 DB 의존을 분리(liveness는 프로세스만, readiness에 DB) [판단].

---

## 6. 갱신된 AGENTS.md 핵심 규칙 (v3 최종)

```
# Architecture
- 모든 업무 로직·DB 접근은 apps/api에만 작성한다.
- API 타입은 Orval 생성물만 사용한다. generated 디렉터리·routeTree.gen.ts 수정 금지.

# Frontend
- UI 프리미티브는 shadcn CLI로만 추가하고 components/ui 중복 구현 금지.
- Tailwind + cva + cn만 사용. 다른 스타일링 방식·UI 라이브러리 금지.
- 디자인 토큰 외 임의 색상값(arbitrary value) 금지.
- VITE_ 환경변수에 시크릿 금지. 토큰 localStorage 저장 금지.

# Auth
- 모든 API는 JWT 검증 + @RequirePermissions를 거친다. 권한 소스는 MySQL RBAC.
- Cognito 설정(App Client, 토큰 수명, MFA) 변경은 사람 검토 필수.

# DB/Infra
- DB 변경은 Migration 필수. 운영에서 prisma db push / migrate dev / migrate reset 금지.
- DB 커넥션 처리 변경(풀, 타임아웃, 재시도)은 사람 검토 필수 (Multi-AZ failover 대응).
- CloudFront behavior / WAF / 보안그룹 / Terraform 변경은 사람 검토 필수.

# Dependencies
- pnpm minimumReleaseAge, blockExoticSubdeps 기본값을 끄지 않는다.
- 신규 라이브러리 추가는 사유 기록 + 사람 승인.

# General
- any 금지. eslint-disable은 사유 필수.
- NestJS v12, TypeScript 6.0, Prisma Next 등 메이저 업그레이드는 사람 승인 없이 수행하지 않는다.
```

---

## 7. 남은 확인 항목

- [x] ~~IdP 종류~~ → Cognito User Pool + Hosted UI 확정
- [x] ~~배포 방식~~ → CloudFront 확정
- [x] ~~Multi-AZ~~ → RDS Multi-AZ instance 확정
- [x] ~~UI 라이브러리~~ → shadcn/ui + Tailwind 확정
- [ ] Cognito 요금 티어 확인 (미확인)
- [ ] Refresh Token 수명 등 사내 세션 정책
- [ ] 사무실 IP 제한(WAF) 적용 여부
- [ ] 도메인 확정 (app용 / auth용 Hosted UI 커스텀 도메인)

## 8. 구현 순서 (v3 확정)

1. pnpm 11 Monorepo + packageManager 고정 + AGENTS.md
2. NestJS 11 기본 구조 + Swagger → Orval 파이프라인
3. Vite + TanStack Router + shadcn 초기화 + shared 핵심 컴포넌트 4종
4. Prisma 7 + MySQL (로컬 Docker → Testcontainers)
5. Cognito User Pool + Hosted UI + PKCE + Nest JWT Guard + RBAC 테이블
6. Terraform: VPC → RDS(Multi-AZ) → ECS/ALB → S3/CloudFront(듀얼 오리진) → Cognito
7. CI/CD (PR 검증 → Migration Task → API 배포 → S3 sync + invalidation)
8. Playwright 핵심 경로 E2E (로그인 포함)
