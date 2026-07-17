-- =============================================================
-- 요양원 근태관리 프로그램 — v1.1 → v1.2 스키마 반영
-- 원본: docs/ddl/carehome_tms_ddl_v1.2.sql (기획서 v3.2 반영)
-- 선행 마이그레이션: 20260709000000_init (DDL v1.1 baseline)
--
-- 이 마이그레이션은 손으로 작성되었다 (`prisma migrate dev`로 생성되지 않음) — schema.prisma
-- 상단 주석 참고. CHECK 제약·생성 컬럼·트리거는 Prisma 스키마 언어로 표현할 수 없어
-- 이 파일이 유일한 근거이며, 이 테이블들에 대해 자동 diff를 신뢰해서는 안 된다.
--
-- v1.2 변경 요약 (E-01~E-11, docs/ddl/carehome_tms_ddl_v1.2.sql 헤더 참고):
--   E-01 결재선 1~3단계 확장 + 전결 지원 / E-02 팀 도입 / E-03 유대 이중 트랙
--   E-04 notification 세분화 / E-05 근무표 상태머신 4단계 / E-06 recognized_hours→recognized_minutes
--   E-07 일별 적정 인원 / E-08 facility 설정 항목 / E-09 annual_leave_cap_days
--   E-10 schedule_entry.is_provisional / E-11 leave_balance 주석 개정(스키마 변경 없음)
-- =============================================================

-- =============================================================
-- E-08. facility: 결재 단계 상한 확장 + 신규 설정 항목
-- =============================================================
ALTER TABLE facility DROP CHECK chk_facility_steps;

ALTER TABLE facility
  MODIFY COLUMN approval_steps TINYINT UNSIGNED NOT NULL DEFAULT 3
    COMMENT '[v1.2] 결재 단계 수 1~3. 표준 3단계 = 사회복지사→사무국장→시설장 (D-13)',
  ADD COLUMN tag_margin_minutes SMALLINT UNSIGNED NULL DEFAULT 30
    COMMENT '[v1.2] 출퇴근 태그 허용 시간 여유(교대 전후 n분, A-6 — Phase 3)' AFTER gps_radius_m,
  ADD COLUMN admin_call_phone VARCHAR(20) NULL
    COMMENT '[v1.2] 태그 실패 시 관리자 호출 전화번호(C-11 — Phase 3). 실번호는 운영 설정에서 입력, 문서·시드에 미기재'
    AFTER tag_margin_minutes;

ALTER TABLE facility
  ADD CONSTRAINT chk_facility_steps CHECK (approval_steps BETWEEN 1 AND 3);

-- =============================================================
-- E-02. team 신설 + employee.team_id
-- =============================================================
CREATE TABLE team (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  facility_id         BIGINT UNSIGNED NOT NULL,
  name                VARCHAR(50)     NOT NULL COMMENT '예: 1층팀, 2층팀',
  sort_order          SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_team_name (facility_id, name),
  CONSTRAINT fk_team_facility FOREIGN KEY (facility_id) REFERENCES facility(id)
) ENGINE=InnoDB COMMENT='팀. 종사자는 본인 팀 근무표만 조회(개인정보 보호 — 앱 레벨)';

ALTER TABLE employee
  ADD COLUMN team_id BIGINT UNSIGNED NULL
    COMMENT '[v1.2] 소속 팀(직원 등록 시 지정, 변경 가능)' AFTER facility_id;

ALTER TABLE employee
  ADD KEY idx_emp_team (team_id),
  ADD CONSTRAINT fk_emp_team FOREIGN KEY (team_id) REFERENCES team(id);

-- =============================================================
-- E-06. shift_type: recognized_hours(DECIMAL) → recognized_minutes(분) + cell_label
-- =============================================================
ALTER TABLE shift_type
  CHANGE COLUMN recognized_hours recognized_minutes SMALLINT UNSIGNED NULL
    COMMENT '[v1.2] §4.1/§4.7 기준근무시간 인정분(분). 주간=480, 야간(주야비)=580(9h40m), 연차=480, 반차=240,
             유급병가=480, 휴무·결근=0(불인정 — NULL 아닌 0). 유급휴일대체는 §4.4 규칙으로 ledger에서 별도 산정
             — 본 칼럼 값은 근로자 관점 표기용';

