-- =============================================================
-- DDL v1.2 → v1.3 반영 (근무표 승인 목업 검토 — docs/mock-ui/근무표)
-- 원본: docs/ddl/carehome_tms_ddl_v1.3.sql, 산출물: docs/logs/260724/
--
-- F-01. 셀 단위 근무시간 조정(§4.8 "모든 근무는 시간을 수정할 수 있다 →
--       근무종류(근무시작~종료)") 저장 위치 신설
--       - approval_request.desired_start_time / desired_end_time (SHIFT_CHANGE 희망 조정 시각)
--       - schedule_entry.override_start_time / override_end_time (셀 표기 원천)
-- F-02. schedule_entry.source_ledger_id 신설 — 유대(유) 셀 "유(이월인정시간,분)" 표기 원천을
--       substitute_holiday_ledger 로 직접 연결(FK). 편집기 전용 표기(§4.4).
--
-- 모두 NULL 허용 컬럼 추가 + FK 1건이라 기존 데이터 재작성 없음(비파괴).
-- =============================================================

-- F-01: 근무조정 신청의 희망 조정 시각
ALTER TABLE approval_request
  ADD COLUMN desired_start_time TIME NULL
    COMMENT '[v1.3] SHIFT_CHANGE 희망 출근 시각. NULL이면 desired_shift 기본 시각 사용' AFTER desired_shift_id,
  ADD COLUMN desired_end_time TIME NULL
    COMMENT '[v1.3] SHIFT_CHANGE 희망 퇴근 시각. NULL이면 desired_shift 기본 시각 사용' AFTER desired_start_time;

-- F-01: 근무표 셀 단위 시간 조정
ALTER TABLE schedule_entry
  ADD COLUMN override_start_time TIME NULL
    COMMENT '[v1.3] 셀 단위 조정 출근 시각. NULL이면 shift_type 기본 start_time 사용' AFTER is_provisional,
  ADD COLUMN override_end_time TIME NULL
    COMMENT '[v1.3] 셀 단위 조정 퇴근 시각(override_start_time과 함께 사용 — 앱 레벨)' AFTER override_start_time;

-- F-02: 유대 셀 표기 원천 연결
ALTER TABLE schedule_entry
  ADD COLUMN source_ledger_id BIGINT UNSIGNED NULL
    COMMENT '[v1.3] 유대(유) 셀 "유(이월인정시간,분)" 표기 원천(§4.4, 편집기 전용)' AFTER source_request_id,
  ADD CONSTRAINT fk_entry_ledger FOREIGN KEY (source_ledger_id)
    REFERENCES substitute_holiday_ledger (id);
