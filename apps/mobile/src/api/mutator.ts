// Orval 생성 훅이 사용하는 커스텀 fetch. 생성물(src/api/generated)은 수정 금지 —
// 베이스 URL·에러 처리 등 수작업 코드는 전부 이 파일에 둔다. apps/web의 동일 파일과 동일 패턴.

const BASE_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'

/** API 4xx/5xx 응답. body의 code(INVALID_CODE | DEVICE_ALREADY_REGISTERED 등)로 UI 메시지를 매핑한다 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string | undefined

  constructor(status: number, code: string | undefined, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

interface ErrorBody {
  code?: string
  message?: string | string[]
}

/**
 * Orval의 httpClient: 'fetch' 생성 코드는 각 엔드포인트 함수가
 * `Promise<{ data: TBody; status: number } & { headers: Headers }>` 형태를 반환한다고 가정한다.
 * 파싱한 바디를 그대로 반환하면 이 래핑이 빠져 `result.data`가 항상 undefined가 된다.
 */
export async function customFetch<T>(url: string, options: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${url}`, {
    ...options,
    // 인증은 httpOnly 쿠키(cs_access_token) — 토큰을 JS에서 다루지 않는다(CLAUDE.md Frontend)
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  const text = await response.text()
  const body: unknown = text ? JSON.parse(text) : undefined

  if (!response.ok) {
    // 세션 만료(기기 해제·쿠키 소멸): 로그인(기기 등록) 화면으로 전체 리로드해 앱 상태를 초기화한다.
    // /auth/*, /devices/*는 제외 — 로그인 확인(auth/me)과 등록 실패(devices/register)는 화면에서 직접 처리
    if (
      response.status === 401 &&
      !url.startsWith('/api/auth/') &&
      !url.startsWith('/api/devices/') &&
      !window.location.pathname.startsWith('/login')
    ) {
      window.location.assign('/login')
    }
    const err = (body ?? {}) as ErrorBody
    const message = Array.isArray(err.message)
      ? err.message.join(', ')
      : (err.message ?? `요청 실패 (${response.status})`)
    throw new ApiError(response.status, err.code, message)
  }

  return { data: body, status: response.status, headers: response.headers } as T
}
