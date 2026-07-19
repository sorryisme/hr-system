import { createFileRoute } from '@tanstack/react-router'
import { DashboardPage } from '@/features/dashboard/dashboard-page'
import { requireAuth } from '@/features/auth/session'

export const Route = createFileRoute('/dashboard')({
  beforeLoad: requireAuth,
  component: DashboardPage,
})
