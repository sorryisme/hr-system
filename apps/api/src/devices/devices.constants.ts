/**
 * 기기 등록 기반 세션 수명(초). N-10(최초 1회 기기 등록 후 ID/PW 재입력 없이 자동 로그인)에
 * 따라 관리자 웹 세션(auth.constants.TOKEN_TTL_SECONDS, 12h)보다 훨씬 길게 잡는다.
 * 기기 분실 대응(엣지 7)은 이 만료를 기다리지 않고 UserDevice.revokedAt을 매 요청 검사해
 * 즉시 반영한다(JwtAuthGuard). 값(180일) 자체는 잠정치 — 운영 정책 확정 시 사람 검토 대상.
 */
export const DEVICE_SESSION_TTL_SECONDS = 180 * 24 * 60 * 60;
