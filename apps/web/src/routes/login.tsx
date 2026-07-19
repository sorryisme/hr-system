import { createFileRoute } from '@tanstack/react-router'
import { LoginPage } from '@/features/auth/login-page'
import { redirectIfAuthenticated } from '@/features/auth/session'

export const Route = createFileRoute('/login')({
  beforeLoad: redirectIfAuthenticated,
  component: LoginPage,
})
