import { generateUuid } from '@/lib/uuid'

const DEVICE_UID_KEY = 'care-mobile-device-uid'

/**
 * 이 기기를 가리키는 식별자(UUID)만 저장한다 — 로그인 여부 판단에는 쓰이지 않는다.
 * 로그인 여부는 인증 토큰(httpOnly 쿠키)의 존재로 결정되며, 프론트는 이를 직접 읽을 수
 * 없으므로 features/auth/session.ts가 GET /auth/me 결과로 판단한다(CLAUDE.md: 토큰
 * localStorage 저장 금지 — 이 값은 토큰이 아니라 기기 식별자다).
 */
export function getOrCreateDeviceUid(): string {
  const existing = localStorage.getItem(DEVICE_UID_KEY)
  if (existing) {
    return existing
  }
  const uid = generateUuid()
  localStorage.setItem(DEVICE_UID_KEY, uid)
  return uid
}
