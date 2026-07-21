import { useState } from 'react'
import { isCompleteCode, sanitizeCode } from './domain'
import { verifyDeviceCode } from './device-auth-service'
import { markDeviceRegistered } from './device-storage'
import type { AuthScreen } from './types'

interface State {
  screen: AuthScreen
  code: string
  error: string | null
}

const initialState: State = { screen: 'code-entry', code: '', error: null }

export function useDeviceAuth() {
  const [state, setState] = useState<State>(initialState)

  function changeCode(raw: string) {
    setState((s) => ({ ...s, code: sanitizeCode(raw), error: null }))
  }

  /** 코드 검증 + 기기 등록 저장. 실패 시 진동으로도 알린다(N-6) */
  function submit() {
    setState((s) => {
      if (!isCompleteCode(s.code)) {
        return { ...s, error: '숫자 6자리를 모두 입력해주세요.' }
      }
      const result = verifyDeviceCode(s.code)
      if (!result.ok) {
        if (navigator.vibrate) navigator.vibrate(200)
        return { ...s, error: result.message }
      }
      markDeviceRegistered()
      if (navigator.vibrate) navigator.vibrate([30, 40, 30])
      return { ...s, screen: 'welcome', error: null }
    })
  }

  return { state, actions: { changeCode, submit } }
}
