-- =============================================================
-- 요양원 근태관리 프로그램 — MySQL DDL v1.1
-- 기준 문서: 개발기획서 v3.1 (§3.5, §4) + 요구사항명세서 v2.0 (§5)
-- 대상: MySQL 8.0+ / InnoDB / utf8mb4
-- 구성: [Phase 0] 공통 기반 → [Phase 1] 결재 시스템(1순위)
--       → [Phase 2~4] 근무표·출퇴근·마감 (선행 정의)
--
-- v1.0 → v1.1 변경 (기획서 v3.0 → v3.1 반영)
--   D-01. approval_request.type 에 SUBSTITUTE_HOLIDAY(유급휴일대체) 추가 (C-2)
--   D-02. substitute_holiday_balance / substitute_holiday_grant 신설 (C-2, D-10~11, 엣지 8~9)
--   D-03. 전자서명: employee.signature_path, approval_history.signature_snapshot_path 추가 (C-3, D-12)
--   D-04. notification.kind 에 EXPIRY_WARNING(유대 소멸 예정) 추가 (엣지 8)
--   D-05. public_holiday(법정·대체공휴일 캘린더) 신설 — 월 기준근무시간 산식의 입력 (§4.1)
--   D-06. regulation_param_set: hours_per_day, sub_holiday_max_hours 추가,
--         monthly_base_hours 는 수동 override 용도로 NULL 허용 (§4.1, §4.4)
--   D-07. 근무 패턴 프리셋 테이블 신설: shift_pattern_preset / shift_pattern_item (§4.6)
--   D-08. shift_type 초기 데이터에 SUB(휴일대체) 추가, leave_balance 주석 D-9 개정 반영
--
-- 설계 메모:
--   * v3의 target_dates date[] 는 MySQL에 배열 타입이 없어
--     자식 테이블(approval_request_date)로 정규화
--   * 연차는 반차(0.5일) 지원을 위해 DECIMAL(4,1)
--   * leave_balance.remaining 은 생성 칼럼(granted - used - reserved)
--   * approval_history 는 append-only: 트리거로 UPDATE/DELETE 차단
--   * 비밀번호/PIN은 해시만 저장 (평문·복호화 가능 형태 저장 금지)
--   * 서명 이미지는 오브젝트 스토리지에 저장하고 DB에는 경로(key)만 보관.
--     결재 승인 시점의 서명 "사본"을 별도 key로 복제해 이후 서명 변경이
--     과거 문서에 소급되지 않도록 한다(D-12)
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
                      COMMENT '요양보호사 배치기준 (2.1 또는 2.3)',
  outsourced_meal     TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '위탁급식(영양사·조리원 면제)',
  outsourced_laundry  TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '위탁세탁(위생원 면제)',
  approval_steps      TINYINT UNSIGNED NOT NULL DEFAULT 1
                      COMMENT '결재 단계 수 (1 또는 2)',
  gps_lat             DECIMAL(10,7)   NULL,
  gps_lng             DECIMAL(10,7)   NULL,
  gps_radius_m        SMALLINT UNSIGNED NULL DEFAULT 100,
  addon_target_score  DECIMAL(5,2)    NULL COMMENT '목표 가산 점수(관리자 설정, §4.3)',
  created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                       ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT chk_facility_ratio  CHECK (staffing_ratio IN (2.1, 2.3)),
  CONSTRAINT chk_facility_steps  CHECK (approval_steps IN (1, 2))
) ENGINE=InnoDB COMMENT='시설 기본정보 및 정책 설정';

