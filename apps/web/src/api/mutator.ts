// Orval 생성 훅이 사용하는 커스텀 fetch. 생성물(src/api/generated)은 수정 금지 —
// 베이스 URL·에러 처리 등 수작업 코드는 전부 이 파일에 둔다.

const BASE_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'

/** API 4xx/5xx 응답. body의 code(REASON_REQUIRED | ALREADY_FINALIZED | NOT_YOUR_STEP | SELF_APPROVAL_FORBIDDEN 등)로 UI 메시지를 매핑한다 */
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
 * `Promise<{ data: TBody; status: number } & { headers: Headers }>` 형태를 반환한다고 가정한다
 * (생성된 `*Response` 타입 참고). 파싱한 바디를 그대로 반환하면 이 래핑이 빠져
 * `result.data`가 항상 undefined가 된다 — 네트워크 탭에는 응답이 정상 표시되는데
 * 화면은 빈 상태로 보이는 증상의 원인이었다.
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
    // 세션 만료(쿠키 소멸·토큰 만료): 로그인 화면으로 전체 리로드해 앱 상태를 초기화한다.
    // /auth/* 는 제외 — 로그인 실패(401)와 /auth/me의 미로그인 확인은 화면에서 직접 처리한다.
    if (response.status === 401 && !url.startsWith('/api/auth/') && !window.location.pathname.startsWith('/login')) {
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
