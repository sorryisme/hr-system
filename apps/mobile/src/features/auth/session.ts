// 세션 사용자 캐시 + 라우트 가드. 토큰은 httpOnly 쿠키에만 있어 프론트는 만료를 알 수 없으므로
// 최초 진입 시 GET /auth/me로 확인하고, 이후에는 모듈 캐시를 재사용한다(apps/web과 동일 패턴).
// API 401 응답(mutator) 또는 기기 등록 완료 시 캐시가 갱신된다.
import { redirect } from '@tanstack/react-router'
import { me } from '@/api/generated/endpoints'
import type { SessionUserDto } from '@/api/generated/model'
import { ApiError } from '@/api/mutator'

let cachedUser: SessionUserDto | null = null

export function setSessionUser(user: SessionUserDto | null): void {
  cachedUser = user
}

/** 보호 라우트 beforeLoad 통과 후에는 항상 non-null */
export function getSessionUser(): SessionUserDto | null {
  return cachedUser
}

export async function fetchSessionUser(): Promise<SessionUserDto | null> {
  if (cachedUser) {
    return cachedUser
  }
  try {
    const response = await me()
    cachedUser = response.data
    return cachedUser
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      return null
    }
    throw error
  }
}

/** 보호 라우트 공통 beforeLoad — 미등록 기기·만료된 세션은 /login(기기 등록)으로 보낸다 */
export async function requireAuth(): Promise<SessionUserDto> {
  const user = await fetchSessionUser()
  if (!user) {
    throw redirect({ to: '/login' })
  }
  return user
}

/** /login 전용 beforeLoad — 이미 기기 등록·로그인돼 있으면 홈으로 보낸다 */
export async function redirectIfAuthenticated(): Promise<void> {
  const user = await fetchSessionUser()
  if (user) {
    throw redirect({ to: '/' })
  }
}