-- 직원 (직군은 고시 별표 4 기준 13종)
CREATE TABLE employee (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  facility_id         BIGINT UNSIGNED NOT NULL,
  name                VARCHAR(50)     NOT NULL,
  job_role            ENUM('DIRECTOR','OFFICE_MANAGER','SOCIAL_WORKER',
                           'NURSE','NURSE_AIDE','PHYSICAL_THERAPIST',
                           'OCCUPATIONAL_THERAPIST','CAREGIVER','CLERK',
                           'DIETITIAN','COOK','HYGIENIST','JANITOR')
                      NOT NULL COMMENT '시설장/사무국장/사회복지사/간호사/간호조무사/물리치료사/작업치료사/요양보호사/사무원/영양사/조리원/위생원/관리인',
  is_rn               TINYINT(1)      NOT NULL DEFAULT 0
                      COMMENT '간호사(RN) 여부 — 간호사배치 가산은 조무사 제외',
  system_role         ENUM('SUPER_ADMIN','ADMIN','STAFF') NOT NULL DEFAULT 'STAFF'
                      COMMENT '시스템 권한: 시설장/관리자/종사자',
  hire_date           DATE            NOT NULL,
  status              ENUM('ACTIVE','ON_LEAVE','RESIGNED') NOT NULL DEFAULT 'ACTIVE',
  can_shift_work      TINYINT(1)      NOT NULL DEFAULT 1 COMMENT '교대(야간) 가능 여부',
  pin_hash            VARCHAR(255)    NULL COMMENT 'PIN 해시(bcrypt/argon2) — 평문 저장 금지',
  signature_path      VARCHAR(255)    NULL
                      COMMENT '[v1.1] 저장된 서명 이미지의 스토리지 경로(key).
                               결재 권한자(ADMIN 이상)는 최초 승인 전 등록 필수 — 앱 레벨 강제 (D-12)',
  created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                       ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_emp_facility_role (facility_id, job_role, status),
  CONSTRAINT fk_emp_facility FOREIGN KEY (facility_id) REFERENCES facility(id)
) ENGINE=InnoDB COMMENT='직원 마스터 (개인정보 최소수집: 주민번호·연락처 등 미보유)';

-- 등록 기기 (기기등록 + PIN 인증 방식)
CREATE TABLE user_device (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id         BIGINT UNSIGNED NOT NULL,
  device_uid          VARCHAR(128)    NOT NULL COMMENT '기기 식별자(설치 시 발급 UUID)',
  device_label        VARCHAR(100)    NULL COMMENT '예: 갤럭시 A25',
  registered_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at          DATETIME        NULL COMMENT '기기 분실 시 관리자 해제(원격 로그아웃)',
  PRIMARY KEY (id),
  UNIQUE KEY uq_device_uid (device_uid),
  KEY idx_device_emp (employee_id),
  CONSTRAINT fk_device_emp FOREIGN KEY (employee_id) REFERENCES employee(id)
) ENGINE=InnoDB COMMENT='종사자 등록 기기';

-- 근무유형 (주/야/휴/연차/휴일대체 등 — 시설별 시각 정의)
CREATE TABLE shift_type (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  facility_id         BIGINT UNSIGNED NOT NULL,
  code                VARCHAR(10)     NOT NULL COMMENT '예: D, N, OFF, AL, SUB',
  label               VARCHAR(30)     NOT NULL COMMENT '예: 주간, 야간, 휴무, 연차, 휴일대체',
  start_time          TIME            NULL COMMENT '근무유형이 아닌 경우(휴무 등) NULL',
  end_time            TIME            NULL,
  break_minutes       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  crosses_midnight    TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '야간 등 자정 넘김',
  counts_as_work      TINYINT(1)      NOT NULL DEFAULT 1,
  recognized_hours    DECIMAL(4,2)    NULL
                      COMMENT '고시 제12조 인정 근무시간(연차=8.00 등). 실근무 아닌 인정시간용.
                               유급휴일대체는 §4.4 규칙(당월 기준시간 초과분, 최대 8h)에 따라
                               앱 레벨에서 별도 산정 — 본 칼럼 값은 근로자 관점 표기용',
  sort_order          SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_shift_code (facility_id, code),
  CONSTRAINT fk_shift_facility FOREIGN KEY (facility_id) REFERENCES facility(id)
) ENGINE=InnoDB COMMENT='근무유형 정의';

-- [v1.1 신설] 법정공휴일 캘린더 (대체공휴일 포함)
--   용도: §4.1 월 기준근무시간 = (월 일수 − 토·일 − 공휴일) × 8 의 입력,
--         유대 발생일(법정공휴일 근무) 판정 보조
CREATE TABLE public_holiday (
  holiday_date        DATE            NOT NULL,
  name                VARCHAR(50)     NOT NULL COMMENT '예: 설날, 대체공휴일(설날)',
  is_substitute       TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '대체공휴일 여부',
  PRIMARY KEY (holiday_date)
) ENGINE=InnoDB COMMENT='법정공휴일. 연 1회 이상 관리자/배치가 갱신';

