import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': '대시보드',
  '/approvals': '결재함',
}

const PLACEHOLDER_NAV_ITEMS = ['직원명단', '근무표']

const navLinkClassName =
  'flex h-[38px] items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/60'
const navLinkActiveClassName =
  'bg-sidebar-accent text-sidebar-accent-foreground font-semibold hover:bg-sidebar-accent'

export function AppShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const title = PAGE_TITLES[pathname] ?? 'CareShift'

  return (
    <div className="flex min-h-svh bg-background font-sans text-foreground">
      <aside className="flex w-[220px] shrink-0 flex-col gap-1 border-r border-sidebar-border bg-sidebar p-3">
        <div className="px-2.5 pb-5 font-heading text-lg font-bold">CareShift</div>

        <Link
          to="/dashboard"
          className={navLinkClassName}
          activeProps={{ className: cn(navLinkClassName, navLinkActiveClassName) }}
        >
          대시보드
        </Link>
        <Link
          to="/approvals"
          className={cn(navLinkClassName, 'justify-between')}
          activeProps={{
            className: cn(navLinkClassName, navLinkActiveClassName, 'justify-between'),
          }}
        >
          결재함
          <Badge variant="outline" className="border-transparent bg-warning/10 text-warning">
            3
          </Badge>
        </Link>

        {PLACEHOLDER_NAV_ITEMS.map((label) => (
          <div
            key={label}
            aria-disabled="true"
            className="flex h-[38px] cursor-not-allowed items-center rounded-lg px-2.5 text-sm font-medium text-sidebar-foreground/35"
          >
            {label}
          </div>
        ))}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-6">
          <div className="font-heading text-lg font-semibold">{title}</div>
          <div className="font-mono text-[13px] text-muted-foreground">
            해피케어 주간보호센터 · 2026.07.19
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
