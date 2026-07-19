-- =============================================================
-- 관리자 웹 로그인 자격증명 — employee.email / password_hash 추가
--
-- 이 마이그레이션은 손으로 작성되었다 (`prisma migrate dev` 미사용 — schema.prisma 상단 주석 참고).
--
-- 배경: architecture-v3-final.md의 최종 인증은 Cognito Hosted UI + JWKS 검증이지만
-- AWS 미구성 로컬/파일럿 단계에서는 자체 발급 JWT(이메일+비밀번호)로 관리자 로그인을
-- 제공한다. Cognito 전환 시 email은 Cognito username 매핑 키로 재사용하고
-- password_hash는 폐기(NULL 유지) 예정이라 두 컬럼 모두 NULL 허용으로 둔다.
-- 종사자 모바일 인증(기기 등록 + PIN — C-13)은 별도이며 pin_hash를 사용한다.
-- =============================================================

ALTER TABLE employee
  ADD COLUMN email VARCHAR(255) NULL
    COMMENT '관리자 웹 로그인 ID. 종사자(모바일 PIN 인증)는 NULL 가능' AFTER name,
  ADD COLUMN password_hash VARCHAR(255) NULL
    COMMENT '비밀번호 해시(scrypt) — 평문 저장 금지. Cognito 전환 시 폐기 예정' AFTER email;

ALTER TABLE employee
  ADD CONSTRAINT uq_employee_email UNIQUE (email);
