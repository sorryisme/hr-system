import { useState, type ReactNode } from 'react'
import { DeviceAuthPage } from './device-auth-page'
import { isDeviceRegistered } from './device-storage'

/** 최초 1회 기기 등록 전에는 앱 전체를 가로막고 등록 화면을 보여준다(N-10, C-13) */
export function DeviceAuthGate({ children }: { children: ReactNode }) {
  const [registered, setRegistered] = useState(isDeviceRegistered)

  if (!registered) {
    return <DeviceAuthPage onStart={() => setRegistered(true)} />
  }

  return <>{children}</>
}