-- =============================================================
-- [Phase 1] 결재 시스템 (개발 1순위)
-- =============================================================

-- 결재선 설정 (기획서 §3.5)
CREATE TABLE approval_line (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  facility_id         BIGINT UNSIGNED NOT NULL,
  step_no             TINYINT UNSIGNED NOT NULL COMMENT '1 또는 2',
  approver_id         BIGINT UNSIGNED NOT NULL COMMENT '해당 단계 결재자',
  deputy_id           BIGINT UNSIGNED NULL COMMENT '대결자(결재자 부재 시 자동 승계)',
  effective_from      DATE            NOT NULL DEFAULT (CURRENT_DATE),
  effective_to        DATE            NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_line_step (facility_id, step_no, effective_from),
  CONSTRAINT fk_line_facility FOREIGN KEY (facility_id) REFERENCES facility(id),
  CONSTRAINT fk_line_approver FOREIGN KEY (approver_id) REFERENCES employee(id),
  CONSTRAINT fk_line_deputy   FOREIGN KEY (deputy_id)   REFERENCES employee(id),
  CONSTRAINT chk_line_step CHECK (step_no IN (1, 2))
) ENGINE=InnoDB COMMENT='결재선 (1~2단계, 대결자 포함)';

-- 결재 신청 (연차/반차/유급휴일대체/근무조정/취소신청 — 유형 확장형)
CREATE TABLE approval_request (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  facility_id         BIGINT UNSIGNED NOT NULL,
  requester_id        BIGINT UNSIGNED NOT NULL,
  type                ENUM('ANNUAL','HALF_AM','HALF_PM','SUBSTITUTE_HOLIDAY',
                           'SHIFT_CHANGE','CANCEL')
                      NOT NULL COMMENT '[v1.1] SUBSTITUTE_HOLIDAY(유급휴일대체) 추가.
                               연차/오전반차/오후반차/유대/근무조정/취소신청.
                               Phase3에서 MANUAL_TAG 추가 예정',
  desired_shift_id    BIGINT UNSIGNED NULL COMMENT 'SHIFT_CHANGE: 희망 근무유형',
  reason              VARCHAR(500)    NULL COMMENT '사유(선택 입력 — 시니어 UX 원칙)',
  ref_request_id      BIGINT UNSIGNED NULL COMMENT 'CANCEL 유형이 참조하는 원건',
  status              ENUM('PENDING','INTERIM_APPROVED','APPROVED','REJECTED',
                           'CANCELED','CANCELED_AFTER_APPROVAL')
                      NOT NULL DEFAULT 'PENDING',
  current_step        TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '현재 대기 중인 결재 단계',
  leave_days          DECIMAL(4,1)    NULL
                      COMMENT '차감량. 연차=일수, 반차=0.5, 유대=1.0(1일 단위 — §3.1).
                               차감 대상 잔여는 type으로 결정(연차계열→leave_balance,
                               SUBSTITUTE_HOLIDAY→substitute_holiday_balance). 조정/취소는 NULL',
  is_retroactive      TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '사후 신청 라벨(D-3)',
  idempotency_key     CHAR(36)        NULL COMMENT '더블탭 중복 제출 방지(§3.7)',
  created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finalized_at        DATETIME        NULL COMMENT '종결(승인/반려/취소) 시각',
  PRIMARY KEY (id),
  UNIQUE KEY uq_req_idem (idempotency_key),
  KEY idx_req_inbox (facility_id, status, created_at) COMMENT '결재함: 대기 오래된 순',
  KEY idx_req_mine  (requester_id, created_at),
  CONSTRAINT fk_req_facility  FOREIGN KEY (facility_id)      REFERENCES facility(id),
  CONSTRAINT fk_req_requester FOREIGN KEY (requester_id)     REFERENCES employee(id),
  CONSTRAINT fk_req_shift     FOREIGN KEY (desired_shift_id) REFERENCES shift_type(id),
  CONSTRAINT fk_req_ref       FOREIGN KEY (ref_request_id)   REFERENCES approval_request(id)
) ENGINE=InnoDB COMMENT='결재 신청 헤더';

