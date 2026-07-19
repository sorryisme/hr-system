import { createFileRoute } from '@tanstack/react-router'
import { ApprovalInboxPage } from '@/features/approvals/approval-inbox-page'
import { requireAuth } from '@/features/auth/session'

export const Route = createFileRoute('/approvals')({
  beforeLoad: requireAuth,
  component: ApprovalInboxPage,
})