ALTER TABLE shift_type
  ADD COLUMN cell_label VARCHAR(10) NULL
    COMMENT '[v1.2] 근무표 셀 표기(§4.7): 주/야/휴/연/오전/오후/유/병/결' AFTER recognized_minutes;

-- =============================================================
-- E-01. approval_line: 1~3단계 + 역할 지정 + 전결 위임
-- =============================================================
ALTER TABLE approval_line DROP CHECK chk_line_step;

ALTER TABLE approval_line
  ADD COLUMN approver_role ENUM('SOCIAL_WORKER','OFFICE_MANAGER','DIRECTOR') NULL
    COMMENT '[v1.2] 역할 지정 방식. approver_id 와 택일(둘 중 하나는 NOT NULL — 앱 레벨)' AFTER step_no,
  MODIFY COLUMN approver_id BIGINT UNSIGNED NULL COMMENT '개인 지정 방식의 결재자',
  ADD COLUMN delegation_enabled TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '[v1.2] 전결 위임(D-13). 대상은 step_no=2(사무국장)에 한함 — ON이면 2단계 승인이 곧 최종 확정(APPROVED)'
    AFTER deputy_id;

ALTER TABLE approval_line
  ADD CONSTRAINT chk_line_step CHECK (step_no BETWEEN 1 AND 3),
  ADD CONSTRAINT chk_line_delegation CHECK (delegation_enabled = 0 OR step_no = 2);

-- =============================================================
-- E-01. approval_request: 전결 확정 표시 + current_step 시작값 0
-- =============================================================
ALTER TABLE approval_request
  MODIFY COLUMN current_step TINYINT UNSIGNED NOT NULL DEFAULT 0
    COMMENT '[v1.2] 완료된 결재 단계 수(§3.4). PENDING=0, INTERIM_APPROVED에서 1 또는 2',
  ADD COLUMN is_final_by_delegation TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '[v1.2] 전결로 최종 확정된 건(감사 식별 — D-13, 출력 서식에 "전결" 표기)' AFTER current_step;

