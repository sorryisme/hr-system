import { createFileRoute } from '@tanstack/react-router'
import { LeaveRequestPage } from '@/features/leave-request/leave-request-page'
import { requireAuth } from '@/features/auth/session'

export const Route = createFileRoute('/')({
  beforeLoad: requireAuth,
  component: LeaveRequestPage,
})
