import { createFileRoute } from '@tanstack/react-router'

import { LeaveRequestPage } from '@/features/leave-request/LeaveRequestPage'

export const Route = createFileRoute('/leave-request')({
  component: LeaveRequestPage,
})
