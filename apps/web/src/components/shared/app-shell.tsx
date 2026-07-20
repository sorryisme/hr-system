import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { LogOut } from 'lucide-react'
import { logout } from '@/api/generated/endpoints'
import logoWordmark from '@/assets/logo-wordmark.png'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getSessionUser, setSessionUser } from '@/features/auth/session'
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
  const navigate = useNavigate()

  if (pathname === '/login') {
    return <Outlet />
  }

  const title = PAGE_TITLES[pathname] ?? 'CareShift'
  // 보호 라우트는 requireAuth 통과 후 렌더되므로 세션 캐시가 채워져 있다
  const user = getSessionUser()

  async function handleLogout() {
    try {
      await logout()
    } finally {
      setSessionUser(null)
      navigate({ to: '/login' })
    }
  }

  return (
    <div className="flex min-h-svh bg-background font-sans text-foreground">
      <aside className="flex w-[220px] shrink-0 flex-col gap-1 border-r border-sidebar-border bg-sidebar p-3">
        <div className="px-2.5 pb-5">
          <img src={logoWordmark} alt="늘봄실버타운요양원" className="h-10 w-auto" />
        </div>

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
          <div className="flex items-center gap-4">
            <div className="font-mono text-[13px] text-muted-foreground">
              늘봄실버타운요양원 · 2026.07.19
            </div>
            {user && (
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{user.name}</span>
                <Button variant="ghost" size="sm" onClick={handleLogout}>
                  <LogOut className="size-4" />
                  로그아웃
                </Button>
              </div>
            )}
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
