-- =============================================================
-- 요양원 근태관리 프로그램 — MySQL DDL v1.3
-- 기준 문서: 개발기획서 v3.2 (§1.3, §3.4~3.6, §4.7~4.8)
-- 대상: MySQL 8.0+ / InnoDB / utf8mb4
-- 구성: [Phase 0] 공통 기반 → [Phase 1] 결재 시스템(1순위)
--       → [Phase 2~4] 근무표·출퇴근·마감 (선행 정의)
--
-- v1.2 → v1.3 변경 (근무표 승인 목업 검토 반영 — docs/mock-ui/근무표)
--   F-01. 근무 시간 셀 단위 조정(§4.8 "모든 근무는 시간을 수정할 수 있다 →
--         근무종류(근무시작~종료)") 저장 위치 신설:
--         - schedule_entry.override_start_time / override_end_time (NULL=유형 기본시각 사용)
--           근무조정 셀 "주(08:50~19:00)"·"조(07:30,17:00)" 표기의 원천
--         - approval_request.desired_start_time / desired_end_time
--           SHIFT_CHANGE(근무조정) 신청이 담는 희망 조정 시각. 승인 시 셀 override로 반영
--   F-02. schedule_entry.source_ledger_id 신설 — 유대(유) 셀 "유(이월인정시간,분)" 표기의
--         원천을 substitute_holiday_ledger 로 직접 연결(FK). 편집기 전용 표기(§4.4).
--   F-03. daily_staffing_rule 초기 시드 예시 추가(목업 하드코딩 임계값의 설정화 — §4.5)
--
-- v1.3 내부 보완 (2026-07-28 — 반려/취소 시 근무표 셀 원복, §4.10)
--   F-04. schedule_entry.pre_approval_snapshot 신설 — 결재 건이 셀을 최초로 덮어쓰기 직전
--         상태의 스냅샷(JSON). 반려/취소 확정 시 이 값으로 복구하고 비운다. NULL이면 사전에
--         셀 자체가 없었다는 뜻 — 원복은 삭제. (수동/프리셋 셀을 가반영이 덮어쓴 뒤 반려되어도
--         원래 근무가 사라지지 않도록 함)
--
-- v1.1 → v1.2 변경 (기획서 v3.1 → v3.2 반영)
--   E-01. 결재선 1~3단계 확장 + 전결(위임전결) 지원 (D-13)
--         - facility.approval_steps CHECK (1..3)
--         - approval_line: step_no 1..3, approver_role(역할 지정) 추가,
--           delegation_enabled(전결 위임, 2단계=사무국장 대상) 추가
--         - approval_request.is_final_by_delegation(전결 확정 표시) 추가
--         - approval_request_line(제출 시점 결재선 스냅샷) 신설 — 엣지 12(중도 변경 비소급)
--   E-02. 팀 개념 도입 (§1.3, Phase 0): team 신설, employee.team_id 추가
--         — 종사자는 본인 팀 근무만 조회(개인정보 보호, 앱 레벨)
--   E-03. 유대 이중 트랙 확정 (D-15):
--         - substitute_holiday_grant 폐지 → substitute_holiday_ledger(관리대장, 시간 트랙) 신설
--         - ledger 행 생성 시 balance(1일 트랙) +1 자동 연동(1:1, 앱 레벨)
--         - 근무자 확인 서명 워크플로우(sign_status, 서명 시점 사본) 포함 (C-4, D-16)
--         - carryable_minutes 0..480 CHECK (§4.4 공단 인정 상한)
--         - 정정 감사 필드(amend/revoke) — 엣지 9, SIGNED 정정 시 서명 무효화는 앱 레벨
--   E-04. notification 개편: kind 세분화(STEP_APPROVED / SIGN_REQUEST /
--         LEAVE_EXPIRY_60D / LEAVE_EXPIRY_30D / SH_EXPIRY), ledger_id FK 추가 (C-10, §3.5)
--   E-05. 근무표 상태머신 4단계 (§4.8, D-19):
--         roster.status = DRAFT | COMPLETED | CLOSING_APPROVAL | CLOSED
--         + 마감 상신/강행 마감(사유 필수) 감사 필드
--   E-06. shift_type.recognized_hours → recognized_minutes 로 변경
--         (야간(주야비) 인정 9시간 40분 = 580분 — 소수 시간 표기 정밀도 문제 해소, §4.7)
--         초기 데이터를 §4.7 확정 근무유형(주간/주야비야간/야간전담/병가/결근 포함)으로 교체
--   E-07. 일별 적정 인원 설정(§4.5): daily_staffing_rule 신설 (팀×주/야 최소·최대)
--   E-08. 설정 항목 추가(A-6): facility.admin_call_phone(관리자 호출 전화 — C-11),
--         facility.tag_margin_minutes(태그 허용 시간 여유)
--   E-09. regulation_param_set.annual_leave_cap_days 추가 (D-9 총 상한 25일 —
--         [V-3 원문 확인 필요], 기본값 선반영)
--   E-10. schedule_entry.is_provisional 추가 — step_approved 가반영(글자만) 표시 (§4.10)
--   E-11. leave_balance 주석 개정: 입사일 기준 연차연도(year_basis) 운영 전제 (§4.9 ⑥)
--
-- 설계 메모 (v1.1 승계):
--   * target_dates date[] 는 자식 테이블(approval_request_date)로 정규화
--   * 연차는 반차(0.5일) 지원을 위해 DECIMAL(4,1)
--   * leave_balance.remaining 은 생성 칼럼(granted - used - reserved)
--   * approval_history 는 append-only: 트리거로 UPDATE/DELETE 차단
--   * 비밀번호/PIN은 해시만 저장 (평문·복호화 가능 형태 저장 금지)
--   * 서명 이미지는 오브젝트 스토리지에 key만 보관, 승인/서명 시점 "사본" 별도 보존(D-12)
--   * 잔여 차감 시점 = 최종 APPROVED. 제출 시 reserved 가산(D-2)
-- =============================================================

SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS carehome_tms
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_0900_ai_ci;
USE carehome_tms;

-- =============================================================
-- [Phase 0] 공통 기반
-- =============================================================

-- 시설
CREATE TABLE facility (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name                VARCHAR(100)    NOT NULL,
  capacity            SMALLINT UNSIGNED NOT NULL COMMENT '입소 정원',
  staffing_ratio      DECIMAL(3,1)    NOT NULL DEFAULT 2.1
                      COMMENT '요양보호사 배치기준 (2.1 또는 2.3 — V-2 유예조건 원문 확인 필요, 기본 2.1)',
  outsourced_meal     TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '위탁급식(영양사·조리원 면제)',
  outsourced_laundry  TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '위탁세탁(위생원 면제)',
  approval_steps      TINYINT UNSIGNED NOT NULL DEFAULT 3
                      COMMENT '[v1.2] 결재 단계 수 1~3. 표준 3단계 = 사회복지사→사무국장→시설장 (D-13)',
  gps_lat             DECIMAL(10,7)   NULL,
  gps_lng             DECIMAL(10,7)   NULL,
  gps_radius_m        SMALLINT UNSIGNED NULL DEFAULT 100,
  tag_margin_minutes  SMALLINT UNSIGNED NULL DEFAULT 30
                      COMMENT '[v1.2] 출퇴근 태그 허용 시간 여유(교대 전후 n분, A-6 — Phase 3)',
  admin_call_phone    VARCHAR(20)     NULL
                      COMMENT '[v1.2] 태그 실패 시 관리자 호출 전화번호(C-11 — Phase 3).
                               실번호는 운영 설정에서 입력, 문서·시드에 미기재',
  addon_target_score  DECIMAL(5,2)    NULL COMMENT '목표 가산 점수(관리자 설정, §4.3)',
  created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                       ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT chk_facility_ratio  CHECK (staffing_ratio IN (2.1, 2.3)),
  CONSTRAINT chk_facility_steps  CHECK (approval_steps BETWEEN 1 AND 3)
) ENGINE=InnoDB COMMENT='시설 기본정보 및 정책 설정';

-- [v1.2 신설] 팀 (직원 등록 시 지정, 설정에서 변경 — §1.3, §4.5)
CREATE TABLE team (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  facility_id         BIGINT UNSIGNED NOT NULL,
  name                VARCHAR(50)     NOT NULL COMMENT '예: 1층팀, 2층팀',
  sort_order          SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_team_name (facility_id, name),
  CONSTRAINT fk_team_facility FOREIGN KEY (facility_id) REFERENCES facility(id)
) ENGINE=InnoDB COMMENT='팀. 종사자는 본인 팀 근무표만 조회(개인정보 보호 — 앱 레벨)';

-- 직원 (직군은 고시 별표 4 기준 13종)
CREATE TABLE employee (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  facility_id         BIGINT UNSIGNED NOT NULL,
  team_id             BIGINT UNSIGNED NULL COMMENT '[v1.2] 소속 팀(직원 등록 시 지정, 변경 가능)',
  name                VARCHAR(50)     NOT NULL,
  job_role            ENUM('DIRECTOR','OFFICE_MANAGER','SOCIAL_WORKER',
                           'NURSE','NURSE_AIDE','PHYSICAL_THERAPIST',
                           'OCCUPATIONAL_THERAPIST','CAREGIVER','CLERK',
                           'DIETITIAN','COOK','HYGIENIST','JANITOR')
                      NOT NULL COMMENT '시설장/사무국장/사회복지사/간호사/간호조무사/물리치료사/작업치료사/요양보호사/사무원/영양사/조리원/위생원/관리인',
  is_rn               TINYINT(1)      NOT NULL DEFAULT 0
                      COMMENT '간호사(RN) 여부 — 간호사배치 가산은 조무사 제외',
  system_role         ENUM('SUPER_ADMIN','ADMIN','STAFF') NOT NULL DEFAULT 'STAFF'
                      COMMENT '시스템 권한. 역할 4종 매핑: 시설장=SUPER_ADMIN,
                               사무국장·사회복지사=ADMIN(세부 권한 차등은 앱 레벨 §1.3), 근무자=STAFF',
  hire_date           DATE            NOT NULL COMMENT '연차연도(year_basis)·소멸 임박 판정(C-10)의 기준',
  status              ENUM('ACTIVE','ON_LEAVE','RESIGNED') NOT NULL DEFAULT 'ACTIVE',
  can_shift_work      TINYINT(1)      NOT NULL DEFAULT 1 COMMENT '근무 가능 형태(주간만=0 / 교대 가능=1)',
  pin_hash            VARCHAR(255)    NULL COMMENT 'PIN 해시(bcrypt/argon2) — 평문 저장 금지',
  signature_path      VARCHAR(255)    NULL
                      COMMENT '저장된 서명 이미지의 스토리지 경로(key).
                               결재 권한자는 최초 승인 전 등록 필수 — 앱 레벨 강제(D-12).
                               근무자 등록 여부는 D-16(서명 수단) 확정에 따름',
  created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                       ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_emp_facility_role (facility_id, job_role, status),
  KEY idx_emp_team (team_id),
  CONSTRAINT fk_emp_facility FOREIGN KEY (facility_id) REFERENCES facility(id),
  CONSTRAINT fk_emp_team     FOREIGN KEY (team_id)     REFERENCES team(id)
) ENGINE=InnoDB COMMENT='직원 마스터 (개인정보 최소수집: 주민번호·연락처 등 미보유)';

-- 등록 기기 (기기등록 + PIN 인증, 관리자 발급 코드로 최초 1회 등록 — C-13/N-10)
CREATE TABLE user_device (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id         BIGINT UNSIGNED NOT NULL,
  device_uid          VARCHAR(128)    NOT NULL COMMENT '기기 식별자(설치 시 발급 UUID)',
  device_label        VARCHAR(100)    NULL COMMENT '예: 갤럭시 A25',
  registered_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at          DATETIME        NULL COMMENT '기기 분실 시 관리자 해제(원격 로그아웃 — 엣지 7)',
  PRIMARY KEY (id),
  UNIQUE KEY uq_device_uid (device_uid),
  KEY idx_device_emp (employee_id),
  CONSTRAINT fk_device_emp FOREIGN KEY (employee_id) REFERENCES employee(id)
) ENGINE=InnoDB COMMENT='종사자 등록 기기';

-- 근무유형 (시설별 시각 정의 — 기본값은 §4.7 확정표, A-6에서 조정)
CREATE TABLE shift_type (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  facility_id         BIGINT UNSIGNED NOT NULL,
  code                VARCHAR(10)     NOT NULL COMMENT '예: D, N, NF, OFF, AL, SUB, SICK, ABS',
  label               VARCHAR(30)     NOT NULL COMMENT '예: 주간, 야간(주야비), 휴무, 연차, 휴일대체',
  start_time          TIME            NULL COMMENT '근무유형이 아닌 경우(휴무 등) NULL',
  end_time            TIME            NULL,
  break_minutes       SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '휴게시간 합계(분)',
  crosses_midnight    TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '야간 등 자정 넘김',
  counts_as_work      TINYINT(1)      NOT NULL DEFAULT 1,
  recognized_minutes  SMALLINT UNSIGNED NULL
                      COMMENT '[v1.2] §4.1/§4.7 기준근무시간 인정분(분).
                               주간=480, 야간(주야비)=580(9h40m), 연차=480, 반차=240,
                               유급병가=480, 휴무·결근=0(불인정 — NULL 아닌 0).
                               유급휴일대체는 §4.4 규칙(당월 기준시간 초과분, 최대 480분)으로
                               ledger에서 별도 산정 — 본 칼럼 값은 근로자 관점 표기용',
  cell_label          VARCHAR(10)     NULL COMMENT '[v1.2] 근무표 셀 표기(§4.7): 주/야/휴/연/오전/오후/유/병/결',
  sort_order          SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_shift_code (facility_id, code),
  CONSTRAINT fk_shift_facility FOREIGN KEY (facility_id) REFERENCES facility(id)
) ENGINE=InnoDB COMMENT='근무유형 정의. "유(인정시간,분)" 세부 표기는 편집기 화면 한정(§4.4) — UI 레벨';

-- 법정공휴일 캘린더 (대체공휴일 포함 — 출처 확정은 V-4)
CREATE TABLE public_holiday (
  holiday_date        DATE            NOT NULL,
  name                VARCHAR(50)     NOT NULL COMMENT '예: 설날, 대체공휴일(설날)',
  is_substitute       TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '대체공휴일 여부',
  PRIMARY KEY (holiday_date)
) ENGINE=InnoDB COMMENT='법정공휴일(대체공휴일 포함 — 용어 통일 §4.1). 연 1회 이상 관리자/배치 갱신';

-- =============================================================
-- [Phase 1] 결재 시스템 (개발 1순위)
-- =============================================================

-- 결재선 설정 (D-13: 1~3단계, 역할 또는 개인 지정, 전결, 대결자)
CREATE TABLE approval_line (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  facility_id         BIGINT UNSIGNED NOT NULL,
  step_no             TINYINT UNSIGNED NOT NULL COMMENT '[v1.2] 1~3. 표준: 1=사회복지사, 2=사무국장, 3=시설장',
  approver_role       ENUM('SOCIAL_WORKER','OFFICE_MANAGER','DIRECTOR') NULL
                      COMMENT '[v1.2] 역할 지정 방식. approver_id 와 택일(둘 중 하나는 NOT NULL — 앱 레벨)',
  approver_id         BIGINT UNSIGNED NULL COMMENT '개인 지정 방식의 결재자',
  deputy_id           BIGINT UNSIGNED NULL COMMENT '대결자(결재자 부재 시 승계 — 엣지 2)',
  delegation_enabled  TINYINT(1)      NOT NULL DEFAULT 0
                      COMMENT '[v1.2] 전결 위임(D-13). 대상은 step_no=2(사무국장)에 한함 —
                               ON이면 2단계 승인이 곧 최종 확정(APPROVED)',
  effective_from      DATE            NOT NULL DEFAULT (CURRENT_DATE),
  effective_to        DATE            NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_line_step (facility_id, step_no, effective_from),
  CONSTRAINT fk_line_facility FOREIGN KEY (facility_id) REFERENCES facility(id),
  CONSTRAINT fk_line_approver FOREIGN KEY (approver_id) REFERENCES employee(id),
  CONSTRAINT fk_line_deputy   FOREIGN KEY (deputy_id)   REFERENCES employee(id),
  CONSTRAINT chk_line_step CHECK (step_no BETWEEN 1 AND 3),
  CONSTRAINT chk_line_delegation CHECK (delegation_enabled = 0 OR step_no = 2)
) ENGINE=InnoDB COMMENT='결재선 (1~3단계 + 전결 + 대결자). 자기결재 금지는 앱 레벨(D-6)';

-- 결재 신청 헤더
CREATE TABLE approval_request (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  facility_id         BIGINT UNSIGNED NOT NULL,
  requester_id        BIGINT UNSIGNED NOT NULL,
  type                ENUM('ANNUAL','HALF_AM','HALF_PM','SUBSTITUTE_HOLIDAY',
                           'SHIFT_CHANGE','CANCEL')
                      NOT NULL COMMENT '연차/오전반차/오후반차/유대/근무조정/취소신청.
                               Phase 3에서 MANUAL_TAG(수동태그·미태그 사유) 추가 예정(§5.1)',
  desired_shift_id    BIGINT UNSIGNED NULL COMMENT 'SHIFT_CHANGE: 희망 근무유형',
  desired_start_time  TIME            NULL
                      COMMENT '[v1.3] SHIFT_CHANGE 희망 출근 시각(조기출근 등, §4.7 근무조정).
                               NULL이면 desired_shift 기본 시각 사용. 승인 시 schedule_entry.override_start_time로 반영',
  desired_end_time    TIME            NULL
                      COMMENT '[v1.3] SHIFT_CHANGE 희망 퇴근 시각(조기퇴근 등).
                               NULL이면 desired_shift 기본 시각 사용',
  reason              VARCHAR(500)    NULL
                      COMMENT '[v1.2] 사유. 연차·반차·유대=선택 / SHIFT_CHANGE=필수(D-14) —
                               NOT NULL 강제는 앱 레벨(400 REASON_REQUIRED)',
  ref_request_id      BIGINT UNSIGNED NULL COMMENT 'CANCEL 유형이 참조하는 원건',
  status              ENUM('PENDING','INTERIM_APPROVED','APPROVED','REJECTED',
                           'CANCELED','CANCELED_AFTER_APPROVAL')
                      NOT NULL DEFAULT 'PENDING',
  current_step        TINYINT UNSIGNED NOT NULL DEFAULT 0
                      COMMENT '[v1.2] 완료된 결재 단계 수(§3.4). PENDING=0,
                               INTERIM_APPROVED에서 1 또는 2',
  is_final_by_delegation TINYINT(1)   NOT NULL DEFAULT 0
                      COMMENT '[v1.2] 전결로 최종 확정된 건(감사 식별 — D-13, 출력 서식에 "전결" 표기)',
  leave_days          DECIMAL(4,1)    NULL
                      COMMENT '차감량. 연차=일수, 반차=0.5, 유대=1.0(1일 단위 — D-15).
                               차감 대상은 type으로 결정(연차계열→leave_balance,
                               SUBSTITUTE_HOLIDAY→substitute_holiday_balance). 조정/취소는 NULL',
  is_retroactive      TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '사후 신청 라벨(D-3, 7일 이내)',
  idempotency_key     CHAR(36)        NULL COMMENT '더블탭 중복 제출 방지(§3.7 멱등키)',
  created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finalized_at        DATETIME        NULL COMMENT '종결(승인/반려/취소) 시각',
  PRIMARY KEY (id),
  UNIQUE KEY uq_req_idem (idempotency_key),
  KEY idx_req_inbox (facility_id, status, created_at) COMMENT '결재함: 대기 오래된 순(US-04)',
  KEY idx_req_mine  (requester_id, created_at),
  CONSTRAINT fk_req_facility  FOREIGN KEY (facility_id)      REFERENCES facility(id),
  CONSTRAINT fk_req_requester FOREIGN KEY (requester_id)     REFERENCES employee(id),
  CONSTRAINT fk_req_shift     FOREIGN KEY (desired_shift_id) REFERENCES shift_type(id),
  CONSTRAINT fk_req_ref       FOREIGN KEY (ref_request_id)   REFERENCES approval_request(id)
) ENGINE=InnoDB COMMENT='결재 신청 헤더';

-- [v1.2 신설] 제출 시점 결재선 스냅샷 (엣지 12 — 설정 중도 변경 비소급)
-- [v1.2.1] CANCEL 유형은 stepNo=1 고정 + 시설 결재선 전원을 후보로 스냅샷(누구든 결재 가능).
-- 한 step_no에 여러 결재자 후보 행이 생길 수 있어 PK에 approver_id를 포함한다.
CREATE TABLE approval_request_line (
  request_id          BIGINT UNSIGNED NOT NULL,
  step_no             TINYINT UNSIGNED NOT NULL COMMENT '1~3. CANCEL 유형은 1로 고정',
  approver_id         BIGINT UNSIGNED NOT NULL COMMENT '제출 시점에 확정된 해당 단계 결재자 후보
                                                         (역할 지정이면 당시 재직자로 해석·고정).
                                                         같은 step_no에 여러 행이면 그 중 누구든
                                                         결재 시 해당 단계가 처리된다(CANCEL 유형)',
  deputy_id           BIGINT UNSIGNED NULL,
  delegation_enabled  TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '제출 시점 전결 설정(step 2)',
  PRIMARY KEY (request_id, step_no, approver_id),
  CONSTRAINT fk_reqline_req      FOREIGN KEY (request_id)  REFERENCES approval_request(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_reqline_approver FOREIGN KEY (approver_id) REFERENCES employee(id),
  CONSTRAINT fk_reqline_deputy   FOREIGN KEY (deputy_id)   REFERENCES employee(id),
  CONSTRAINT chk_reqline_step CHECK (step_no BETWEEN 1 AND 3)
) ENGINE=InnoDB COMMENT='신청별 결재선 스냅샷. 자기결재 회피(D-6)로 재배정된 결과를 반영해 저장. CANCEL 유형은 stepNo=1에 결재선 전원을 후보로 저장(누구든 결재 가능)';

-- 신청 대상일 (target_dates[] 정규화 — MySQL 배열 미지원 대응)
CREATE TABLE approval_request_date (
  request_id          BIGINT UNSIGNED NOT NULL,
  target_date         DATE            NOT NULL,
  PRIMARY KEY (request_id, target_date),
  KEY idx_reqdate_date (target_date) COMMENT '같은 날 신청 배지(US-04)·중복신청 검사용',
  CONSTRAINT fk_reqdate_req FOREIGN KEY (request_id)
    REFERENCES approval_request(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='신청 대상 일자 (연차 다중일 지원. 반차·유대·조정은 1행)';

-- 결재 이력 (append-only, 감사 추적 — US-07)
CREATE TABLE approval_history (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id          BIGINT UNSIGNED NOT NULL,
  actor_id            BIGINT UNSIGNED NOT NULL,
  action              ENUM('SUBMIT','APPROVE','REJECT','CANCEL') NOT NULL,
  step_no             TINYINT UNSIGNED NULL COMMENT '결재 행위의 단계 1~3(제출/취소는 NULL)',
  is_delegated_final  TINYINT(1)      NOT NULL DEFAULT 0
                      COMMENT '[v1.2] 이 APPROVE가 전결에 의한 최종 확정임(출력 서식 "전결" 표기 근거)',
  comment             VARCHAR(500)    NULL COMMENT 'REJECT 시 반려사유 — 애플리케이션에서 필수 검증',
  signature_snapshot_path VARCHAR(255) NULL
                      COMMENT 'APPROVE 시점 서명 이미지 사본의 스토리지 경로(key).
                               원본(employee.signature_path)이 아닌 승인 시점 복제본 —
                               이후 서명 변경이 과거 문서에 소급되지 않음(D-12).
                               출력용 서식의 단계별 결재란은 이 값을 사용',
  acted_at            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_hist_req (request_id, acted_at),
  CONSTRAINT fk_hist_req   FOREIGN KEY (request_id) REFERENCES approval_request(id),
  CONSTRAINT fk_hist_actor FOREIGN KEY (actor_id)   REFERENCES employee(id)
) ENGINE=InnoDB COMMENT='결재 이력 — 불변(append-only). 아래 트리거로 수정·삭제 차단';

-- append-only 강제 트리거 (운영 계정 UPDATE/DELETE 미부여 + 이중 방어)
DELIMITER //
CREATE TRIGGER trg_hist_no_update BEFORE UPDATE ON approval_history
FOR EACH ROW BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'approval_history is append-only';
END //
CREATE TRIGGER trg_hist_no_delete BEFORE DELETE ON approval_history
FOR EACH ROW BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'approval_history is append-only';
END //
DELIMITER ;

-- 연차 잔여 (1일 단위 — 이중신청 방지 reserved 포함, D-2)
CREATE TABLE leave_balance (
  employee_id         BIGINT UNSIGNED NOT NULL,
  balance_year        YEAR            NOT NULL
                      COMMENT '[v1.2] year_basis: 입사일 기준 연차연도의 시작 연도(§3.5).
                               소멸 임박 판정(C-10: 입사일 도래 60일/30일 전)의 입력.
                               회계연도 기준 운영은 파일럿 후 보완(§8-11)',
  granted             DECIMAL(4,1)    NOT NULL DEFAULT 0
                      COMMENT '부여(D-9): 1년 미만 월 개근 시 익월 1일 / 1년차 15일 /
                               이후 2년마다 +1, 총 상한 25일([V-3 원문 확인 필요]).
                               Phase 1은 관리자 수동 입력, 자동 산정은 Phase 5',
  used                DECIMAL(4,1)    NOT NULL DEFAULT 0 COMMENT '사용 확정(최종 APPROVED 시 가산)',
  reserved            DECIMAL(4,1)    NOT NULL DEFAULT 0 COMMENT '대기중 예약(제출 시 가산, 종결 시 해제)',
  remaining           DECIMAL(5,1)    GENERATED ALWAYS AS (granted - used - reserved) STORED,
  updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                       ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (employee_id, balance_year),
  CONSTRAINT fk_bal_emp FOREIGN KEY (employee_id) REFERENCES employee(id)
) ENGINE=InnoDB COMMENT='연차 잔여. 음수 허용(엣지 3) — 승인 시 경고 배지·확인 모달은 앱 레벨';

-- 유대 잔여 — 1일 단위 "사용 트랙" (D-15)
CREATE TABLE substitute_holiday_balance (
  employee_id         BIGINT UNSIGNED NOT NULL,
  balance_year        YEAR            NOT NULL
                      COMMENT '발생 연도. 당해 연도 말 소멸, 이월 없음(D-11) —
                               만료 판정은 앱/배치 레벨(연도 경과분 사용 차단)',
  granted             DECIMAL(4,1)    NOT NULL DEFAULT 0
                      COMMENT '[v1.2] 부여 합계(1일 단위). ledger 행 생성과 1:1 연동(+1) —
                               D-15, 대장이 부여의 원천 기록(D-10 개정). 정합성은 앱 레벨',
  used                DECIMAL(4,1)    NOT NULL DEFAULT 0,
  reserved            DECIMAL(4,1)    NOT NULL DEFAULT 0,
  remaining           DECIMAL(5,1)    GENERATED ALWAYS AS (granted - used - reserved) STORED,
  updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                       ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (employee_id, balance_year),
  CONSTRAINT fk_shbal_emp FOREIGN KEY (employee_id) REFERENCES employee(id)
) ENGINE=InnoDB COMMENT='유대 잔여(1일 트랙). 잔여 0이면 신청 버튼 비활성(US-01).
  12월 초 보유자 소멸 예정 알림(SH_EXPIRY)은 배치(엣지 8)';

-- [v1.2 신설] 유대 관리대장 — 시간 단위 "공단 인정 트랙" (A-4, D-15)
--   ※ v1.1의 substitute_holiday_grant 를 대체. 행 생성 = balance +1 (1:1)
CREATE TABLE substitute_holiday_ledger (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id         BIGINT UNSIGNED NOT NULL,
  worked_holiday_date DATE            NOT NULL COMMENT '근무일(법정공휴일)',
  worked_shift        ENUM('DAY','NIGHT') NOT NULL COMMENT '근무 구분(주간/야간)',
  planned_use_date    DATE            NULL COMMENT '사용예정일자(Phase 1 수동 / Phase 2 근무표 연동)',
  planned_use_shift   ENUM('DAY','NIGHT') NULL COMMENT '사용 구분',
  base_monthly_hours  DECIMAL(6,2)    NULL
                      COMMENT '월기준근무시간(h). Phase 1 관리자 수동 기입 / Phase 2 §4.1 산식 자동.
                               Phase 1 서명 완료분은 재계산하지 않음(비소급 원칙 §4.4)',
  actual_worked_hours DECIMAL(6,2)    NULL COMMENT '실근무시간(h). Phase 1 수동 / Phase 3 GPS 자동',
  carryable_minutes   SMALLINT UNSIGNED NOT NULL DEFAULT 0
                      COMMENT '이월가능시간(분). §4.4: clamp(실근무 − 월기준, 0, 480).
                               Phase 1 수동 기입, Phase 2부터 자동 계산',
  sign_status         ENUM('NOT_REQUESTED','SIGN_REQUESTED','SIGNED')
                      NOT NULL DEFAULT 'NOT_REQUESTED'
                      COMMENT '근무자 확인 서명 상태(US-08~09). 7일 미서명 재알림은 배치(엣지 10)',
  sign_requested_at   DATETIME        NULL,
  signed_at           DATETIME        NULL,
  employee_signature_snapshot_path VARCHAR(255) NULL
                      COMMENT '서명 시점 사본(key) — SIGNED 시 필수(앱 레벨). 수단은 D-16 결정 대기.
                               행 정정 시 무효화(NULL 처리 + 재서명 요청 자동 발송 — 엣지 9)',
  created_by          BIGINT UNSIGNED NOT NULL COMMENT '기입 관리자(= 유대 1일 부여자)',
  created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  amended_by          BIGINT UNSIGNED NULL COMMENT '최근 정정 관리자',
  amended_at          DATETIME        NULL,
  amend_reason        VARCHAR(300)    NULL COMMENT '정정 사유 — 정정 시 필수(앱 레벨, US-08)',
  revoked_by          BIGINT UNSIGNED NULL COMMENT '부여 취소 관리자(공휴일 근무 기록 오류 — 엣지 9)',
  revoked_at          DATETIME        NULL,
  revoke_reason       VARCHAR(300)    NULL
                      COMMENT '취소 시 balance -1 회수. 이미 사용된 뒤면 회수 대신 경고 표시(앱 레벨)',
  source              ENUM('MANUAL','ATTENDANCE') NOT NULL DEFAULT 'MANUAL'
                      COMMENT 'ATTENDANCE = Phase 3 공휴일 근무 감지 후보의 관리자 확정분(D-10)',
  PRIMARY KEY (id),
  UNIQUE KEY uq_ledger_emp_day (employee_id, worked_holiday_date) COMMENT '동일 공휴일 중복 부여 방지',
  KEY idx_ledger_sign (sign_status, sign_requested_at) COMMENT '미서명 재알림 배치·대시보드 배지',
  CONSTRAINT fk_ledger_emp      FOREIGN KEY (employee_id) REFERENCES employee(id),
  CONSTRAINT fk_ledger_creator  FOREIGN KEY (created_by)  REFERENCES employee(id),
  CONSTRAINT fk_ledger_amender  FOREIGN KEY (amended_by)  REFERENCES employee(id),
  CONSTRAINT fk_ledger_revoker  FOREIGN KEY (revoked_by)  REFERENCES employee(id),
  CONSTRAINT chk_ledger_carryable CHECK (carryable_minutes BETWEEN 0 AND 480)
) ENGINE=InnoDB COMMENT='유대 관리대장(감사용, 시간 트랙). 유효 행 수 = balance.granted (앱 레벨 정합성).
  감사용 출력 서식(서명 포함)의 원천 — 세부 정정 이력은 별도 감사로그(앱 레벨) 병행 권장';

-- 알림 (인앱 확정, 채널 확장 대비 — D-7 결정 대기)
CREATE TABLE notification (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  recipient_id        BIGINT UNSIGNED NOT NULL,
  request_id          BIGINT UNSIGNED NULL,
  ledger_id           BIGINT UNSIGNED NULL COMMENT '[v1.2] SIGN_REQUEST 등 유대 대장 관련 알림의 참조',
  kind                ENUM('NEW_REQUEST','STEP_APPROVED','APPROVED','REJECTED','REMINDER',
                           'SIGN_REQUEST','LEAVE_EXPIRY_60D','LEAVE_EXPIRY_30D','SH_EXPIRY')
                      NOT NULL
                      COMMENT '[v1.2] STEP_APPROVED=중간승인 통지(다음 결재자·취소 통지 겸용),
                               SIGN_REQUEST=유대 확인 서명 요청(US-09),
                               LEAVE_EXPIRY_60D/30D=연차 소멸 임박 관리자 알림
                               (60일 전 잔여 3일↑=노랑 / 30일 전 잔여 존재=빨강 — C-10,
                                대상자 다수 시 1일 1회 집계 발송은 배치 — 엣지 13),
                               SH_EXPIRY=유대 당해 연도 소멸 예정(엣지 8)',
  channel             ENUM('IN_APP','PUSH','ALIMTALK') NOT NULL DEFAULT 'IN_APP',
  body                VARCHAR(300)    NOT NULL,
  read_at             DATETIME        NULL,
  created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_noti_recipient (recipient_id, read_at, created_at),
  CONSTRAINT fk_noti_recipient FOREIGN KEY (recipient_id) REFERENCES employee(id),
  CONSTRAINT fk_noti_request   FOREIGN KEY (request_id)   REFERENCES approval_request(id),
  CONSTRAINT fk_noti_ledger    FOREIGN KEY (ledger_id)    REFERENCES substitute_holiday_ledger(id)
) ENGINE=InnoDB COMMENT='알림. 24시간 미처리 REMINDER는 단계별 1회 배치 생성(D-8)';

-- =============================================================
-- [Phase 2~4] 근무표 · 고시 파라미터 · 출퇴근 · 마감 (선행 정의)
--  * Phase 1 개발에는 불필요하나, FK 관계 확정을 위해 함께 배포 가능
-- =============================================================

-- 고시 파라미터 (연도/개정 버전 관리 — 수치 하드코딩 금지 원칙, A-6)
CREATE TABLE regulation_param_set (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  effective_from        DATE            NOT NULL,
  effective_to          DATE            NULL,
  hours_per_day         TINYINT UNSIGNED NOT NULL DEFAULT 8
                        COMMENT '§4.1 산식: 월 기준근무시간 =
                                 (월 일수 − 토·일 − public_holiday) × 본 값',
  monthly_base_hours    DECIMAL(6,2)    NULL
                        COMMENT '수동 override. NULL이면 §4.1 산식으로 월별 자동 계산',
  ratio_caregiver       DECIMAL(3,1)    NOT NULL DEFAULT 2.1 COMMENT '요양보호사 n명당 1 (V-2)',
  ratio_nurse_per       SMALLINT UNSIGNED NOT NULL DEFAULT 25 COMMENT '간호(조무)사 입소자 n명당 1',
  ratio_cook_per        SMALLINT UNSIGNED NOT NULL DEFAULT 25 COMMENT '조리원 입소자 n명당 1',
  addon_nurse_extra_pt  DECIMAL(3,1)    NOT NULL DEFAULT 1.2 COMMENT '간호(조무)사 추가배치 1인당',
  addon_nurse_ratio_max DECIMAL(4,1)    NOT NULL DEFAULT 19.0 COMMENT '추가배치 인정: 1인당 입소자 미만 기준',
  addon_sw_pt           DECIMAL(3,1)    NOT NULL DEFAULT 1.4 COMMENT '사회복지사 추가배치 1인당',
  addon_pt_pt           DECIMAL(3,1)    NOT NULL DEFAULT 1.4 COMMENT '물리(작업)치료사 추가배치 1인당',
  addon_night_pt        DECIMAL(3,1)    NOT NULL DEFAULT 0.9 COMMENT '야간직원배치 가산',
  night_ratio_max       SMALLINT UNSIGNED NOT NULL DEFAULT 20 COMMENT '야간직원 1인당 입소자 상한',
  day_night_multiple    TINYINT UNSIGNED  NOT NULL DEFAULT 2  COMMENT '주간인력 ≥ 야간 × n',
  night_divisor         TINYINT UNSIGNED  NOT NULL DEFAULT 7  COMMENT '야간배치 인력수 산정 제수',
  day_divisor           TINYINT UNSIGNED  NOT NULL DEFAULT 14 COMMENT '주간배치 인력수 산정 제수',
  addon_rn_pt           DECIMAL(3,1)    NOT NULL DEFAULT 0.6 COMMENT '간호사배치 가산 1인당',
  addon_rn_bonus_50     DECIMAL(3,1)    NOT NULL DEFAULT 0.2 COMMENT '입소자 50인 이상 추가',
  sub_holiday_max_hours DECIMAL(3,1)    NOT NULL DEFAULT 8.0
                        COMMENT '§4.4 유대 공단 인정 상한(당월 기준시간 초과분만, 최대 8h=480분)',
  annual_leave_cap_days TINYINT UNSIGNED NOT NULL DEFAULT 25
                        COMMENT '[v1.2] D-9 연차 가산 포함 총 상한 —
                                 [V-3 근로기준법 제60조 제4항 원문 대조 후 확정 표기]',
  rounding_rules        JSON            NULL COMMENT '계산식별 반올림/절사 규칙
                        (§4.2 가산=버림, 감액=둘째자리 버림 후 첫째자리 4이하 버림,
                         §4.3 입소자÷인원=셋째자리 절사 등)',
  PRIMARY KEY (id),
  KEY idx_param_period (effective_from, effective_to)
) ENGINE=InnoDB COMMENT='고시 수치 버전 관리 — 개정 시 새 행 추가';

-- 월별 입소자 현원 (인력산정 입력값)
CREATE TABLE monthly_census (
  facility_id         BIGINT UNSIGNED NOT NULL,
  `year_month`        CHAR(7)         NOT NULL COMMENT 'YYYY-MM',
  resident_count      SMALLINT UNSIGNED NOT NULL COMMENT '해당 월 입소자 수',
  service_days        TINYINT UNSIGNED NOT NULL COMMENT '급여제공일수',
  PRIMARY KEY (facility_id, `year_month`),
  CONSTRAINT fk_census_facility FOREIGN KEY (facility_id) REFERENCES facility(id)
) ENGINE=InnoDB COMMENT='월별 입소자 수 및 급여제공일수';

-- [v1.2 신설] 일별 적정 인원 설정 (§4.5 — 팀×주/야 최소·최대, A-6)
CREATE TABLE daily_staffing_rule (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  facility_id         BIGINT UNSIGNED NOT NULL,
  team_id             BIGINT UNSIGNED NULL COMMENT 'NULL = 시설 전체 기준',
  period              ENUM('DAY','NIGHT') NOT NULL,
  min_count           TINYINT UNSIGNED NOT NULL DEFAULT 0,
  max_count           TINYINT UNSIGNED NULL COMMENT 'NULL = 상한 없음',
  PRIMARY KEY (id),
  UNIQUE KEY uq_dsr (facility_id, team_id, period),
  CONSTRAINT fk_dsr_facility FOREIGN KEY (facility_id) REFERENCES facility(id),
  CONSTRAINT fk_dsr_team     FOREIGN KEY (team_id)     REFERENCES team(id)
) ENGINE=InnoDB COMMENT='일별 주/야 적정 인원. 달력 미니맵 과·부족 하이라이트의 기준';

-- 월 근무표 (상태머신 §4.8 — DRAFT→COMPLETED→CLOSING_APPROVAL→CLOSED)
CREATE TABLE roster (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  facility_id         BIGINT UNSIGNED NOT NULL,
  `year_month`        CHAR(7)         NOT NULL COMMENT 'YYYY-MM',
  status              ENUM('DRAFT','COMPLETED','CLOSING_APPROVAL','CLOSED')
                      NOT NULL DEFAULT 'DRAFT'
                      COMMENT '[v1.2] 작성중→작성완료→마감결재→마감(§4.8).
                               COMPLETED에서 셀 수정 시 DRAFT 복귀, 반려 시 DRAFT 복귀 —
                               전이·로그는 앱 레벨',
  submitted_by        BIGINT UNSIGNED NULL COMMENT '[v1.2] 마감 상신자(사회복지사)',
  submitted_at        DATETIME        NULL,
  closed_by           BIGINT UNSIGNED NULL COMMENT '마감 승인자(사무국장/시설장)',
  closed_at           DATETIME        NULL,
  force_closed        TINYINT(1)      NOT NULL DEFAULT 0
                      COMMENT '[v1.2] 위반 존재 상태의 강행 마감 여부(D-19)',
  force_close_reason  VARCHAR(500)    NULL
                      COMMENT '[v1.2] 강행 마감 사유 — force_closed=1 시 필수(앱 레벨).
                               당시 위반 목록은 validation_result 스냅샷으로 보존',
  created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_roster_month (facility_id, `year_month`),
  CONSTRAINT fk_roster_facility  FOREIGN KEY (facility_id)  REFERENCES facility(id),
  CONSTRAINT fk_roster_submitter FOREIGN KEY (submitted_by) REFERENCES employee(id),
  CONSTRAINT fk_roster_closer    FOREIGN KEY (closed_by)    REFERENCES employee(id)
) ENGINE=InnoDB COMMENT='월 근무표 헤더. CLOSED 셀 직접 수정 금지 — 결재 경유로만(§4.8 불변 규칙)';

-- 근무표 셀 (직원 × 일자)
CREATE TABLE schedule_entry (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  roster_id           BIGINT UNSIGNED NOT NULL,
  employee_id         BIGINT UNSIGNED NOT NULL,
  work_date           DATE            NOT NULL,
  shift_type_id       BIGINT UNSIGNED NOT NULL,
  source              ENUM('MANUAL','PRESET','APPROVAL') NOT NULL DEFAULT 'MANUAL'
                      COMMENT 'APPROVAL = 결재 이벤트로 자동 반영된 셀(연차·유대·조정).
                               병가·결근은 관리자 MANUAL 입력(D-18)',
  is_provisional      TINYINT(1)      NOT NULL DEFAULT 0
                      COMMENT '[v1.2] 가반영 표시(§4.10): step_approved 구독 시 1(글자만),
                               approved 구독 시 0으로 확정(셀 색칠)',
  override_start_time TIME            NULL
                      COMMENT '[v1.3] 셀 단위 근무시간 조정(§4.8 "모든 근무는 시간 수정 가능").
                               NULL이면 shift_type 기본 start_time 사용. 값이 있으면 편집기·출력에
                               "근무종류(시작~종료)"로 표기(예: 주(08:50~19:00), 조(07:30,17:00))',
  override_end_time   TIME            NULL
                      COMMENT '[v1.3] 셀 단위 조정 퇴근 시각. override_start_time과 함께 사용(둘 다 NULL 또는 둘 다 값 — 앱 레벨)',
  source_request_id   BIGINT UNSIGNED NULL COMMENT '반영 근거 결재 건',
  source_ledger_id    BIGINT UNSIGNED NULL
                      COMMENT '[v1.3] 유대(유) 셀의 "유(이월인정시간,분)" 표기 원천(§4.4, 편집기 전용).
                               substitute_holiday_ledger 참조. 사용예정일 반영 셀에 연결',
  pre_approval_snapshot JSON NULL
                      COMMENT '[반려/취소 원복 §4.10] source_request_id 건이 셀을 최초로
                               덮어쓰기 직전 상태의 스냅샷. 반려/취소 확정 시 이 값으로 복구하고
                               비운다. NULL이면 사전에 셀 자체가 없었다는 뜻(원복=삭제)',
  PRIMARY KEY (id),
  UNIQUE KEY uq_entry (employee_id, work_date),
  KEY idx_entry_roster_date (roster_id, work_date),
  CONSTRAINT fk_entry_roster  FOREIGN KEY (roster_id)     REFERENCES roster(id),
  CONSTRAINT fk_entry_emp     FOREIGN KEY (employee_id)   REFERENCES employee(id),
  CONSTRAINT fk_entry_shift   FOREIGN KEY (shift_type_id) REFERENCES shift_type(id),
  CONSTRAINT fk_entry_request FOREIGN KEY (source_request_id) REFERENCES approval_request(id),
  CONSTRAINT fk_entry_ledger  FOREIGN KEY (source_ledger_id) REFERENCES substitute_holiday_ledger(id)
) ENGINE=InnoDB COMMENT='근무표 셀. 승인 연차가 있는 셀은 프리셋이 덮어쓰지 않음(앱 레벨)';

-- 근무 패턴 프리셋 (§4.6 — 주야비 3조 2교대 등)
CREATE TABLE shift_pattern_preset (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  facility_id         BIGINT UNSIGNED NOT NULL,
  name                VARCHAR(50)     NOT NULL COMMENT '예: 주야비 3조 2교대',
  cycle_days          TINYINT UNSIGNED NOT NULL COMMENT '패턴 주기(주야비=6)',
  team_count          TINYINT UNSIGNED NOT NULL COMMENT '조 수(주야비=3: A/B/C)',
  PRIMARY KEY (id),
  CONSTRAINT fk_preset_facility FOREIGN KEY (facility_id) REFERENCES facility(id)
) ENGINE=InnoDB COMMENT='근무 패턴 프리셋 헤더.
  월 경계 연속성(전월 패턴 이어붙임 — §4.6)은 적용 로직(앱 레벨)에서 처리';

CREATE TABLE shift_pattern_item (
  preset_id           BIGINT UNSIGNED NOT NULL,
  team_no             TINYINT UNSIGNED NOT NULL COMMENT '1=A조, 2=B조, 3=C조 …',
  day_index           TINYINT UNSIGNED NOT NULL COMMENT '주기 내 일차(1..cycle_days)',
  shift_type_id       BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (preset_id, team_no, day_index),
  CONSTRAINT fk_pitem_preset FOREIGN KEY (preset_id)     REFERENCES shift_pattern_preset(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_pitem_shift  FOREIGN KEY (shift_type_id) REFERENCES shift_type(id)
) ENGINE=InnoDB COMMENT='프리셋 상세: 조×일차별 근무유형.
  예) A조: 주·주·야·야·휴·휴 / B조: 휴·휴·주·주·야·야 / C조: 야·야·휴·휴·주·주';

-- 출퇴근 기록 (Phase 3)
CREATE TABLE attendance_record (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id         BIGINT UNSIGNED NOT NULL,
  work_date           DATE            NOT NULL COMMENT '귀속일(야간은 시작일 기준)',
  clock_in_at         DATETIME        NULL,
  clock_out_at        DATETIME        NULL,
  in_lat              DECIMAL(10,7)   NULL,
  in_lng              DECIMAL(10,7)   NULL,
  out_lat             DECIMAL(10,7)   NULL,
  out_lng             DECIMAL(10,7)   NULL,
  method              ENUM('GPS','MANUAL','ADMIN') NOT NULL DEFAULT 'GPS'
                      COMMENT 'MANUAL=수동태그·미태그 사유(결재 승인 경유 — C-14), ADMIN=관리자 보정',
  manual_request_id   BIGINT UNSIGNED NULL COMMENT 'MANUAL/ADMIN 근거 결재 건(MANUAL_TAG — Phase 3)',
  actual_minutes      SMALLINT UNSIGNED NULL COMMENT '휴게 차감 후 실근무분(자정 넘김 처리 포함).
                               ledger.actual_worked_hours 자동화의 원천(§5.1)',
  is_holiday_work     TINYINT(1)      NOT NULL DEFAULT 0
                      COMMENT '법정공휴일 근무 여부(public_holiday 대조, 배치 마킹) —
                               유대 부여 후보 제시의 근거(D-10, Phase 3)',
  status              ENUM('NORMAL','MISSING_OUT','MANUAL_PENDING') NOT NULL DEFAULT 'NORMAL',
  created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_att (employee_id, work_date),
  KEY idx_att_date (work_date, status),
  CONSTRAINT fk_att_emp FOREIGN KEY (employee_id) REFERENCES employee(id),
  CONSTRAINT fk_att_req FOREIGN KEY (manual_request_id) REFERENCES approval_request(id)
) ENGINE=InnoDB COMMENT='출퇴근. 위치는 태그 시점 좌표만 저장(상시 추적 금지).
  성능 요건: GPS 태그 처리 3초 이내(N-9 — 앱/인프라 레벨)';

-- 검증 결과 스냅샷 (작성완료·마감 시점 보존 — 사후 감사, D-19 강행 마감 근거)
CREATE TABLE validation_result (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  roster_id           BIGINT UNSIGNED NOT NULL,
  checked_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  snapshot_stage      ENUM('EDIT','COMPLETED','CLOSE') NOT NULL DEFAULT 'EDIT'
                      COMMENT '[v1.2] COMPLETED=작성완료 시 스냅샷(§4.8), CLOSE=마감(강행 포함) 시 위반 목록',
  rule_code           VARCHAR(40)     NOT NULL COMMENT '예: MONTHLY_STAFFING_CAREGIVER, NIGHT_ADDON_COND2, BASE_HOURS_SHORTFALL',
  severity            ENUM('WARN','BLOCK') NOT NULL,
  detail              JSON            NULL COMMENT '환산인원, 필요인원, 미충족 조건 등 산정 근거(N-12)',
  PRIMARY KEY (id),
  KEY idx_val_roster (roster_id, snapshot_stage, checked_at),
  CONSTRAINT fk_val_roster FOREIGN KEY (roster_id) REFERENCES roster(id)
) ENGINE=InnoDB COMMENT='고시 검증 스냅샷';

-- =============================================================
-- 초기 데이터 (예시: §4.7 근무유형 확정표 기준)
-- =============================================================
INSERT INTO facility (name, capacity) VALUES ('샘플요양원', 60);  -- id=1 가정(신규 DB)
INSERT INTO shift_type (facility_id, code, label, start_time, end_time,
                        break_minutes, crosses_midnight, counts_as_work,
                        recognized_minutes, cell_label, sort_order) VALUES
  (1, 'D',    '주간',          '08:50', '18:00',  70, 0, 1, 480, '주',   1),
  -- 검산: 9h10m − 70m = 8h = 480분
  (1, 'N',    '야간(주야비)',   '17:50', '09:00', 330, 1, 1, 580, '야',   2),
  -- 검산: 15h10m − (90m+240m) = 9h40m = 580분
  (1, 'NF',   '야간(야간전담)', '18:00', '09:00', 420, 1, 1, 480, '야',   3),
  -- 검산: 15h − (180m+240m) = 8h = 480분
  (1, 'OFF',  '휴무',          NULL,    NULL,      0, 0, 0,   0, '휴',   4),
  (1, 'AL',   '연차',          NULL,    NULL,      0, 0, 0, 480, '연',   5),
  (1, 'HAM',  '오전반차',       NULL,    NULL,      0, 0, 0, 240, '오전', 6),
  (1, 'HPM',  '오후반차',       NULL,    NULL,      0, 0, 0, 240, '오후', 7),
  (1, 'SUB',  '휴일대체',       NULL,    NULL,      0, 0, 0, 480, '유',   8),
  -- 근로자 관점 1일 휴가. 공단 인정분은 §4.4 규칙으로 ledger에서 별도 산정(최대 480분)
  (1, 'SICK', '병가(유급)',     NULL,    NULL,      0, 0, 0, 480, '병',   9),
  -- D-18: 신청·결재 유형 아님 — Phase 2 근무표 관리자 직접 입력
  (1, 'ABS',  '결근',          NULL,    NULL,      0, 0, 0,   0, '결',  10);
  -- D-18: 기준근무시간 불인정(§4.1)

-- [v1.3] 일별 적정 인원 시드(§4.5) — 목업의 하드코딩 임계값을 설정으로 이관한 예시.
-- team_id=NULL = 시설 전체 기준. 실제 값은 A-6 설정 화면에서 조정.
INSERT INTO daily_staffing_rule (facility_id, team_id, period, min_count, max_count) VALUES
  (1, NULL, 'DAY',   14, NULL),   -- 주간 최소 14명(미만이면 과부족 하이라이트)
  (1, NULL, 'NIGHT', 14, NULL);   -- 야간 최소 14명

-- =============================================================
-- 권한 가이드 (참고)
--  * 애플리케이션 계정: approval_history에 INSERT/SELECT만 부여
--    GRANT SELECT, INSERT ON carehome_tms.approval_history TO 'app'@'%';
--  * substitute_holiday_ledger 는 정정(amend)·취소(revoke)·서명 상태 갱신이 필요 —
--    UPDATE 허용하되 created_* 등 원천 감사 필드 변경은 앱 레벨에서 금지,
--    모든 정정은 amend_reason 필수 + 별도 감사로그 기록
--  * SIGNED 행 정정 시: employee_signature_snapshot_path 무효화(NULL) +
--    sign_status='SIGN_REQUESTED' 전환 + 재서명 요청 알림 자동 발송 (엣지 9 — 앱 레벨)
--  * DB 접속 정보·API 크리덴셜은 코드/환경변수에 하드코딩하지 말고
--    사내 시크릿 관리 솔루션을 통해 주입할 것 (§3.7)
-- =============================================================