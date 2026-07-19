# Prisma 스키마 v1.2 DDL 반영 (2026-07-17)

## 배경

`docs/ddl/carehome_tms_ddl_v1.2.sql`(기획서 v3.2 반영, E-01~E-11)이 작성되어 있었고,
기존 `apps/api/prisma/schema.prisma`는 v1.1 기준으로 세팅되어 있었다. v1.2 변경분을
Prisma 스키마와 마이그레이션에 반영했다.

## 변경 내용

- `prisma/schema.prisma`: v1.2의 11개 변경(E-01~E-11) 전체 반영
  - E-01 결재선 1~3단계 확장 + 전결(위임전결) 지원: `Facility.approvalSteps` 상한 3으로 확장,
    `ApprovalLine`에 `approverRole`/`delegationEnabled` 추가(`approverId`는 nullable로 전환),
    `ApprovalRequest.isFinalByDelegation`, `ApprovalHistory.isDelegatedFinal` 추가,
    제출 시점 결재선 스냅샷용 `ApprovalRequestLine` 모델 신설
  - E-02 팀 도입: `Team` 모델 신설, `Employee.teamId` 추가
  - E-03 유대 이중 트랙: `SubstituteHolidayGrant` 폐지 → `SubstituteHolidayLedger` 신설
    (서명 워크플로우, 정정/취소 감사 필드, `carryableMinutes` CHECK 0~480 포함)
  - E-04 알림 세분화: `NotificationKind`에 `STEP_APPROVED`/`SIGN_REQUEST`/`LEAVE_EXPIRY_60D`/
    `LEAVE_EXPIRY_30D`/`SH_EXPIRY` 추가(`EXPIRY_WARNING` 대체), `Notification.ledgerId` 추가
  - E-05 근무표 상태머신 4단계: `RosterStatus`를 `DRAFT/COMPLETED/CLOSING_APPROVAL/CLOSED`로 변경,
    `submittedBy`/`submittedAt`/`forceClosed`/`forceCloseReason` 추가
  - E-06 `ShiftType.recognizedHours`(DECIMAL 시간) → `recognizedMinutes`(분) 전환, `cellLabel` 추가
  - E-07 `DailyStaffingRule` 모델 신설(팀×주/야 최소·최대)
  - E-08 `Facility.tagMarginMinutes`/`adminCallPhone` 추가
  - E-09 `RegulationParamSet.annualLeaveCapDays` 추가
  - E-10 `ScheduleEntry.isProvisional` 추가
  - E-11 `LeaveBalance` 주석 개정 — 스키마 변경 없음(연차연도 year_basis 앱 레벨 전제 문서화만)
  - 추가로 `ValidationResult.snapshotStage`(EDIT/COMPLETED/CLOSE) 반영 — §4.8 상태머신 확장에 맞춰
    검증 스냅샷 시점을 구분(원본 v1.1엔 없던 항목이나 v1.2 roster 상태머신과 맞물려 필요)
- `prisma/migrations/20260717000000_v1_2_schema_update/migration.sql`: 위 변경사항의 손으로 작성한
  ALTER/CREATE SQL. 기존 `20260709000000_init`과 마찬가지로 `prisma migrate dev` 자동 diff를
  타지 않는다(CHECK 제약·생성 컬럼·트리거가 있는 테이블 포함이라 스키마 언어만으로 표현 불가).
  - `substitute_holiday_grant`는 DROP 후 `substitute_holiday_ledger`를 CREATE — 이 프로젝트는
    아직 운영 반영 전(로컬/개발 단계)이라 데이터 보존 없이 재생성했다. 이미 운영 DB에 배포된
    이후라면 이 방식은 쓸 수 없고 데이터 이관 스크립트가 필요하다.
  - `roster.status` ENUM 값 변경 관련: 기존 `CONFIRMED` 값을 가진 행이 있으면 `MODIFY COLUMN`이
    실패한다는 주의 주석을 마이그레이션 파일에 남겨두었다(로컬 DB에 CONFIRMED 데이터가 있다면
    사전에 `COMPLETED` 등으로 수동 전환 필요).
- `prisma/seed.ts`: `shiftType` 시드 데이터를 v1.2 §4.7 확정표(DDL v1.2 초기 데이터) 기준으로 교체
  — `recognizedHours` → `recognizedMinutes`, `cellLabel` 추가, `NF`(야간전담)/`SICK`/`ABS` 3종 추가.

## 검증

- 이번 세션에는 `node_modules`가 설치되어 있지 않았고, 루트 `package.json`이 `engines.node >=22`를
  요구하는데 기본 PATH의 Node는 20.19.6이었다. `nvm4w`로 설치돼 있던 Node 24.12.0을 이 세션의
  PATH에만 임시로 추가해(전역 `nvm use` 전환 없이) `corepack pnpm install`을 실행했다.
- `npx prisma validate` — 통과
- `npx prisma format` — 통과(공백 정리만 반영)
- `npx prisma generate` — Prisma Client v7.8.0 생성 성공
- `tsc --noEmit` — 에러 없음
- `pnpm --filter api lint` — 에러 없음(기존부터 있던 `main.ts` 플로팅 프로미스 warning 1건은 무관)
- `pnpm --filter api test` — 4개 테스트 모두 통과

## 미완료 / 후속 필요

- **실제 DB 반영(`prisma migrate deploy`) 미실행**: 이 저장소 체크아웃에 `apps/api/.env`가 없어
  `DATABASE_URL`이 설정돼 있지 않다. 로컬 MySQL을 다시 붙일 때 `.env`에 `DATABASE_URL`을 설정한 뒤
  `npx prisma migrate deploy`로 이번 마이그레이션을 적용해야 한다(CLAUDE.md: 운영에서는
  `migrate dev`/`db push`/`migrate reset` 금지 — 반드시 `migrate deploy`로 적용).
  적용 후 `substitute_holiday_ledger`/`daily_staffing_rule`/`team` 등 신규 테이블과 트리거
  (`approval_history` append-only)가 실제로 반영됐는지 별도 확인 필요.
- 신규 CHECK 제약(`chk_line_delegation`, `chk_ledger_carryable`) 및 `roster.status` ENUM 변경은
  로컬 DB에 기존 데이터가 있는 상태로 적용할 경우 실패할 수 있어, 적용 전 데이터 상태 확인 권장.
