-- =============================================================
-- approval_request_line: 결재 취소(CANCEL) 건 1단계 다중 결재자 후보 허용
-- 원본: docs/ddl/carehome_tms_ddl_v1.2.sql [v1.2.1] 주석 참고
--
-- 배경: CANCEL 유형 취소 요청은 시설 결재선(1~3단계)의 결재자 전원을 stepNo=1의
-- 후보로 스냅샷하고, 그 중 누구든 먼저 결재하면 즉시 종결되도록 한다. 기존 PK
-- (request_id, step_no)는 stepNo당 결재자 1명만 허용해 이를 표현할 수 없었다.
-- approver_id를 PK에 포함해 같은 stepNo에 여러 결재자 후보 행을 저장할 수 있게 한다.
-- =============================================================
ALTER TABLE approval_request_line
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (request_id, step_no, approver_id);
