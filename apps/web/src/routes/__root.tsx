import { createRootRoute } from '@tanstack/react-router'
import { AppShell } from '@/components/shared/app-shell'

export const Route = createRootRoute({
  component: AppShell,
})
