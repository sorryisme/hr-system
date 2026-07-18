import { createFileRoute } from '@tanstack/react-router'
import { ApprovalInboxPage } from '@/features/approvals/approval-inbox-page'

export const Route = createFileRoute('/approvals')({
  component: ApprovalInboxPage,
})
