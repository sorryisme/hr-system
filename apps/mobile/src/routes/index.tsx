import { createFileRoute } from '@tanstack/react-router'
import { LeaveRequestPage } from '@/features/leave-request/leave-request-page'

export const Route = createFileRoute('/')({
  component: LeaveRequestPage,
})
