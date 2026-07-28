import { createFileRoute } from '@tanstack/react-router'
import { RosterPage } from '@/features/roster/roster-page'
import { requireAuth } from '@/features/auth/session'

export const Route = createFileRoute('/roster')({
  beforeLoad: requireAuth,
  component: RosterPage,
})
