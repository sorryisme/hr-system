import { createFileRoute } from '@tanstack/react-router'
import { DeviceAuthPage } from '@/features/device-auth/device-auth-page'
import { redirectIfAuthenticated } from '@/features/auth/session'

export const Route = createFileRoute('/login')({
  beforeLoad: redirectIfAuthenticated,
  component: DeviceAuthPage,
})
