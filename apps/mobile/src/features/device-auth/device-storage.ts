const STORAGE_KEY = 'care-mobile-device-registered'

/**
 * 기기 "등록 여부"만 담는 불리언 플래그다 — 세션/인증 토큰이 아니므로
 * CLAUDE.md의 "토큰 localStorage 저장 금지" 규정과 무관하다.
 * 실제 백엔드 연동 시 인증 토큰은 httpOnly 쿠키로 관리하고,
 * 이 플래그는 "코드 입력 화면을 건너뛸지" 판단용 UI 캐시로만 남긴다.
 */
export function isDeviceRegistered(): boolean {
  return localStorage.getItem(STORAGE_KEY) === '1'
}

export function markDeviceRegistered(): void {
  localStorage.setItem(STORAGE_KEY, '1')
}
