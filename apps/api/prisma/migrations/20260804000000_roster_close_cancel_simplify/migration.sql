-- =============================================================
-- 근무표 상태머신 단순화: DRAFT→COMPLETED→CLOSING_APPROVAL→CLOSED(4단계)
-- → DRAFT→CLOSED(2단계, 마감/마감취소). 마감·마감취소는 시설장·사무국장만
-- (job_role 앱 레벨 검사, RBAC 테이블 미도입 상태는 기존과 동일).
-- 기존 COMPLETED·CLOSING_APPROVAL 데이터는 DRAFT(편집 가능)로 되돌린다.
-- =============================================================
UPDATE roster SET status = 'DRAFT' WHERE status IN ('COMPLETED', 'CLOSING_APPROVAL');

ALTER TABLE roster
  DROP FOREIGN KEY fk_roster_submitter,
  DROP COLUMN submitted_by,
  DROP COLUMN submitted_at,
  MODIFY COLUMN status ENUM('DRAFT','CLOSED')
    NOT NULL DEFAULT 'DRAFT'
    COMMENT '[v1.4] 작성중(DRAFT) ↔ 마감(CLOSED). 마감/마감취소는 시설장·사무국장만(앱 레벨 job_role 검사)';

-- validation_result: 작성완료 단계가 사라져 COMPLETED 스냅샷은 더 이상 유효한 의미가 없다.
-- CLOSE로 흡수하면 실제로 마감되지 않은(위에서 DRAFT로 되돌린) 근무표에도 "마감 시점 위반 목록"이
-- 남게 되고, 실제 CLOSED로 남는 근무표는 진짜 CLOSE 스냅샷과 중복돼 stage당 최신 1건 가정이 깨진다.
-- 따라서 relabel하지 않고 삭제한다(당시 위반 목록은 사후 감사 근거로서의 의미를 잃었음).
DELETE FROM validation_result WHERE snapshot_stage = 'COMPLETED';

ALTER TABLE validation_result
  MODIFY COLUMN snapshot_stage ENUM('EDIT','CLOSE')
    NOT NULL DEFAULT 'EDIT'
    COMMENT '[v1.4] CLOSE=마감(강행 포함) 시 위반 목록 스냅샷';
