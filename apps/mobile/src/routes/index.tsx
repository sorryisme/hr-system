import { createFileRoute } from '@tanstack/react-router'
import { AttendanceHomePage } from '@/features/attendance/attendance-home-page'
import { requireAuth } from '@/features/auth/session'

export const Route = createFileRoute('/')({
  beforeLoad: requireAuth,
  component: AttendanceHomePage,
})
