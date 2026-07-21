import { useState } from 'react'
import { useRegister } from '@/api/generated/endpoints'
import type { SessionUserDto } from '@/api/generated/model'
import { ApiError } from '@/api/mutator'
import { setSessionUser } from '@/features/auth/session'
import { isCompleteCode, sanitizeCode } from './domain'
import { getOrCreateDeviceUid } from './device-storage'
import type { AuthScreen } from './types'

interface State {
  screen: AuthScreen
  code: string
  error: string | null
  user: SessionUserDto | null
}

const initialState: State = { screen: 'code-entry', code: '', error: null, user: null }

/** 관리자 발급 코드로 기기를 등록하고 로그인한다(C-13/N-10) — POST /api/devices/register */
export function useDeviceAuth() {
  const [state, setState] = useState<State>(initialState)

  const registerDevice = useRegister({
    mutation: {
      onSuccess: (response) => {
        setSessionUser(response.data)
        if (navigator.vibrate) navigator.vibrate([30, 40, 30])
        setState((s) => ({ ...s, screen: 'welcome', error: null, user: response.data }))
      },
      onError: (error: unknown) => {
        if (navigator.vibrate) navigator.vibrate(200)
        // 서버가 한국어 메시지를 내려준다(INVALID_CODE / DEVICE_ALREADY_REGISTERED)
        const message =
          error instanceof ApiError && error.status < 500
            ? error.message
            : '등록 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.'
        setState((s) => ({ ...s, error: message }))
      },
    },
  })

  function changeCode(raw: string) {
    setState((s) => ({ ...s, code: sanitizeCode(raw), error: null }))
  }

  function submit() {
    if (!isCompleteCode(state.code)) {
      setState((s) => ({ ...s, error: '숫자 6자리를 모두 입력해주세요.' }))
      return
    }
    registerDevice.mutate({
      data: { code: state.code, deviceUid: getOrCreateDeviceUid() },
    })
  }

  return {
    state,
    isSubmitting: registerDevice.isPending,
    actions: { changeCode, submit },
  }
}