-- 신청 대상일 (v3 target_dates[] 의 정규화 — MySQL 배열 미지원 대응)
CREATE TABLE approval_request_date (
  request_id          BIGINT UNSIGNED NOT NULL,
  target_date         DATE            NOT NULL,
  PRIMARY KEY (request_id, target_date),
  KEY idx_reqdate_date (target_date) COMMENT '같은 날 신청 배지(US-04)·중복신청 검사용',
  CONSTRAINT fk_reqdate_req FOREIGN KEY (request_id)
    REFERENCES approval_request(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='신청 대상 일자 (연차 다중일 지원. 반차·유대·조정은 1행)';

-- 결재 이력 (append-only, 감사 추적)
CREATE TABLE approval_history (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id          BIGINT UNSIGNED NOT NULL,
  actor_id            BIGINT UNSIGNED NOT NULL,
  action              ENUM('SUBMIT','APPROVE','REJECT','CANCEL') NOT NULL,
  step_no             TINYINT UNSIGNED NULL COMMENT '결재 행위의 단계(제출/취소는 NULL)',
  comment             VARCHAR(500)    NULL COMMENT 'REJECT 시 반려사유 — 애플리케이션에서 필수 검증',
  signature_snapshot_path VARCHAR(255) NULL
                      COMMENT '[v1.1] APPROVE 시점 서명 이미지 사본의 스토리지 경로(key).
                               원본(employee.signature_path)이 아닌 승인 시점 복제본을 참조 —
                               이후 서명 변경이 과거 문서에 소급되지 않음 (D-12).
                               출력용 서식(US-07)의 결재란은 이 값을 사용',
  acted_at            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_hist_req (request_id, acted_at),
  CONSTRAINT fk_hist_req   FOREIGN KEY (request_id) REFERENCES approval_request(id),
  CONSTRAINT fk_hist_actor FOREIGN KEY (actor_id)   REFERENCES employee(id)
) ENGINE=InnoDB COMMENT='결재 이력 — 불변(append-only). 아래 트리거로 수정·삭제 차단';

-- append-only 강제 트리거 (운영 계정에서 UPDATE/DELETE 권한 미부여를 기본으로 하되 이중 방어)
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

-- 연차 잔여 (이중신청 방지용 reserved 포함 — 정책 D-2)
CREATE TABLE leave_balance (
  employee_id         BIGINT UNSIGNED NOT NULL,
  balance_year        YEAR            NOT NULL,
  granted             DECIMAL(4,1)    NOT NULL DEFAULT 0
                      COMMENT '부여. [v1.1] 산정 규칙 확정(D-9 개정): 1년 미만 월 개근 시 익월 1일 /
                               1년차 15일 / 이후 2년마다 +1. Phase 1은 규칙에 따른 값을
                               관리자가 수동 입력, 자동 산정은 Phase 5',
  used                DECIMAL(4,1)    NOT NULL DEFAULT 0 COMMENT '사용 확정(최종 APPROVED 시 가산)',
  reserved            DECIMAL(4,1)    NOT NULL DEFAULT 0 COMMENT '대기중 예약(제출 시 가산, 종결 시 해제)',
  remaining           DECIMAL(5,1)    GENERATED ALWAYS AS (granted - used - reserved) STORED,
  updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                       ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (employee_id, balance_year),
  CONSTRAINT fk_bal_emp FOREIGN KEY (employee_id) REFERENCES employee(id)
) ENGINE=InnoDB COMMENT='연차 잔여. 음수 허용(엣지케이스 3) — 승인 시 경고는 앱 레벨';

-- [v1.1 신설] 유급휴일대체(유대) 잔여 — 구조는 leave_balance 와 동일 (기획서 §3.5)
CREATE TABLE substitute_holiday_balance (
  employee_id         BIGINT UNSIGNED NOT NULL,
  balance_year        YEAR            NOT NULL
                      COMMENT '발생 연도. 당해 연도 말 소멸, 이월 없음(D-11) —
                               만료 판정은 앱/배치 레벨(연도 경과분 사용 차단)',
  granted             DECIMAL(4,1)    NOT NULL DEFAULT 0
                      COMMENT '부여 합계(1일 단위). Phase 1은 관리자 수동 부여(D-10),
                               Phase 3부터 출퇴근 데이터 기반 후보 제시 후 확정',
  used                DECIMAL(4,1)    NOT NULL DEFAULT 0,
  reserved            DECIMAL(4,1)    NOT NULL DEFAULT 0,
  remaining           DECIMAL(5,1)    GENERATED ALWAYS AS (granted - used - reserved) STORED,
  updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                       ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (employee_id, balance_year),
  CONSTRAINT fk_shbal_emp FOREIGN KEY (employee_id) REFERENCES employee(id)
) ENGINE=InnoDB COMMENT='유급휴일대체 잔여. 12월 초 잔여 보유자 소멸 예정 알림은 배치(엣지 8)';

-- [v1.1 신설] 유대 부여/취소 원장 (부여·정정의 감사 추적 — 엣지 9)
CREATE TABLE substitute_holiday_grant (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id         BIGINT UNSIGNED NOT NULL,
  worked_holiday      DATE            NOT NULL COMMENT '근무한 법정공휴일',
  days                DECIMAL(3,1)    NOT NULL DEFAULT 1.0 COMMENT '부여량(1일 단위)',
  granted_by          BIGINT UNSIGNED NOT NULL COMMENT '부여 관리자',
  granted_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_by          BIGINT UNSIGNED NULL COMMENT '부여 취소 관리자(공휴일 근무 기록 정정 시)',
  revoked_at          DATETIME        NULL,
  revoke_reason       VARCHAR(300)    NULL,
  source              ENUM('MANUAL','ATTENDANCE') NOT NULL DEFAULT 'MANUAL'
                      COMMENT 'ATTENDANCE = Phase 3 출퇴근 감지 기반 후보 확정분',
  PRIMARY KEY (id),
  KEY idx_shgrant_emp (employee_id, worked_holiday),
  CONSTRAINT fk_shgrant_emp     FOREIGN KEY (employee_id) REFERENCES employee(id),
  CONSTRAINT fk_shgrant_granter FOREIGN KEY (granted_by)  REFERENCES employee(id),
  CONSTRAINT fk_shgrant_revoker FOREIGN KEY (revoked_by)  REFERENCES employee(id)
) ENGINE=InnoDB COMMENT='유대 부여 원장. balance.granted 는 본 원장의 유효분 합계와 일치해야 함(앱 레벨 정합성)';

-- 알림 (인앱 확정, 채널 확장 대비 — 정책 D-7)
CREATE TABLE notification (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  recipient_id        BIGINT UNSIGNED NOT NULL,
  request_id          BIGINT UNSIGNED NULL,
  kind                ENUM('NEW_REQUEST','APPROVED','REJECTED','REMINDER',
                           'EXPIRY_WARNING') NOT NULL
                      COMMENT '[v1.1] EXPIRY_WARNING: 유대 당해 연도 소멸 예정(엣지 8, request_id NULL)',
  channel             ENUM('IN_APP','PUSH','ALIMTALK') NOT NULL DEFAULT 'IN_APP',
  body                VARCHAR(300)    NOT NULL,
  read_at             DATETIME        NULL,
  created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_noti_recipient (recipient_id, read_at, created_at),
  CONSTRAINT fk_noti_recipient FOREIGN KEY (recipient_id) REFERENCES employee(id),
  CONSTRAINT fk_noti_request   FOREIGN KEY (request_id)   REFERENCES approval_request(id)
) ENGINE=InnoDB COMMENT='알림. 24시간 미처리 REMINDER는 배치로 생성(D-8)';

-- =============================================================
-- [Phase 2~4] 근무표 · 고시 파라미터 · 출퇴근 · 마감 (선행 정의)
--  * Phase 1 개발에는 불필요하나, FK 관계 확정을 위해 함께 배포 가능
-- =============================================================

-- 고시 파라미터 (연도/개정 버전 관리 — 수치 하드코딩 금지 원칙)
CREATE TABLE regulation_param_set (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  effective_from        DATE            NOT NULL,
  effective_to          DATE            NULL,
  hours_per_day         TINYINT UNSIGNED NOT NULL DEFAULT 8
                        COMMENT '[v1.1] §4.1 산식의 일 근무시간.
                                 월 기준근무시간 = (월 일수 − 토·일 − public_holiday) × 본 값',
  monthly_base_hours    DECIMAL(6,2)    NULL
                        COMMENT '[v1.1] 수동 override. NULL이면 §4.1 산식으로 월별 자동 계산',
  ratio_caregiver       DECIMAL(3,1)    NOT NULL DEFAULT 2.1 COMMENT '요양보호사 n명당 1',
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
                        COMMENT '[v1.1] §4.4 유대 공단 인정 상한(당월 기준시간 초과분만, 최대 8h)',
  rounding_rules        JSON            NULL COMMENT '계산식별 반올림/절사 규칙(§4.2 가산=버림, 감액=둘째자리 버림 후 첫째자리 4이하 버림 등)',
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

-- 월 근무표
CREATE TABLE roster (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  facility_id         BIGINT UNSIGNED NOT NULL,
  `year_month`        CHAR(7)         NOT NULL COMMENT 'YYYY-MM',
  status              ENUM('DRAFT','CONFIRMED','CLOSED') NOT NULL DEFAULT 'DRAFT',
  closed_at           DATETIME        NULL,
  closed_by           BIGINT UNSIGNED NULL,
  created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_roster_month (facility_id, `year_month`),
  CONSTRAINT fk_roster_facility FOREIGN KEY (facility_id) REFERENCES facility(id),
  CONSTRAINT fk_roster_closer   FOREIGN KEY (closed_by)   REFERENCES employee(id)
) ENGINE=InnoDB COMMENT='월 근무표 헤더. CLOSED 후 수정은 결재 경유';

-- 근무표 셀 (직원 × 일자)
CREATE TABLE schedule_entry (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  roster_id           BIGINT UNSIGNED NOT NULL,
  employee_id         BIGINT UNSIGNED NOT NULL,
  work_date           DATE            NOT NULL,
  shift_type_id       BIGINT UNSIGNED NOT NULL,
  source              ENUM('MANUAL','PRESET','APPROVAL') NOT NULL DEFAULT 'MANUAL'
                      COMMENT 'APPROVAL = request.approved 이벤트로 자동 반영된 셀(연차·유대·조정)',
  source_request_id   BIGINT UNSIGNED NULL COMMENT '반영 근거 결재 건',
  PRIMARY KEY (id),
  UNIQUE KEY uq_entry (employee_id, work_date),
  KEY idx_entry_roster_date (roster_id, work_date),
  CONSTRAINT fk_entry_roster  FOREIGN KEY (roster_id)     REFERENCES roster(id),
  CONSTRAINT fk_entry_emp     FOREIGN KEY (employee_id)   REFERENCES employee(id),
  CONSTRAINT fk_entry_shift   FOREIGN KEY (shift_type_id) REFERENCES shift_type(id),
  CONSTRAINT fk_entry_request FOREIGN KEY (source_request_id) REFERENCES approval_request(id)
) ENGINE=InnoDB COMMENT='근무표 셀. 승인 연차가 있는 셀은 프리셋이 덮어쓰지 않음(앱 레벨)';

-- [v1.1 신설] 근무 패턴 프리셋 (§4.6 — 주야비 3조 2교대 등)
CREATE TABLE shift_pattern_preset (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  facility_id         BIGINT UNSIGNED NOT NULL,
  name                VARCHAR(50)     NOT NULL COMMENT '예: 주야비 3조 2교대',
  cycle_days          TINYINT UNSIGNED NOT NULL COMMENT '패턴 주기(주야비=6)',
  team_count          TINYINT UNSIGNED NOT NULL COMMENT '조 수(주야비=3: A/B/C)',
  PRIMARY KEY (id),
  CONSTRAINT fk_preset_facility FOREIGN KEY (facility_id) REFERENCES facility(id)
) ENGINE=InnoDB COMMENT='근무 패턴 프리셋 헤더';

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

-- 출퇴근 기록
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
                      COMMENT 'MANUAL=수동태그(결재 승인 경유), ADMIN=관리자 보정',
  manual_request_id   BIGINT UNSIGNED NULL COMMENT 'MANUAL/ADMIN 근거 결재 건(Phase 3)',
  actual_minutes      SMALLINT UNSIGNED NULL COMMENT '휴게 차감 후 실근무분(자정 넘김 처리 포함)',
  is_holiday_work     TINYINT(1)      NOT NULL DEFAULT 0
                      COMMENT '[v1.1] 법정공휴일 근무 여부(public_holiday 대조, 배치 마킹) —
                               유대 부여 후보 제시의 근거(D-10, Phase 3)',
  status              ENUM('NORMAL','MISSING_OUT','MANUAL_PENDING') NOT NULL DEFAULT 'NORMAL',
  created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_att (employee_id, work_date),
  KEY idx_att_date (work_date, status),
  CONSTRAINT fk_att_emp FOREIGN KEY (employee_id) REFERENCES employee(id),
  CONSTRAINT fk_att_req FOREIGN KEY (manual_request_id) REFERENCES approval_request(id)
) ENGINE=InnoDB COMMENT='출퇴근. 위치는 태그 시점 좌표만 저장(상시 추적 금지).
  성능 요건: GPS 태그 처리 3초 이내(§5.1 — 앱/인프라 레벨)';

-- 검증 결과 스냅샷 (확정 시점 보존 — 사후 감사 대응)
CREATE TABLE validation_result (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  roster_id           BIGINT UNSIGNED NOT NULL,
  checked_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rule_code           VARCHAR(40)     NOT NULL COMMENT '예: MONTHLY_STAFFING_CAREGIVER, NIGHT_ADDON_COND2, BASE_HOURS_SHORTFALL',
  severity            ENUM('WARN','BLOCK') NOT NULL,
  detail              JSON            NULL COMMENT '환산인원, 필요인원, 미충족 조건 등',
  PRIMARY KEY (id),
  KEY idx_val_roster (roster_id, checked_at),
  CONSTRAINT fk_val_roster FOREIGN KEY (roster_id) REFERENCES roster(id)
) ENGINE=InnoDB COMMENT='고시 검증 스냅샷';

-- =============================================================
-- 초기 데이터 (예시: 근무유형 기본 세트)
-- =============================================================
INSERT INTO facility (name, capacity) VALUES ('샘플요양원', 60);  -- id=1 가정(신규 DB)
INSERT INTO shift_type (facility_id, code, label, start_time, end_time,
                        break_minutes, crosses_midnight, counts_as_work,
                        recognized_hours, sort_order) VALUES
  (1, 'D',   '주간',     '09:00', '18:00', 60, 0, 1, NULL, 1),
  (1, 'N',   '야간',     '22:00', '07:00', 60, 1, 1, NULL, 2),
  (1, 'OFF', '휴무',     NULL,    NULL,     0, 0, 0, NULL, 3),
  (1, 'AL',  '연차',     NULL,    NULL,     0, 0, 0, 8.00, 4),
  (1, 'HAM', '오전반차',  NULL,    NULL,     0, 0, 0, 4.00, 5),
  (1, 'HPM', '오후반차',  NULL,    NULL,     0, 0, 0, 4.00, 6),
  (1, 'SUB', '휴일대체',  NULL,    NULL,     0, 0, 0, 8.00, 7);  -- [v1.1] 유급휴일대체.
  -- 공단 인정시간은 §4.4 규칙(당월 기준시간 초과분·최대 8h)으로 앱에서 별도 산정

-- =============================================================
-- 권한 가이드 (참고)
--  * 애플리케이션 계정: approval_history에 INSERT/SELECT만 부여
--    GRANT SELECT, INSERT ON carehome_tms.approval_history TO 'app'@'%';
--  * substitute_holiday_grant 는 revoke 칼럼 갱신이 필요하므로
--    UPDATE는 revoked_* / revoke_reason 칼럼 한정 운영 권장(감사 필드 보호)
--  * DB 접속 정보는 코드/환경변수에 하드코딩하지 말고
--    사내 시크릿 관리 솔루션을 통해 주입할 것
-- =============================================================
