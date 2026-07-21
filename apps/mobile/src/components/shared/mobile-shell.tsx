import { Outlet } from '@tanstack/react-router'
import { DeviceAuthGate } from '@/features/device-auth/device-auth-gate'

export function MobileShell() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-background">
      <DeviceAuthGate>
        <Outlet />
      </DeviceAuthGate>
    </div>
  )
}