-- =============================================================
-- E-01. approval_request_line 신설 (제출 시점 결재선 스냅샷 — 엣지 12)
-- =============================================================
CREATE TABLE approval_request_line (
  request_id          BIGINT UNSIGNED NOT NULL,
  step_no             TINYINT UNSIGNED NOT NULL COMMENT '1~3',
  approver_id         BIGINT UNSIGNED NOT NULL COMMENT '제출 시점에 확정된 해당 단계 결재자
                                                         (역할 지정이면 당시 재직자로 해석·고정)',
  deputy_id           BIGINT UNSIGNED NULL,
  delegation_enabled  TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '제출 시점 전결 설정(step 2)',
  PRIMARY KEY (request_id, step_no),
  CONSTRAINT fk_reqline_req      FOREIGN KEY (request_id)  REFERENCES approval_request(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_reqline_approver FOREIGN KEY (approver_id) REFERENCES employee(id),
  CONSTRAINT fk_reqline_deputy   FOREIGN KEY (deputy_id)   REFERENCES employee(id),
  CONSTRAINT chk_reqline_step CHECK (step_no BETWEEN 1 AND 3)
) ENGINE=InnoDB COMMENT='신청별 결재선 스냅샷. 자기결재 회피(D-6)로 재배정된 결과를 반영해 저장';

-- =============================================================
-- E-01. approval_history: 전결 확정 표시
-- =============================================================
ALTER TABLE approval_history
  ADD COLUMN is_delegated_final TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '[v1.2] 이 APPROVE가 전결에 의한 최종 확정임(출력 서식 "전결" 표기 근거)' AFTER step_no;

-- =============================================================
-- E-03. 유대 이중 트랙: substitute_holiday_grant 폐지 → substitute_holiday_ledger 신설
-- =============================================================
DROP TABLE substitute_holiday_grant;

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

-- =============================================================
-- E-04. notification: kind 세분화 + ledger_id 참조
-- =============================================================
ALTER TABLE notification
  ADD COLUMN ledger_id BIGINT UNSIGNED NULL
    COMMENT '[v1.2] SIGN_REQUEST 등 유대 대장 관련 알림의 참조' AFTER request_id;

ALTER TABLE notification
  MODIFY COLUMN kind ENUM('NEW_REQUEST','STEP_APPROVED','APPROVED','REJECTED','REMINDER',
                          'SIGN_REQUEST','LEAVE_EXPIRY_60D','LEAVE_EXPIRY_30D','SH_EXPIRY')
    NOT NULL
    COMMENT '[v1.2] STEP_APPROVED=중간승인 통지(다음 결재자·취소 통지 겸용), SIGN_REQUEST=유대 확인 서명 요청(US-09),
             LEAVE_EXPIRY_60D/30D=연차 소멸 임박 관리자 알림(C-10), SH_EXPIRY=유대 당해 연도 소멸 예정(엣지 8)';

ALTER TABLE notification
  ADD CONSTRAINT fk_noti_ledger FOREIGN KEY (ledger_id) REFERENCES substitute_holiday_ledger(id);

-- =============================================================
-- E-09. regulation_param_set: 연차 총 상한
-- =============================================================
ALTER TABLE regulation_param_set
  ADD COLUMN annual_leave_cap_days TINYINT UNSIGNED NOT NULL DEFAULT 25
    COMMENT '[v1.2] D-9 연차 가산 포함 총 상한 — [V-3 근로기준법 제60조 제4항 원문 대조 후 확정 표기]'
    AFTER sub_holiday_max_hours;

-- =============================================================
-- E-07. daily_staffing_rule 신설 (§4.5 — 팀×주/야 최소·최대)
-- =============================================================
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

-- =============================================================
-- E-05. roster: 상태머신 4단계 + 마감 상신/강행 마감 감사 필드
-- 주의: 기존 status='CONFIRMED' 데이터가 있으면 신규 ENUM에 값이 없어 실패한다.
-- 로컬/스테이징에 CONFIRMED 데이터가 있다면 이 ALTER 전에 COMPLETED 등으로 수동 전환할 것.
-- =============================================================
ALTER TABLE roster
  MODIFY COLUMN status ENUM('DRAFT','COMPLETED','CLOSING_APPROVAL','CLOSED')
    NOT NULL DEFAULT 'DRAFT'
    COMMENT '[v1.2] 작성중→작성완료→마감결재→마감(§4.8). COMPLETED에서 셀 수정 시 DRAFT 복귀,
             반려 시 DRAFT 복귀 — 전이·로그는 앱 레벨',
  ADD COLUMN submitted_by BIGINT UNSIGNED NULL
    COMMENT '[v1.2] 마감 상신자(사회복지사)' AFTER status,
  ADD COLUMN submitted_at DATETIME NULL AFTER submitted_by,
  ADD COLUMN force_closed TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '[v1.2] 위반 존재 상태의 강행 마감 여부(D-19)' AFTER closed_at,
  ADD COLUMN force_close_reason VARCHAR(500) NULL
    COMMENT '[v1.2] 강행 마감 사유 — force_closed=1 시 필수(앱 레벨). 당시 위반 목록은 validation_result 스냅샷으로 보존'
    AFTER force_closed;

ALTER TABLE roster
  ADD CONSTRAINT fk_roster_submitter FOREIGN KEY (submitted_by) REFERENCES employee(id);

-- =============================================================
-- E-10. schedule_entry: 가반영(step_approved) 표시
-- =============================================================
ALTER TABLE schedule_entry
  ADD COLUMN is_provisional TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '[v1.2] 가반영 표시(§4.10): step_approved 구독 시 1(글자만), approved 구독 시 0으로 확정(셀 색칠)'
    AFTER source;

-- =============================================================
-- validation_result: 스냅샷 시점 구분(COMPLETED/CLOSE) — §4.8 상태머신에 맞춘 확장
-- =============================================================
ALTER TABLE validation_result
  ADD COLUMN snapshot_stage ENUM('EDIT','COMPLETED','CLOSE') NOT NULL DEFAULT 'EDIT'
    COMMENT '[v1.2] COMPLETED=작성완료 시 스냅샷(§4.8), CLOSE=마감(강행 포함) 시 위반 목록'
    AFTER checked_at;

ALTER TABLE validation_result DROP INDEX idx_val_roster;
ALTER TABLE validation_result ADD KEY idx_val_roster (roster_id, snapshot_stage, checked_at);
